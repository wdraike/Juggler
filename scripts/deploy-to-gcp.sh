#!/bin/bash

# GCP Deployment Script for Juggler
# Modeled after Resume-Optimizer deployment

set -e

# Configuration
PROJECT_ID="lexical-period-466519-s0"
REGION="us-central1"
CLOUD_SQL_CONNECTION="lexical-period-466519-s0:us-central1:resume-optimizer-db"
DATABASE_NAME="juggler"
BACKUP_DIR="/Users/david/Offline Coding/Juggler/scripts/db-backup"

# Service names
BACKEND_SERVICE="juggler-backend"
FRONTEND_SERVICE="juggler-frontend"

# Project root
PROJECT_ROOT="/Users/david/Offline Coding/Juggler"

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

backup_production_database() {
    print_header "BACKING UP PRODUCTION DATABASE"

    mkdir -p "$BACKUP_DIR"
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/juggler-pre-deploy-$TIMESTAMP.sql"

    print_status "Starting Cloud SQL proxy..."
    $PROXY_CMD $CLOUD_SQL_CONNECTION --port=3308 &
    PROXY_PID=$!
    sleep 5

    print_status "Exporting database..."
    mysqldump -h 127.0.0.1 -P 3308 -u root \
        --single-transaction --routines --triggers --set-gtid-purged=OFF \
        $DATABASE_NAME > "$BACKUP_FILE" || {
        print_error "Database backup failed!"
        kill $PROXY_PID 2>/dev/null
        exit 1
    }

    kill $PROXY_PID 2>/dev/null || true

    if [ -s "$BACKUP_FILE" ]; then
        gzip "$BACKUP_FILE"
        print_success "Backup: ${BACKUP_FILE}.gz ($(du -h "${BACKUP_FILE}.gz" | cut -f1))"
    else
        print_error "Backup file is empty!"
        exit 1
    fi
}

run_database_migrations() {
    print_header "RUNNING DATABASE MIGRATIONS"

    cd "$PROJECT_ROOT/juggler-backend"

    print_status "Starting Cloud SQL proxy..."
    $PROXY_CMD $CLOUD_SQL_CONNECTION --port=3308 &
    PROXY_PID=$!
    sleep 5

    export DB_HOST=127.0.0.1
    export DB_PORT=3308
    export DB_USER=root
    export DB_PASSWORD=""
    export DB_NAME=$DATABASE_NAME
    export NODE_ENV=production

    print_status "Running migrations..."
    npx knex migrate:latest --env production || {
        print_error "Migration failed!"
        kill $PROXY_PID 2>/dev/null
        exit 1
    }

    kill $PROXY_PID 2>/dev/null || true
    print_success "Migrations completed"
}

deploy_backend() {
    print_header "DEPLOYING BACKEND TO CLOUD RUN"

    cd "$PROJECT_ROOT/juggler-backend"

    print_status "Building backend Docker image..."
    gcloud builds submit \
        --tag gcr.io/$PROJECT_ID/$BACKEND_SERVICE \
        --timeout=15m || {
        print_error "Backend build failed!"
        exit 1
    }
    print_success "Backend image built"

    print_status "Deploying backend to Cloud Run..."
    gcloud run deploy $BACKEND_SERVICE \
        --image gcr.io/$PROJECT_ID/$BACKEND_SERVICE \
        --platform managed \
        --region $REGION \
        --allow-unauthenticated \
        --set-cloudsql-instances $CLOUD_SQL_CONNECTION \
        --set-env-vars="NODE_ENV=production,CLOUD_SQL_CONNECTION_NAME=$CLOUD_SQL_CONNECTION,DB_NAME=$DATABASE_NAME,DB_USER=root,DB_PASSWORD=" \
        --set-secrets="JWT_SECRET=juggler-jwt-secret:latest,GOOGLE_CLIENT_ID=juggler-google-client-id:latest,GOOGLE_CLIENT_SECRET=juggler-google-client-secret:latest,GEMINI_API_KEY=juggler-gemini-api-key:latest" \
        --memory 512Mi \
        --cpu 1 \
        --timeout 300 \
        --max-instances 5 \
        --min-instances 0 || {
        print_error "Backend deployment failed!"
        exit 1
    }

    BACKEND_URL=$(gcloud run services describe $BACKEND_SERVICE --region $REGION --format 'value(status.url)')
    print_success "Backend deployed: $BACKEND_URL"

    # Update backend with its own URL for CORS and GCal redirect
    GCAL_REDIRECT="${BACKEND_URL}/api/gcal/callback"
    print_status "Updating GCal redirect URI..."
    gcloud run services update $BACKEND_SERVICE \
        --region $REGION \
        --update-env-vars="FRONTEND_URL=PENDING,GCAL_REDIRECT_URI=$GCAL_REDIRECT" || true
}

deploy_frontend() {
    print_header "DEPLOYING FRONTEND TO CLOUD RUN"

    cd "$PROJECT_ROOT/juggler-frontend"

    BACKEND_URL=$(gcloud run services describe $BACKEND_SERVICE --region $REGION --format 'value(status.url)')
    GOOGLE_CLIENT_ID=$(gcloud secrets versions access latest --secret=juggler-google-client-id 2>/dev/null || echo "")

    print_status "Backend API URL: $BACKEND_URL/api"

    print_status "Building frontend Docker image..."
    gcloud builds submit \
        --tag gcr.io/$PROJECT_ID/$FRONTEND_SERVICE \
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
        --max-instances 5 \
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

    for SECRET_NAME in juggler-jwt-secret juggler-google-client-id juggler-google-client-secret juggler-gemini-api-key; do
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
    for SECRET_NAME in juggler-jwt-secret juggler-google-client-id juggler-google-client-secret juggler-gemini-api-key; do
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
            check_prerequisites
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
