/**
 * Express application setup for Juggler backend
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
app.use(compression());

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',');
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, false);
    }
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
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
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

// Routes
app.use('/health', healthRoutes);
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
