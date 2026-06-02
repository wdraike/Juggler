module.exports = {
  rules: {
    'sql-injection/no-unsafe-sql': {
      create(context) {
        const dangerousFunctions = [
          'knex.raw',
          'knex.client.raw',
          'queryBuilder.raw',
          'whereRaw',
          'havingRaw',
          'orderByRaw',
          'joinRaw',
          'groupByRaw'
        ];

        return {
          CallExpression(node) {
            if (node.callee.type === 'MemberExpression') {
              const methodName = node.callee.property.name;
              const objectName = node.callee.object.type === 'Identifier' 
                ? node.callee.object.name 
                : node.callee.object.property?.name;

              // Check if this is a dangerous function call
              if (dangerousFunctions.includes(`${objectName}.${methodName}`) || 
                  dangerousFunctions.includes(methodName)) {

                // Check arguments for unsafe patterns
                const firstArg = node.arguments[0];
                if (firstArg && firstArg.type === 'TemplateLiteral') {
                  // Check if template literal contains variables
                  if (firstArg.expressions.length > 0) {
                    context.report({
                      node: node.callee.property,
                      message: 'Potential SQL injection: Avoid template literals with variables in raw SQL queries. Use parameterized queries instead.'
                    });
                  }
                } else if (firstArg && firstArg.type === 'BinaryExpression' && firstArg.operator === '+') {
                  // Check for string concatenation
                  context.report({
                    node: node.callee.property,
                    message: 'Potential SQL injection: Avoid string concatenation in raw SQL queries. Use parameterized queries instead.'
                  });
                }
              }
            }
          }
        };
      }
    }
  }
};