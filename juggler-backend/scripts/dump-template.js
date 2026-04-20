#!/usr/bin/env node
/**
 * Dump a recurring template's raw DB row + a sample instance's row, plus
 * what rowToTask / getFlexWindows produce for the scheduler. Used to see
 * the actual values the scheduler is working from when the UI / stepper
 * disagree about what a task's preferred time "should" be.
 *
 * Usage:
 *   node scripts/dump-template.js "Lunch"
 *   node scripts/dump-template.js "Lunch" <userId>
 */

var db = require('../src/db');
var rowToTask = require('../src/controllers/task.controller').rowToTask;

async function run() {
  var nameSubstr = process.argv[2];
  var userFilter = process.argv[3];
  if (!nameSubstr) {
    console.error('Usage: node scripts/dump-template.js <task-name-substring> [userId]');
    process.exit(2);
  }

  var q = db('task_masters').whereRaw('LOWER(text) LIKE ?', ['%' + nameSubstr.toLowerCase() + '%']).where('recurring', 1);
  if (userFilter) q = q.where('user_id', userFilter);
  var masters = await q.select();

  if (masters.length === 0) {
    console.log('No matching recurring template found for "' + nameSubstr + '".');
    process.exit(0);
  }

  for (var mi = 0; mi < masters.length; mi++) {
    var m = masters[mi];
    console.log('── Template row ──');
    console.log('  user_id:              ' + m.user_id);
    console.log('  id:                   ' + m.id);
    console.log('  text:                 ' + JSON.stringify(m.text || ''));
    console.log('  pri:                  ' + m.pri);
    console.log('  dur:                  ' + m.dur);
    console.log('  when:                 ' + JSON.stringify(m.when || ''));
    console.log('  preferred_time_mins:  ' + m.preferred_time_mins + '  (' + fmt(m.preferred_time_mins) + ')');
    console.log('  time_flex:            ' + m.time_flex);
    console.log('  rigid:                ' + (m.rigid ? '1' : '0'));
    console.log('  split:                ' + (m.split === null ? 'null' : m.split));
    console.log('  split_min:            ' + m.split_min);
    console.log('  preferred_time:       ' + (m.preferred_time === null ? 'null' : m.preferred_time));
    console.log('  recur:                ' + (m.recur ? (typeof m.recur === 'string' ? m.recur : JSON.stringify(m.recur)) : 'null'));
    console.log('  travel_before:        ' + (m.travel_before || 0));
    console.log('  travel_after:         ' + (m.travel_after || 0));
    console.log('  location:             ' + (m.location || 'null'));
    console.log('  tools:                ' + (m.tools || 'null'));
    console.log('  day_req:              ' + m.day_req);
    console.log('  updated_at:           ' + (m.updated_at ? new Date(m.updated_at).toISOString() : 'null'));

    // What rowToTask produces for the template side of the view
    var vRow = await db('tasks_v').where('id', m.id).where('user_id', m.user_id).first();
    if (vRow) {
      var derived = rowToTask(vRow, null, {});
      console.log('\n── rowToTask(template view row) ──');
      console.log('  preferredTimeMins:    ' + derived.preferredTimeMins);
      console.log('  timeFlex:             ' + derived.timeFlex);
      console.log('  time:                 ' + JSON.stringify(derived.time));
      console.log('  rigid:                ' + derived.rigid);
      console.log('  when:                 ' + JSON.stringify(derived.when));
    }

    // Peek at one instance row + its view + derived form values
    var inst = await db('task_instances').where('master_id', m.id).where('user_id', m.user_id).orderBy('occurrence_ordinal', 'asc').first();
    if (inst) {
      console.log('\n── Sample instance row (task_instances) ──');
      console.log('  id:                   ' + inst.id);
      console.log('  date:                 ' + inst.date);
      console.log('  time:                 ' + inst.time);
      console.log('  scheduled_at:         ' + (inst.scheduled_at ? new Date(inst.scheduled_at).toISOString() : 'null'));
      console.log('  status:               ' + JSON.stringify(inst.status));
      console.log('  slack_mins:           ' + inst.slack_mins);

      var instV = await db('tasks_v').where('id', inst.id).where('user_id', m.user_id).first();
      if (instV) {
        var srcMap = {}; srcMap[m.id] = vRow;
        var instDerived = rowToTask(instV, null, srcMap);
        console.log('\n── rowToTask(instance view row) ──');
        console.log('  preferredTimeMins:    ' + instDerived.preferredTimeMins);
        console.log('  timeFlex:             ' + instDerived.timeFlex);
        console.log('  time:                 ' + JSON.stringify(instDerived.time));
        console.log('  slackMins:            ' + instDerived.slackMins);
      }
    }
    console.log('');
  }

  process.exit(0);
}

function fmt(m) {
  if (m == null) return 'null';
  var h = Math.floor(m / 60), mm = m % 60;
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
}

run().catch(function(e) { console.error(e); process.exit(1); });
