/**
 * Test fixture factories for calendar sync tests.
 * Creates real DB records and real calendar events for testing.
 */

var crypto = require('crypto');
var { db, TEST_USER_ID, gcalApi, msftCalApi } = require('./test-setup');
var { taskHash } = require('../../../src/controllers/cal-sync-helpers');
var tasksWrite = require('../../../src/lib/tasks-write');

// ─── Task Fixtures ───

function makeTaskId(prefix) {
  return (prefix || 'test') + '-' + crypto.randomBytes(6).toString('hex');
}

/**
 * Create a task in the DB and return the row.
 */
async function makeTask(overrides) {
  var id = (overrides && overrides.id) || makeTaskId();
  var now = new Date();
  var tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  var task = Object.assign({
    id: id,
    user_id: TEST_USER_ID,
    task_type: 'task',
    text: 'Test Task ' + id.slice(-4),
    scheduled_at: tomorrow,
    dur: 30,
    pri: 'P3',
    rigid: 0,
    status: '',
    when: 'morning',
    recurring: 0,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }, overrides);

  await tasksWrite.insertTask(db, task);
  return db('tasks_v').where('id', task.id).first();
}

/**
 * Create a ledger row in the DB.
 */
async function makeLedgerRow(overrides) {
  var row = Object.assign({
    user_id: TEST_USER_ID,
    provider: 'gcal',
    task_id: null,
    provider_event_id: null,
    origin: 'juggler',
    last_pushed_hash: null,
    last_pulled_hash: null,
    event_summary: 'Test Event',
    event_start: null,
    event_end: null,
    event_all_day: 0,
    last_modified_at: null,
    task_updated_at: null,
    miss_count: 0,
    status: 'active',
    synced_at: db.fn.now(),
    created_at: db.fn.now()
  }, overrides);

  var result = await db('cal_sync_ledger').insert(row);
  var insertedId = result[0];
  return db('cal_sync_ledger').where('id', insertedId).first();
}

// ─── Calendar Event Fixtures (Real API) ───

/**
 * Create a real event on Google Calendar. Returns the event object.
 */
async function makeGCalEvent(token, overrides) {
  var now = new Date();
  var tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  var endTime = new Date(tomorrow.getTime() + 30 * 60000);

  var event = Object.assign({
    summary: 'Test Event ' + crypto.randomBytes(3).toString('hex'),
    description: '',
    start: { dateTime: tomorrow.toISOString(), timeZone: 'America/New_York' },
    end: { dateTime: endTime.toISOString(), timeZone: 'America/New_York' }
  }, overrides);

  var created = await gcalApi.insertEvent(token, event);
  return created;
}

/**
 * Create a real event on Microsoft Calendar. Returns the event object.
 */
async function makeMSFTEvent(token, overrides) {
  var now = new Date();
  var tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  var endTime = new Date(tomorrow.getTime() + 30 * 60000);

  var event = Object.assign({
    subject: 'Test Event ' + crypto.randomBytes(3).toString('hex'),
    body: { contentType: 'text', content: '' },
    start: { dateTime: tomorrow.toISOString().replace('Z', ''), timeZone: 'Eastern Standard Time' },
    end: { dateTime: endTime.toISOString().replace('Z', ''), timeZone: 'Eastern Standard Time' }
  }, overrides);

  var created = await msftCalApi.insertEvent(token, event);
  return created;
}

// ─── Cleanup Helpers ───

/**
 * Delete a GCal event, swallowing 404/410 errors. Retries once on 429/403 rate limit.
 */
async function deleteGCalEvent(token, eventId) {
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      await gcalApi.deleteEvent(token, eventId);
      return;
    } catch (e) {
      if (e.message.includes('404') || e.message.includes('410')) return;
      if ((e.message.includes('429') || e.message.includes('403')) && attempt < 2) {
        await new Promise(function(r) { setTimeout(r, (attempt + 1) * 2000); });
        continue;
      }
      throw e;
    }
  }
}

/**
 * Delete an MSFT event, swallowing 404 errors.
 */
async function deleteMSFTEvent(token, eventId) {
  try {
    await msftCalApi.deleteEvent(token, eventId);
  } catch (e) {
    if (!e.message.includes('404') && !e.message.includes('410')) throw e;
  }
}

/**
 * Delete all test events from GCal (events with 'Test Event' in the title).
 */
async function deleteAllGCalTestEvents(token) {
  var now = new Date();
  var start = new Date(now);
  start.setDate(start.getDate() - 30);
  var end = new Date(now);
  end.setDate(end.getDate() + 90);

  var result = await gcalApi.listEvents(token, start.toISOString(), end.toISOString());
  var events = (result && result.items) || [];
  var testEvents = events.filter(function(e) {
    return (e.summary || '').indexOf('Test Event') >= 0 || (e.summary || '').indexOf('Test Task') >= 0;
  });

  for (var i = 0; i < testEvents.length; i++) {
    await deleteGCalEvent(token, testEvents[i].id);
    if (i > 0 && i % 10 === 0) {
      await new Promise(function(r) { setTimeout(r, 500); });
    }
  }
  return testEvents.length;
}

/**
 * Delete all test events from MSFT Calendar.
 */
async function deleteAllMSFTTestEvents(token) {
  var now = new Date();
  var start = new Date(now);
  start.setDate(start.getDate() - 30);
  var end = new Date(now);
  end.setDate(end.getDate() + 90);

  var result = await msftCalApi.listEvents(token, start.toISOString(), end.toISOString());
  var events = (result && result.items) || [];
  var testEvents = events.filter(function(e) {
    return (e.subject || '').indexOf('Test Event') >= 0 || (e.subject || '').indexOf('Test Task') >= 0;
  });

  for (var i = 0; i < testEvents.length; i++) {
    await deleteMSFTEvent(token, testEvents[i].id);
  }
  return testEvents.length;
}

module.exports = {
  makeTaskId,
  makeTask,
  makeLedgerRow,
  makeGCalEvent,
  makeMSFTEvent,
  deleteGCalEvent,
  deleteMSFTEvent,
  deleteAllGCalTestEvents,
  deleteAllMSFTTestEvents
};
