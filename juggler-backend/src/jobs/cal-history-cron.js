// Cal History Cron Job - Class-based version for server integration
const { markMissedTasks, purgeOldEntries, runCalHistoryCron } = require('../cron/cal-history-cron');

class CalHistoryCron {
  constructor() {
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    
    // Run immediately and then on a daily schedule
    this.run();
    this.schedule();
  }

  async run() {
    try {
      await runCalHistoryCron();
    } catch (error) {
      console.error('CalHistoryCron run error:', error);
    }
  }

  schedule() {
    // Schedule to run daily at 2 AM
    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(2, 0, 0, 0);
    
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    const delay = nextRun - now;
    
    setTimeout(() => {
      this.run();
      // Schedule next run
      this.schedule();
    }, delay);
  }

  stop() {
    this.running = false;
  }
}

module.exports = CalHistoryCron;
