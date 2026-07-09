#!/bin/bash

# GCP Deployment Script for Juggler
# Modeled after Resume-Optimizer deployment

set -e

# Configuration
PROJECT_ID="lexical-period-466519-s0"
REGION="us-central1"
CLOUD_SQL_CONNECTION="lexical-period-466519-s0:us-central1:resume-optimizer-db"
DATABASE_NAME="juggler"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/db-backup"

# ── Deploy-time DB connection (backup + migrations) — 999.1180 ──────────────
# The pre-deploy backup NEVER worked: every dump in scripts/db-backup/ was 0
# bytes. Root causes, all fixed below:
#   1. The Cloud SQL proxy was started on tcp:3308, which is the dev-bed
#      Docker MySQL's port (port strategy: 3307 is the reserved Cloud SQL
#      Proxy port) — the proxy failed to bind and mysqldump talked to the
#      local dev server instead of prod.
#   2. mysqldump/migrations ran as `-u root` with NO password — Cloud SQL
#      requires the real DB credentials (DB_USER/DB_PASSWORD in Secret
#      Manager, the same secrets dev.js --prod-db uses).
#   3. mysqldump's existence was never checked (it was absent from PATH on
#      the deploy machine) and the shell redirection pre-created the dump
#      file, so every failure left a 0-byte .sql artifact that looked like a
#      backup. Failures now delete the partial file and ABORT the deploy.
# Overridable for a rehearsal against a local MySQL (e.g. test-bed 3407):
#   DEPLOY_SKIP_PROXY=1 DEPLOY_DB_PORT=3407 DEPLOY_DB_USER=root \
#   DEPLOY_DB_PASSWORD=rootpass DEPLOY_DB_NAME=<db>_test \
#   ./scripts/deploy-to-gcp.sh backup
DEPLOY_DB_HOST="${DEPLOY_DB_HOST:-127.0.0.1}"
DEPLOY_DB_PORT="${DEPLOY_DB_PORT:-3307}"       # 3307 = reserved Cloud SQL Proxy port
DEPLOY_DB_NAME="${DEPLOY_DB_NAME:-$DATABASE_NAME}"
DEPLOY_DB_USER="${DEPLOY_DB_USER:-}"           # resolved from Secret Manager when unset
DEPLOY_DB_PASSWORD="${DEPLOY_DB_PASSWORD:-}"   # resolved from Secret Manager when unset
DEPLOY_SKIP_PROXY="${DEPLOY_SKIP_PROXY:-0}"    # 1 = target reachable directly (no proxy)

# Service names
BACKEND_SERVICE="juggler-backend"
FRONTEND_SERVICE="juggler-frontend"

# Project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
    echo
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo
}

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

confirm_deployment() {
    print_header "JUGGLER GCP DEPLOYMENT"
    echo "You are about to deploy to PRODUCTION:"
    echo "  Project: $PROJECT_ID"
    echo "  Region: $REGION"
    echo "  Database: $DATABASE_NAME (on $CLOUD_SQL_CONNECTION)"
    echo
    print_warning "This will:"
    echo "  1. Backup the production database"
    echo "  2. Run pending database migrations"
    echo "  3. Deploy backend to Cloud Run"
    echo "  4. Deploy frontend to Cloud Run"
    echo
    echo -n "Continue? (yes/no): "
    read -r confirmation
    if [ "$confirmation" != "yes" ]; then
        print_status "Deployment cancelled."
        exit 0
    fi
}

check_prerequisites() {
    print_header "CHECKING PREREQUISITES"

    if ! command -v gcloud &> /dev/null; then
        print_error "gcloud CLI not installed!"
        exit 1
    fi
    print_success "gcloud CLI installed"

    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
        print_error "Not authenticated with gcloud!"
        exit 1
    fi
    print_success "Authenticated with gcloud"

    CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
    if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
        print_status "Switching to $PROJECT_ID..."
        gcloud config set project $PROJECT_ID
    fi
    print_success "Using project: $PROJECT_ID"

    if command -v cloud_sql_proxy &> /dev/null; then
        PROXY_CMD="cloud_sql_proxy"
    elif command -v cloud-sql-proxy &> /dev/null; then
        PROXY_CMD="cloud-sql-proxy"
    else
        print_error "Cloud SQL proxy not installed!"
        exit 1
    fi
    export PROXY_CMD
    print_success "Cloud SQL proxy: $PROXY_CMD"
}

# True when something accepts TCP connections on $1:$2 (pure bash, no nc dep).
port_listening() {
    (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null || return 1
    exec 3>&- 3<&- 2>/dev/null || true
    return 0
}

# Resolve DEPLOY_DB_USER/DEPLOY_DB_PASSWORD — env wins; otherwise pull the
# DB_USER/DB_PASSWORD secrets from Secret Manager (same creds dev.js
# --prod-db uses). Fails LOUD if neither source yields both values: an
# unauthenticated dump produces exactly the 0-byte artifacts of 999.1180.
resolve_db_credentials() {
    if [ -z "$DEPLOY_DB_USER" ]; then
        print_status "Resolving DB_USER from Secret Manager..."
        DEPLOY_DB_USER=$(gcloud secrets versions access latest --secret=DB_USER 2>/dev/null) || true
    fi
    if [ -z "$DEPLOY_DB_PASSWORD" ]; then
        print_status "Resolving DB_PASSWORD from Secret Manager..."
        DEPLOY_DB_PASSWORD=$(gcloud secrets versions access latest --secret=DB_PASSWORD 2>/dev/null) || true
    fi
    if [ -z "$DEPLOY_DB_USER" ] || [ -z "$DEPLOY_DB_PASSWORD" ]; then
        print_error "DB credentials unresolved! Set DEPLOY_DB_USER/DEPLOY_DB_PASSWORD or store DB_USER/DB_PASSWORD secrets in Secret Manager."
        exit 1
    fi
}

PROXY_PID=""
start_cloud_sql_proxy() {
    if [ "$DEPLOY_SKIP_PROXY" = "1" ]; then
        print_status "DEPLOY_SKIP_PROXY=1 — connecting directly to $DEPLOY_DB_HOST:$DEPLOY_DB_PORT"
        if ! port_listening "$DEPLOY_DB_HOST" "$DEPLOY_DB_PORT"; then
            print_error "Nothing is listening on $DEPLOY_DB_HOST:$DEPLOY_DB_PORT!"
            exit 1
        fi
        return 0
    fi
    if port_listening "$DEPLOY_DB_HOST" "$DEPLOY_DB_PORT"; then
        print_error "Port $DEPLOY_DB_PORT is already in use (a Cloud SQL proxy from dev.js --prod-db?)."
        print_error "Stop it, or reuse it explicitly with DEPLOY_SKIP_PROXY=1."
        exit 1
    fi
    print_status "Starting Cloud SQL proxy on tcp:$DEPLOY_DB_PORT..."
    $PROXY_CMD -instances=$CLOUD_SQL_CONNECTION=tcp:$DEPLOY_DB_PORT &
    PROXY_PID=$!
    local i
    for i in $(seq 1 30); do
        if port_listening "$DEPLOY_DB_HOST" "$DEPLOY_DB_PORT"; then
            print_success "Cloud SQL proxy ready"
            return 0
        fi
        sleep 1
    done
    print_error "Cloud SQL proxy did not become ready on tcp:$DEPLOY_DB_PORT within 30s!"
    stop_cloud_sql_proxy
    exit 1
}

stop_cloud_sql_proxy() {
    if [ -n "$PROXY_PID" ]; then
        kill $PROXY_PID 2>/dev/null || true
        wait $PROXY_PID 2>/dev/null || true
        PROXY_PID=""
    fi
}

backup_production_database() {
    print_header "BACKING UP DATABASE ($DEPLOY_DB_NAME @ $DEPLOY_DB_HOST:$DEPLOY_DB_PORT)"

    if ! command -v mysqldump &> /dev/null; then
        print_error "mysqldump not found on PATH! (brew install mysql-client, then add its bin/ to PATH)"
        exit 1
    fi

    mkdir -p "$BACKUP_DIR"
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/juggler-pre-deploy-$TIMESTAMP.sql"

    resolve_db_credentials
    start_cloud_sql_proxy

    print_status "Exporting database..."
    if ! MYSQL_PWD="$DEPLOY_DB_PASSWORD" mysqldump \
        -h "$DEPLOY_DB_HOST" -P "$DEPLOY_DB_PORT" -u "$DEPLOY_DB_USER" \
        --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF \
        "$DEPLOY_DB_NAME" > "$BACKUP_FILE"; then
        rm -f "$BACKUP_FILE"   # never leave a 0-byte/partial artifact behind (999.1180)
        stop_cloud_sql_proxy
        print_error "Database backup failed — DEPLOY ABORTED (no dump written)."
        exit 1
    fi

    stop_cloud_sql_proxy

    # Fail-loud completeness checks: non-empty AND carrying mysqldump's own
    # completion trailer (a truncated dump is as useless as an empty one).
    if [ ! -s "$BACKUP_FILE" ]; then
        rm -f "$BACKUP_FILE"
        print_error "Backup file is empty — DEPLOY ABORTED."
        exit 1
    fi
    if ! tail -1 "$BACKUP_FILE" | grep -q "Dump completed"; then
        rm -f "$BACKUP_FILE"
        print_error "Backup is missing mysqldump's 'Dump completed' trailer (truncated) — DEPLOY ABORTED."
        exit 1
    fi

    gzip "$BACKUP_FILE"
    print_success "Backup: ${BACKUP_FILE}.gz ($(du -h "${BACKUP_FILE}.gz" | cut -f1))"
}

run_database_migrations() {
    print_header "RUNNING DATABASE MIGRATIONS"

    cd "$PROJECT_ROOT/juggler-backend"

    resolve_db_credentials
    start_cloud_sql_proxy

    export DB_HOST=$DEPLOY_DB_HOST
    export DB_PORT=$DEPLOY_DB_PORT
    export DB_USER=$DEPLOY_DB_USER
    export DB_PASSWORD=$DEPLOY_DB_PASSWORD
    export DB_NAME=$DEPLOY_DB_NAME
    export NODE_ENV=production

    print_status "Running migrations..."
    npx knex migrate:latest --env production || {
        print_error "Migration failed!"
        stop_cloud_sql_proxy
        exit 1
    }

    stop_cloud_sql_proxy
    print_success "Migrations completed"
}

deploy_backend() {
    print_header "DEPLOYING BACKEND TO CLOUD RUN"

    cd "$PROJECT_ROOT"

    print_status "Building backend Docker image..."
    gcloud builds submit \
        --config=juggler-backend/cloudbuild.yaml \
        --gcs-source-staging-dir=gs://${PROJECT_ID}_cloudbuild/source \
        --ignore-file=juggler-backend/.gcloudignore \
        --timeout=15m || {
        print_error "Backend build failed!"
        exit 1
    }
    print_success "Backend image built"

    # Deploy using service YAML — single source of truth for all env vars.
    # The YAML lives at deploy/juggler-backend.yaml in the parent repo and
    # contains the complete service spec (env vars, secrets, resources).
    local YAML_FILE="$SCRIPT_DIR/../../deploy/$BACKEND_SERVICE.yaml"
    if [ ! -f "$YAML_FILE" ]; then
        print_error "Service YAML not found: $YAML_FILE"
        print_status "Falling back to image-only deploy (preserves existing env vars)..."
        gcloud run deploy $BACKEND_SERVICE \
            --image gcr.io/$PROJECT_ID/$BACKEND_SERVICE \
            --region $REGION \
            --project $PROJECT_ID \
            --quiet || {
            print_error "Backend deployment failed!"
            exit 1
        }
    else
        print_status "Deploying backend via service YAML..."
        gcloud run services replace "$YAML_FILE" \
            --region $REGION \
            --project $PROJECT_ID || {
            print_error "Backend deployment failed!"
            exit 1
        }
    fi

    BACKEND_URL=$(gcloud run services describe $BACKEND_SERVICE --region $REGION --format 'value(status.url)')
    print_success "Backend deployed: $BACKEND_URL"
}

deploy_frontend() {
    print_header "DEPLOYING FRONTEND TO CLOUD RUN"

    cd "$PROJECT_ROOT"

    BACKEND_URL=$(gcloud run services describe $BACKEND_SERVICE --region $REGION --format 'value(status.url)')
    GOOGLE_CLIENT_ID=$(gcloud secrets versions access latest --secret=juggler-google-client-id 2>/dev/null || echo "")

    print_status "Backend API URL: $BACKEND_URL/api"

    print_status "Google Client ID: ${GOOGLE_CLIENT_ID:0:20}..."
    print_status "Building frontend Docker image..."
    gcloud builds submit \
        --config=juggler-frontend/cloudbuild.yaml \
        --substitutions="_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" \
        --ignore-file=juggler-frontend/.gcloudignore \
        --timeout=15m || {
        print_error "Frontend build failed!"
        exit 1
    }
    print_success "Frontend image built"

    print_status "Deploying frontend to Cloud Run..."
    gcloud run deploy $FRONTEND_SERVICE \
        --image gcr.io/$PROJECT_ID/$FRONTEND_SERVICE \
        --platform managed \
        --region $REGION \
        --allow-unauthenticated \
        --set-env-vars="NODE_ENV=production,BACKEND_URL=$BACKEND_URL" \
        --memory 256Mi \
        --timeout 60 \
        --max-instances 2 \
        --min-instances 0 || {
        print_error "Frontend deployment failed!"
        exit 1
    }

    FRONTEND_URL=$(gcloud run services describe $FRONTEND_SERVICE --region $REGION --format 'value(status.url)')
    print_success "Frontend deployed: $FRONTEND_URL"

    # Update backend FRONTEND_URL for CORS
    print_status "Updating backend CORS with frontend URL..."
    gcloud run services update $BACKEND_SERVICE \
        --region $REGION \
        --update-env-vars="FRONTEND_URL=$FRONTEND_URL" || true
}

verify_deployment() {
    print_header "VERIFYING DEPLOYMENT"

    BACKEND_URL=$(gcloud run services describe $BACKEND_SERVICE --region $REGION --format 'value(status.url)')
    FRONTEND_URL=$(gcloud run services describe $FRONTEND_SERVICE --region $REGION --format 'value(status.url)')

    print_status "Testing backend health..."
    if curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/health" | grep -q "200"; then
        print_success "Backend health check passed"
    else
        print_warning "Backend health check failed (may need warm-up)"
    fi

    print_status "Testing frontend..."
    if curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL" | grep -q "200"; then
        print_success "Frontend is responding"
    else
        print_warning "Frontend check failed (may need warm-up)"
    fi

    echo
    print_success "Deployment completed!"
    echo
    echo "Service URLs:"
    echo "  Backend:  $BACKEND_URL"
    echo "  Frontend: $FRONTEND_URL"
    echo
    print_status "Monitor logs:"
    echo "  Backend:  gcloud run logs tail $BACKEND_SERVICE --region $REGION"
    echo "  Frontend: gcloud run logs tail $FRONTEND_SERVICE --region $REGION"
}

setup_secrets() {
    print_header "SETTING UP GCP SECRETS"

    print_status "This will create secrets in Google Secret Manager."
    print_status "You'll be prompted for each secret value."
    echo

    for SECRET_NAME in juggler-jwt-secret juggler-google-client-id juggler-google-client-secret juggler-gemini-api-key juggler-microsoft-client-id juggler-microsoft-client-secret; do
        if gcloud secrets describe $SECRET_NAME &>/dev/null; then
            print_success "$SECRET_NAME already exists"
        else
            echo -n "Enter value for $SECRET_NAME: "
            read -rs SECRET_VALUE
            echo
            echo -n "$SECRET_VALUE" | gcloud secrets create $SECRET_NAME --data-file=- --replication-policy=automatic
            print_success "Created $SECRET_NAME"
        fi
    done

    # Grant Cloud Run access
    PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
    SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
    for SECRET_NAME in juggler-jwt-secret juggler-google-client-id juggler-google-client-secret juggler-gemini-api-key juggler-microsoft-client-id juggler-microsoft-client-secret; do
        gcloud secrets add-iam-policy-binding $SECRET_NAME \
            --member="serviceAccount:$SA" \
            --role="roles/secretmanager.secretAccessor" --quiet || true
    done
    print_success "Secret access granted to Cloud Run"
}

show_help() {
    echo "GCP Deployment Script for Juggler"
    echo "=================================="
    echo
    echo "Usage: $0 [command]"
    echo
    echo "Commands:"
    echo "  all          Full deployment (backup + migrate + backend + frontend)"
    echo "  backup       Backup production database only"
    echo "  migrate      Run database migrations only"
    echo "  backend      Deploy backend only"
    echo "  frontend     Deploy frontend only"
    echo "  verify       Verify existing deployment"
    echo "  secrets      Set up GCP Secret Manager secrets"
    echo "  help         Show this help"
    echo
}

main() {
    case "${1:-help}" in
        "all")
            confirm_deployment
            check_prerequisites
            backup_production_database
            run_database_migrations
            deploy_backend
            deploy_frontend
            verify_deployment
            ;;
        "backup")
            # Rehearsal mode (DEPLOY_SKIP_PROXY=1 + explicit DEPLOY_DB_* creds,
            # e.g. against test-bed 3407) needs no gcloud/proxy prerequisites.
            if [ "$DEPLOY_SKIP_PROXY" != "1" ]; then
                check_prerequisites
            fi
            backup_production_database
            ;;
        "migrate")
            check_prerequisites
            run_database_migrations
            ;;
        "backend")
            check_prerequisites
            deploy_backend
            ;;
        "frontend")
            check_prerequisites
            deploy_frontend
            ;;
        "verify")
            verify_deployment
            ;;
        "secrets")
            setup_secrets
            ;;
        "help"|*)
            show_help
            ;;
    esac
}

main "$@"
