process.env.NODE_ENV = 'development';
const db = require('./src/db');

var userId = '019d29f9-9ef9-74eb-af2d-0418237d0bd9';
db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first().then(row => {
  var cache = typeof row.config_value === 'string' ? JSON.parse(row.config_value) : row.config_value;
  var dp = cache.dayPlacements || {};
  
  // Search for Exercise instances across all days
  var exerciseMasterId = '019d5dfa-a97c-7152-a79a-0683cf8b40cb';
  var targets = [
    '019d5dfa-a97c-7152-a79a-0683cf8b40cb-728',  // unplaced ordinal
    '019d5dfa-a97c-7152-a79a-0683cf8b40cb-733',
    '019d5dfa-a97c-7152-a79a-0683cf8b40cb-734',
  ];
  
  console.log('Searching cache for Exercise instances...');
  Object.keys(dp).sort().forEach(date => {
    dp[date].forEach(slot => {
      if (targets.some(t => slot.taskId.endsWith(t.slice(-5))) || slot.taskId.includes('0683cf8b40cb')) {
        var h = Math.floor(slot.start/60), m = slot.start%60;
        console.log(`  ${date} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} (${slot.dur}m) ${slot.taskId.slice(-30)}`);
      }
    });
  });
  
  // Also show May 4 and May 5 full schedule
  console.log('\nMay 4 full schedule:');
  (dp['2026-05-04']||[]).forEach(s => {
    var h = Math.floor(s.start/60), m = s.start%60;
    console.log(`  ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} (${s.dur}m) ${s.taskId.slice(-25)}`);
  });

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
