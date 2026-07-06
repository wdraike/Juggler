const { createProxyMiddleware } = require('http-proxy-middleware');
const { services } = require('juggler-shared/proxy-config');

module.exports = function(app) {
  // Proxy feedback routes to bug-reporter-service (must be before generic /api proxy)
  app.use(
    '/api/feedback',
    createProxyMiddleware({
      target: services.bugs.backend,
      changeOrigin: true
    })
  );

  app.use(
    '/api',
    createProxyMiddleware({
      target: services.juggler.backend,
      changeOrigin: true
    })
  );

  app.use(
    '/health',
    createProxyMiddleware({
      target: services.juggler.backend,
      changeOrigin: true
    })
  );
};
