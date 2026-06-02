const knex = require('./src/db');

async function getViewDefinition() {
  try {
    const result = await knex.raw('SHOW CREATE VIEW tasks_v');
    console.log('View definition:', JSON.stringify(result[0], null, 2));
    await knex.destroy();
  } catch (error) {
    console.error('Error:', error.message);
    await knex.destroy();
  }
}

getViewDefinition();