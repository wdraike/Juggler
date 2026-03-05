const db = require('./src/db');
const { rowToTask } = require('./src/controllers/task.controller');

(async () => {
  const rows = await db('tasks')
    .where('user_id', '24297d4e-6d74-4530-acee-d415e67c9a8f')
    .select();
  const tasks = rows.map(rowToTask);

  const unplaced = tasks.filter(t => {
    var st = t.status || '';
    if (st === 'done' || st === 'cancel' || st === 'skip') return false;
    if (!t.date || t.date === 'TBD') return false;
    if (t.section && (t.section.includes('PARKING') || t.section.includes('TO BE SCHEDULED'))) return false;
    var w = t.when || '';
    if (w.split(',').map(s => s.trim()).indexOf('allday') !== -1) return false;
    if (!t.time || typeof t.time !== 'string') return true;
    return false;
  });

  console.log('Frontend-style unplaced count:', unplaced.length);
  unplaced.forEach(u => console.log(u.id, '|', u.text, '|', u.date, '|', u.time, '|', u.when));
  process.exit();
})();
