/**
 * Diagnostic: run the scheduler and show what gets placed on today
 */
var db = require('./src/db');
var { runScheduleAndPersist, getSchedulePlacements } = require('./src/scheduler/runSchedule');

var USER_ID = 1;

(async function() {
  try {
    // Just get placements (uses cache or runs if stale)
    var placements = await getSchedulePlacements(USER_ID);

    var todayKey = (new Date().getMonth() + 1) + '/' + new Date().getDate();
    console.log('Today key:', todayKey);
    console.log('Day keys in placements:', Object.keys(placements.dayPlacements).sort().slice(0, 7));

    if (placements.dayPlacements[todayKey]) {
      console.log('\n=== TODAY placements ===');
      placements.dayPlacements[todayKey].forEach(function(p) {
        var h = Math.floor(p.start / 60);
        var m = p.start % 60;
        var ampm = h >= 12 ? 'PM' : 'AM';
        var dh = h > 12 ? h - 12 : (h === 0 ? 12 : h);
        console.log('  ' + dh + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm + ' | ' + p.dur + 'm | ' + (p.task ? p.task.pri + ' ' + p.task.text.substring(0, 50) : '?'));
      });
    } else {
      console.log('\n!!! NO placements for today (' + todayKey + ')');
    }

    console.log('\nUnplaced count:', placements.unplaced.length);
    var todayUnplaced = placements.unplaced.filter(function(t) { return t.date === todayKey; });
    console.log('Unplaced dated today:', todayUnplaced.length);
    todayUnplaced.forEach(function(t) {
      console.log('  ' + t.pri + ' | ' + t.time + ' | ' + (t.habit ? 'H' : ' ') + ' | ' + t.text.substring(0, 50));
    });

    // Now force a fresh run
    console.log('\n=== FORCING FRESH SCHEDULER RUN ===');
    var result = await runScheduleAndPersist(USER_ID);

    console.log('\nAfter fresh run - day keys:', Object.keys(result.dayPlacements).sort().slice(0, 7));

    if (result.dayPlacements[todayKey]) {
      console.log('\n=== TODAY placements (fresh) ===');
      result.dayPlacements[todayKey].forEach(function(p) {
        var h = Math.floor(p.start / 60);
        var m = p.start % 60;
        var ampm = h >= 12 ? 'PM' : 'AM';
        var dh = h > 12 ? h - 12 : (h === 0 ? 12 : h);
        console.log('  ' + dh + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm + ' | ' + p.dur + 'm | ' + (p.task ? p.task.pri + ' ' + p.task.text.substring(0, 50) : '?'));
      });
    } else {
      console.log('\n!!! STILL NO placements for today after fresh run');
    }

    console.log('\nFresh unplaced count:', result.unplaced.length);
    var freshTodayUnplaced = result.unplaced.filter(function(t) { return t.date === todayKey; });
    console.log('Fresh unplaced dated today:', freshTodayUnplaced.length);
    freshTodayUnplaced.forEach(function(t) {
      console.log('  ' + t.pri + ' | ' + t.time + ' | ' + (t.habit ? 'H' : ' ') + ' | ' + t.text.substring(0, 50));
    });

    console.log('\nScore:', JSON.stringify(result.score?.total));
    console.log('Updated:', result.updated);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await db.destroy();
  }
})();
