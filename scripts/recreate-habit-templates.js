#!/usr/bin/env node
/**
 * Recreate missing habit_template rows from instance data.
 *
 * Usage: node scripts/recreate-habit-templates.js
 */

var path = require('path');
var db = require(path.join(__dirname, '..', 'juggler-backend', 'src', 'db'));

var templates = [
  {
    id: 'ht_apply',
    text: 'Apply for Jobs',
    dur: 60,
    pri: 'P1',
    project: 'Job Search',
    when: '',
    day_req: 'any',
    location: JSON.stringify([]),
    tools: JSON.stringify(['personal_pc']),
    rigid: 0,
    split: 1,
    split_min: 30,
    habit: 1,
    recur: JSON.stringify({ type: 'daily' }),
    date_origin: '2/21'
  },
  {
    id: 'ht_breakfast',
    text: 'Eat Breakfast',
    dur: 30,
    pri: 'P3',
    project: 'Habits',
    when: 'morning,biz,lunch,afternoon,evening',
    day_req: 'any',
    location: JSON.stringify(['home']),
    tools: JSON.stringify([]),
    rigid: 1,
    split: 0,
    split_min: null,
    habit: 1,
    recur: JSON.stringify({ type: 'daily' }),
    date_origin: '2/21'
  },
  {
    id: 'ht_dinner',
    text: 'Dinner with Family',
    dur: 30,
    pri: 'P3',
    project: 'Habits',
    when: 'morning,biz,lunch,afternoon,evening',
    day_req: 'any',
    location: JSON.stringify([]),
    tools: JSON.stringify([]),
    rigid: 1,
    split: 0,
    split_min: null,
    habit: 1,
    recur: JSON.stringify({ type: 'daily' }),
    date_origin: '2/21'
  },
  {
    id: 'ht_exercise',
    text: 'Exercise',
    dur: 30,
    pri: 'P3',
    project: 'Habits',
    when: 'morning,lunch,afternoon,evening',
    day_req: 'any',
    location: JSON.stringify([]),
    tools: JSON.stringify([]),
    rigid: 0,
    split: 1,
    split_min: null,
    habit: 1,
    recur: JSON.stringify({ type: 'daily' }),
    date_origin: '2/21'
  },
  {
    id: 'ht_lunch',
    text: 'Lunch',
    dur: 30,
    pri: 'P3',
    project: 'Habits',
    when: 'morning,biz,lunch,afternoon,evening',
    day_req: 'any',
    location: JSON.stringify([]),
    tools: JSON.stringify([]),
    rigid: 1,
    split: 0,
    split_min: null,
    habit: 1,
    recur: JSON.stringify({ type: 'daily' }),
    date_origin: '2/21'
  },
  {
    id: 'ht_meds',
    text: 'Take morning prescriptions',
    dur: 20,
    pri: 'P1',
    project: 'Habits',
    when: 'morning',
    day_req: 'any',
    location: JSON.stringify([]),
    tools: JSON.stringify([]),
    rigid: 0,
    split: 0,
    split_min: null,
    habit: 1,
    recur: JSON.stringify({ type: 'daily' }),
    date_origin: '3/1'
  },
  {
    id: 'ht_resume',
    text: 'Work on Resume Optimizer',
    dur: 120,
    pri: 'P1',
    project: 'Job Search',
    when: 'morning,biz,lunch,afternoon,evening',
    day_req: 'any',
    location: JSON.stringify(['home', 'Hotel', 'Airplane']),
    tools: JSON.stringify([]),
    rigid: 0,
    split: 1,
    split_min: 15,
    habit: 1,
    recur: JSON.stringify({ type: 'daily' }),
    date_origin: '2/21'
  },
  {
    id: 'qa_91277',
    text: 'Take Evening Medications',
    dur: 10,
    pri: 'P1',
    project: 'General',
    when: 'evening',
    day_req: 'any',
    location: JSON.stringify(['home', 'Hotel']),
    tools: JSON.stringify([]),
    rigid: 1,
    split: 0,
    split_min: null,
    habit: 1,
    recur: JSON.stringify({ type: 'daily' }),
    date_origin: '2/26'
  }
];

async function main() {
  // Get the user_id from an existing instance
  var sample = await db('tasks').where('task_type', 'habit_instance').first();
  if (!sample) {
    console.error('No habit instances found — cannot determine user_id');
    process.exit(1);
  }
  var userId = sample.user_id;
  console.log('User ID: ' + userId);

  var { localToUtc } = require(path.join(__dirname, '..', 'juggler-backend', 'src', 'scheduler', 'dateHelpers'));
  var tz = 'America/New_York';

  for (var tmpl of templates) {
    // Check if already exists
    var exists = await db('tasks').where('id', tmpl.id).first();
    if (exists) {
      console.log('SKIP ' + tmpl.id + ' — already exists');
      continue;
    }

    // Build scheduled_at from the origin date + a reasonable morning time
    var scheduledAt = localToUtc(tmpl.date_origin, '7:00 AM', tz) || null;

    var row = {
      id: tmpl.id,
      user_id: userId,
      task_type: 'habit_template',
      text: tmpl.text,
      dur: tmpl.dur,
      pri: tmpl.pri,
      project: tmpl.project,
      when: tmpl.when,
      day_req: tmpl.day_req,
      location: tmpl.location,
      tools: tmpl.tools,
      rigid: tmpl.rigid,
      split: tmpl.split,
      split_min: tmpl.split_min,
      habit: tmpl.habit,
      recur: tmpl.recur,
      scheduled_at: scheduledAt,
      status: '',
      generated: 0,
      date_pinned: 0,
      marker: 0,
      flex_when: 0,
      depends_on: JSON.stringify([]),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    };

    await db('tasks').insert(row);
    console.log('CREATED ' + tmpl.id + ' — "' + tmpl.text + '"');
  }

  console.log('\nDone. Verifying...');
  var count = await db('tasks')
    .where('task_type', 'habit_template')
    .count('* as cnt')
    .first();
  console.log('Total habit_template rows: ' + count.cnt);

  await db.destroy();
}

main().catch(function(err) {
  console.error(err);
  process.exit(1);
});
