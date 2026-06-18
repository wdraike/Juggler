/**
 * StriveRS backend — Express application
 */

const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { maybeRedisStore } = require('./lib/rate-limit-store');

const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('app');

// Adopt lib-events (ADR-0001): register the benign task-event logging
// subscriber once at startup so the shared EventBus has a live importer.
// This is logging-only — it does NOT trigger the scheduler (invariants S4/S6).
require('./lib/events/taskEventLogger');

const taskRoutes = require('./routes/task.routes');
const configRoutes = require('./routes/config.routes');
const projectRoutes = require('./routes/project.routes');
const locationRoutes = require('./routes/location.routes');
const toolRoutes = require('./routes/tool.routes');
const dataRoutes = require('./routes/data.routes');
const gcalRoutes = require('./routes/gcal.routes');
const msftCalRoutes = require('./routes/msft-cal.routes');
const appleCalRoutes = require('./routes/apple-cal.routes');
const calSyncRoutes = require('./routes/cal-sync.routes');
const scheduleRoutes = require('./routes/schedule.routes');
const healthRoutes = require('./routes/health.routes');
const aiRoutes = require('./routes/ai.routes');
const weatherRoutes = require('./routes/weather.routes');
const impersonationRoutes = require('./routes/impersonation.routes');

// MCP + OAuth (shared module — auth-service handles OAuth, we proxy)
const { createOAuthProxyRoutes } = require('auth-client/mcp-auth');
const mcpTransport = require('./mcp/transport');

const app = express();

// Trust proxy for Cloud Run
app.set('trust proxy', 1);

// Middleware
// Juggler serves both API responses and SSE streams. It does not serve HTML
// pages directly, but the frontend dev server proxies through it, so we use
// a moderate CSP: self + inline styles (for SSE/EventStream clients) and
// data: URIs for images. No unsafe-eval.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'none'"],
      frameSrc: ["'none'"],
    },
  },
}));
app.use(compression({
  filter: (req, res) => {
    if (res.getHeader('Content-Type') === 'text/event-stream') return false;
    return compression.filter(req, res);
  }
}));

// CORS. Allow configured FRONTEND_URL entries (trimmed, comma-split) +
// any localhost/127.0.0.1/[::1] origin (dev loopback is never reachable
// from outside the dev machine) + *.localdev.test + explicit
// CORS_ALLOW_ANY_ORIGIN=true opt-in.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    if (LOOPBACK_ORIGIN.test(origin) || origin.includes('localdev')) return callback(null, true);
    if (process.env.CORS_ALLOW_ANY_ORIGIN === 'true' && process.env.NODE_ENV !== 'production') return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));

app.use(cookieParser());

// Raw body capture for billing webhook HMAC — must be before bodyParser.json
app.use('/api/billing-webhooks', express.raw({ type: 'application/json' }), function(req, res, next) {
  if (!Buffer.isBuffer(req.body)) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  req.rawBody = req.body;
  try {
    req.body = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  next();
});

// Passive browser-error ingest (leg log-issue-triage-browsercapture). Mounted BEFORE the global
// 1mb json parser so its tight 16kb cap wins; unauthenticated by design (errors occur on any
// page / pre-auth) but rate-limited + size-capped + log-injection-sanitized in the route.
const clientErrorLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  // Shared counter across Cloud Run instances when Redis is configured (999.451) —
  // mirrors aiLimiter's maybeRedisStore wiring so the 30/min cap is global, not
  // per-instance. Falls back to express-rate-limit's in-memory MemoryStore
  // (single-instance) when REDIS_URL is unset, exactly like aiLimiter.
  store: maybeRedisStore('jugrl-cerr:'),
});
// Shared @raike/lib-error-ingest router (999.454) — single-source with the other services.
// Log path preserved verbatim from the prior local route: env BROWSER_ERRORS_LOG override, else
// juggler-backend/browser-errors.log (the file the log-triage skill mines).
const clientErrors = require('@raike/lib-error-ingest');
const clientErrorsLogPath = process.env.BROWSER_ERRORS_LOG ||
  require('path').join(__dirname, '..', 'browser-errors.log');
// bodyErrorGuard is the TRAILING (4-arg) error handler in this same mount chain so it catches
// express.json's PayloadTooLarge(413)/malformed(400) — a router-internal guard would be skipped.
app.use('/api/client-errors', clientErrorLimiter, express.json({ limit: '16kb' }),
  clientErrors.createClientErrorsRouter({ app: 'juggler', logPath: clientErrorsLogPath }),
  clientErrors.bodyErrorGuard);

app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
// NOTE: GET /api/events accepts JWT via ?token= query param (EventSource limitation).
// Other endpoints may also carry a ?token= query string; logging the raw URL would
// leak the JWT into request logs. Redact the `token` query value for ALL paths while
// keeping the log line (mask, don't drop). Exported for unit testing.
function redactTokenInUrl(url) {
  if (typeof url !== 'string') return url;
  return url.replace(/([?&]token=)[^&#]*/gi, '$1[REDACTED]');
}
// Custom morgan token: same as :url but with the token query value masked.
morgan.token('url-redacted', function(req) {
  return redactTokenInUrl(req.originalUrl || req.url);
});
// Mirror morgan's 'dev' format, substituting the redacted URL for :url.
app.use(morgan(':method :url-redacted :status :response-time ms - :res[content-length]', {
  skip: function(req) {
    return req.path === '/api/events' && req.query.token;
  }
}));
app.set('redactTokenInUrl', redactTokenInUrl);

// Sanitize error responses in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function(body) {
      if (res.statusCode >= 500 && body && body.message) {
        body.message = 'An error occurred processing your request';
      }
      return originalJson(body);
    };
    next();
  });
}

// Without Redis, SSE fan-out degrades to local-only and the API/AI rate limiters
// fall back to per-instance counters.
if (!process.env.REDIS_URL) {
  logger.warn('[startup] REDIS_URL not set - SSE fan-out and API/AI rate limiters will be local-only (single-instance safe, not multi-instance safe)');
}

// Broad limiters: apiLimiter uses Redis for shared counters across Cloud Run
// instances (999.626). The strict AI limiter also uses Redis. Other limiters
// (MCP, OAuth callback, billing webhooks, health) stay per-instance by design
// (Category 4f — shared counters would synchronize on every request with no
// meaningful protection gain for those low-traffic paths).
const LIMITER_DEFAULTS = { windowMs: 60 * 1000, standardHeaders: true, legacyHeaders: false };
const apiLimiter = rateLimit({ ...LIMITER_DEFAULTS, max: 1000, store: maybeRedisStore('jugrl-api:') });
const aiLimiter = rateLimit({ ...LIMITER_DEFAULTS, max: 20, store: maybeRedisStore('jugrl-ai:') });
const mcpLimiter = rateLimit({ ...LIMITER_DEFAULTS, max: 300 });
const oauthCallbackLimiter = rateLimit({ ...LIMITER_DEFAULTS, max: 20, message: { error: 'Too many requests, please wait.' } });
const billingWebhookLimiter = rateLimit({ ...LIMITER_DEFAULTS, max: 120, message: { error: 'Too many webhook calls.' } });
const healthLimiter = rateLimit({ ...LIMITER_DEFAULTS, max: 300 });
// Per-user write limiter — keys by user ID so shared NAT/proxies don't hit a common bucket.
// skip() passes through safe read-only methods so GETs aren't throttled.
const writeRateLimiter = rateLimit({
  ...LIMITER_DEFAULTS,
  max: 300,
  // Omit custom keyGenerator — default handles IPv6 safely
  // When req.user exists, rate limits by user ID instead
  keyGenerator: (req) => req.user?.id ? String(req.user.id) : undefined,
  message: { error: 'Too many write requests, please slow down.' },
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
});

// OAuth proxy + discovery routes (auth-service handles Google SSO, etc.)
// Dev mode: auto-approve OAuth for MCP client testing
if (process.env.NODE_ENV === 'development') {
  app.get('/oauth/authorize', (req, res) => {
    const redirectUri = req.query.redirect_uri;
    const state = req.query.state;
    const code = 'dev-code-' + Date.now();
    if (!redirectUri) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri required' });
    }
    var allowedHosts = ['localhost', '127.0.0.1'];
    var parsedUri;
    try { parsedUri = new URL(redirectUri); } catch {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is not a valid URL' });
    }
    if (!allowedHosts.includes(parsedUri.hostname)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri host not permitted' });
    }
    const sep = redirectUri.includes('?') ? '&' : '?';
    res.redirect(`${redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state || '')}`);
  });

  app.post('/oauth/token', (req, res) => {
    const code = req.body?.code || req.query?.code;
    if (code && code.startsWith('dev-code-')) {
      return res.json({
        access_token: 'dev-token',
        token_type: 'Bearer',
        expires_in: 3600
      });
    }
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid authorization code' });
  });

  // Dev: static client registration (bypass auth-service rate limits)
  app.post('/oauth/register', (req, res) => {
    res.json({
      client_id: 'dev-client',
      client_secret: 'dev-secret',
      client_name: 'dev-client',
      redirect_uris: req.body?.redirect_uris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post'
    });
  });
}
createOAuthProxyRoutes(app, { mcpEndpoint: '/mcp' });

// MCP Streamable HTTP (stateless, own rate limit)
app.post('/mcp', mcpLimiter, mcpTransport.handlePost);
app.get('/mcp', mcpTransport.handleMethodNotAllowed);
app.delete('/mcp', mcpTransport.handleMethodNotAllowed);

// Minimal auth profile endpoint (auth handled by auth-service, but frontend needs /auth/me)
const { authenticateJWT } = require('./middleware/jwt-auth');
const db = require('./db');
app.get('/api/auth/me', authenticateJWT, async (req, res) => {
  // Load full user from DB (auth-client only puts id/email/name on req.user from JWT)
  const user = await db('users').where('id', req.user.id).first();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture_url
    }
  });
});

// SSE endpoint — real-time event stream for connected frontends
// EventSource doesn't support custom headers, so accept token as query param
const sseEmitter = require('./lib/sse-emitter');
app.get('/api/events', (req, res, next) => {
  // Accept token from query param (EventSource limitation) or Authorization header
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  next();
}, authenticateJWT, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // disable nginx/Cloud Run buffering
  });
  // Send initial heartbeat so client knows connection is alive
  res.write('event: connected\ndata: {}\n\n');

  sseEmitter.addClient(req.user.id, res);

  // Heartbeat every 30s to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(':\n\n'); } catch { clearInterval(heartbeat); }
  }, 30000);

  req.on('close', () => clearInterval(heartbeat));
});

// Routes
// /health stays un-prefixed for load-balancer / infra probes.
// /api/health is the same router re-mounted so the authenticated frontend
// apiClient (baseURL=/api) can reach /api/health/detailed without bypassing
// its bearer-token interceptor.
// Mount-level auth guard on /api/health ensures defense-in-depth;
// individual routes that need user context still validate JWT per-route.
app.use('/health', healthLimiter, healthRoutes);
app.use('/api/health', healthLimiter, healthRoutes);
app.use('/api/ai', aiLimiter, aiRoutes);
app.use('/api/data/import', express.text({ type: 'text/csv', limit: '2mb' }), bodyParser.json({ limit: '2mb' }));
app.use('/api', apiLimiter);
app.use('/api/tasks', authenticateJWT, writeRateLimiter, taskRoutes);
app.use('/api/config', authenticateJWT, writeRateLimiter, configRoutes);
app.use('/api/projects', authenticateJWT, writeRateLimiter, projectRoutes);
app.use('/api/locations', authenticateJWT, writeRateLimiter, locationRoutes);
app.use('/api/tools', authenticateJWT, writeRateLimiter, toolRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/gcal/callback', oauthCallbackLimiter);
app.use('/api/gcal', gcalRoutes);
app.use('/api/msft-cal/callback', oauthCallbackLimiter);
app.use('/api/msft-cal', msftCalRoutes);
app.use('/api/apple-cal', appleCalRoutes);
app.use('/api/cal', calSyncRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/feature-catalog', require('./routes/feature-catalog.routes'));
app.use('/api/feature-events', require('./routes/feature-events.routes'));
app.use('/api/my-plan', require('./routes/my-plan.routes'));
app.use('/api/billing-webhooks', billingWebhookLimiter, require('./routes/billing-webhooks.routes'));
app.use('/api/weather', authenticateJWT, writeRateLimiter, weatherRoutes);
app.use('/api/impersonation', impersonationRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Global error handler
app.use((err, req, res, _next) => {
  logger.error('Unhandled error:', { error: err });
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

module.exports = app;
