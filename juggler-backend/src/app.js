/**
 * Express application setup for Juggler backend
 */

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const taskRoutes = require('./routes/task.routes');
const configRoutes = require('./routes/config.routes');
const dataRoutes = require('./routes/data.routes');
const gcalRoutes = require('./routes/gcal.routes');
const healthRoutes = require('./routes/health.routes');

const app = express();

// Trust proxy for Cloud Run
app.set('trust proxy', 1);

// Middleware
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
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Routes
app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/config', configRoutes);
app.use('/api/projects', configRoutes);
app.use('/api/locations', configRoutes);
app.use('/api/tools', configRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/gcal', gcalRoutes);

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
