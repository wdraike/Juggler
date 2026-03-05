var knex = require("./src/db");

async function run() {
  var user = await knex("users").first();
  
  // Get all tasks for March 1st
  var tasks = await knex("tasks").where("user_id", user.id).where("date", "3/1")
    .select("id", "text", "time", "dur", "status", "habit", knex.raw("`generated`"), "gcal_event_id", "when");
  
  console.log("Tasks on 3/1:", tasks.length);
  console.log("\n--- With GCal events ---");
  var withGcal = tasks.filter(function(t) { return t.gcal_event_id; });
  var withoutGcal = tasks.filter(function(t) { return !t.gcal_event_id; });
  
  for (var t of withGcal) {
    console.log("  " + t.id + " [" + (t.status || "") + "] habit=" + t.habit + " gen=" + t.generated + " time=" + (t.time || "none") + " when=" + (t.when || "") + " \"" + t.text.substring(0, 60) + "\"");
  }
  
  console.log("\n--- Without GCal events ---");
  for (var t2 of withoutGcal) {
    console.log("  " + t2.id + " [" + (t2.status || "") + "] habit=" + t2.habit + " gen=" + t2.generated + " time=" + (t2.time || "none") + " when=" + (t2.when || "") + " \"" + t2.text.substring(0, 60) + "\"");
  }
  
  // What does Juggler's DayView actually show? Tasks with status != "done" and != "skip"
  var active = tasks.filter(function(t) { return t.status !== "done" && t.status !== "skip"; });
  var completed = tasks.filter(function(t) { return t.status === "done" || t.status === "skip"; });
  console.log("\n--- Summary ---");
  console.log("Active (not done/skip):", active.length);
  console.log("Completed (done/skip):", completed.length);
  console.log("With GCal events:", withGcal.length);
  
  // Show completed tasks that still have GCal events
  var completedWithGcal = completed.filter(function(t) { return t.gcal_event_id; });
  if (completedWithGcal.length > 0) {
    console.log("\n--- PROBLEM: Completed tasks STILL on GCal ---");
    for (var c of completedWithGcal) {
      console.log("  " + c.id + " [" + c.status + "] \"" + c.text.substring(0, 60) + "\"");
    }
  }

  await knex.destroy();
}
run().catch(function(e) { console.error(e); process.exit(1); });
