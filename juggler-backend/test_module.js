try {
  console.log('Module found:', require.resolve('@raike/lib-logger'));
  const logger = require('@raike/lib-logger');
  console.log('Logger loaded successfully:', typeof logger.createLogger);
} catch (e) {
  console.error('Error:', e.message);
  console.error('Stack:', e.stack);
}