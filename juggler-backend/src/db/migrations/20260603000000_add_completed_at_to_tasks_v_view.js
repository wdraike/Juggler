'use strict';

/**
 * Update tasks_v view to include completed_at column
 * 
 * This migration updates the tasks_v view to expose the completed_at column
 * from task_instances table, which is needed for calendar history tracking.
 */
exports.up = async function(knex) {
  console.log('Updating tasks_v view to include completed_at column...');
  
  // Get the current view definition
  const viewResult = await knex.raw('SHOW CREATE VIEW tasks_v');
  const currentViewSql = viewResult[0][0]['Create View'];
  
  // Modify the view SQL to add completed_at column
  // Find the position where we need to add the column (before the FROM clause in the second SELECT)
  const modifiedViewSql = currentViewSql.replace(
    /(i\.master_id\s+AS\s+master_id)\s*FROM\s*task_instances\s+i\s+JOIN\s+task_masters\s+m\s+ON\s+i\.master_id\s*=\s*m\.id/,
    '$1,\n      i.completed_at               AS completed_at\n    FROM task_instances i JOIN task_masters m ON i.master_id = m.id'
  );
  
  // Also add NULL AS completed_at to the first part of the UNION (recurring templates)
  const finalViewSql = modifiedViewSql.replace(
    /(m\.id\s+AS\s+master_id)\s*FROM\s*task_masters\s+m\s+WHERE\s*m\.recurring\s*=\s*1/,
    '$1,\n      NULL AS completed_at\n    FROM task_masters m WHERE m.recurring = 1'
  );
  
  // Drop the existing view
  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  
  // Recreate the view with the modified SQL
  await knex.raw(finalViewSql);
  
  console.log('tasks_v view updated successfully with completed_at column.');
};

exports.down = async function(knex) {
  console.log('Reverting tasks_v view update...');
  
  // Get the current view definition
  const viewResult = await knex.raw('SHOW CREATE VIEW tasks_v');
  const currentViewSql = viewResult[0][0]['Create View'];
  
  // Remove the completed_at column from both parts of the UNION
  const revertedViewSql = currentViewSql
    .replace(/,\s*\n\s+i\.completed_at\s+AS\s+completed_at\s*\n/, '\n')
    .replace(/,\s*\n\s+NULL\s+AS\s+completed_at\s*\n/, '\n');
  
  // Drop the existing view
  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  
  // Recreate the view with the original SQL
  await knex.raw(revertedViewSql);
  
  console.log('tasks_v view reverted successfully (completed_at column removed).');
};