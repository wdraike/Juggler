const knex = require('./src/db');

async function checkView() {
  try {
    console.log('Checking current database state...');
    
    // Check if tasks_v view has completed_at column
    const result = await knex('tasks_v').columnInfo();
    const hasCompletedAt = result.hasOwnProperty('completed_at');
    console.log('Has completed_at column:', hasCompletedAt);
    
    // Check if missed status is allowed in task_instances
    try {
      const testInsert = await knex('task_instances').insert({
        id: 'test-missed-check-' + Date.now(),
        user_id: 'test-user',
        master_id: 'test-master',
        status: 'missed',
        scheduled_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      });
      console.log('Missed status insert successful:', !!testInsert);
    } catch (insertError) {
      console.log('Missed status insert failed:', insertError.message);
    }
    
    // Check if cal_history table exists
    const hasCalHistory = await knex.schema.hasTable('cal_history');
    console.log('Has cal_history table:', hasCalHistory);
    
    // Check if there are any legacy rows with completed_at backfilled
    const legacyTasks = await knex('task_instances')
      .whereIn('status', ['done', 'skip', 'cancel'])
      .whereNotNull('completed_at');
    console.log('Legacy rows with completed_at:', legacyTasks.length);
    
    await knex.destroy();
  } catch (error) {
    console.error('Error:', error.message);
    await knex.destroy();
  }
}

checkView();