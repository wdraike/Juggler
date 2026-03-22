const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Proxy feedback routes to bug-reporter-service (must be before generic /api proxy)
  app.use(
    '/api/feedback',
    createProxyMiddleware({
      target: 'http://localhost:5030',
      changeOrigin: true
    })
  );

  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:5002',
      changeOrigin: true
    })
  );

  app.use(
    '/health',
    createProxyMiddleware({
      target: 'http://localhost:5002',
      changeOrigin: true
    })
  );
};
