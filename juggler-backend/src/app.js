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

// MCP + OAuth (shared module — auth-service handles OAuth, we proxy)
const { createOAuthProxyRoutes } = require('auth-client/mcp-auth');
const mcpTransport = require('./mcp/transport');

const app = express();

// Trust proxy for Cloud Run
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
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
    if (process.env.CORS_ALLOW_ANY_ORIGIN === 'true') return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));

app.use(cookieParser());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan('dev'));

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

// Rate limiting
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const mcpLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });

// OAuth proxy + discovery routes (auth-service handles Google SSO, etc.)
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
    try { res.write(':\n\n'); } catch (e) { clearInterval(heartbeat); }
  }, 30000);

  req.on('close', () => clearInterval(heartbeat));
});

// Routes
// /health stays un-prefixed for load-balancer / infra probes.
// /api/health is the same router re-mounted so the authenticated frontend
// apiClient (baseURL=/api) can reach /api/health/detailed without bypassing
// its bearer-token interceptor.
app.use('/health', healthRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/ai', aiLimiter, aiRoutes);
app.use('/api/data/import', bodyParser.json({ limit: '2mb' }));
app.use('/api', apiLimiter);
app.use('/api/tasks', taskRoutes);
app.use('/api/config', configRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/tools', toolRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/gcal', gcalRoutes);
app.use('/api/msft-cal', msftCalRoutes);
app.use('/api/apple-cal', appleCalRoutes);
app.use('/api/cal', calSyncRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/feature-catalog', require('./routes/feature-catalog.routes'));
app.use('/api/feature-events', require('./routes/feature-events.routes'));
app.use('/api/my-plan', require('./routes/my-plan.routes'));
app.use('/api/billing-webhooks', require('./routes/billing-webhooks.routes'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

module.exports = app;
