'use strict';

function validate(schema) {
  return function(req, res, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(function(e) {
        return e.path.join('.') + ': ' + e.message;
      });
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
