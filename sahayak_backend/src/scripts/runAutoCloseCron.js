import { autoCloseStaleComplaints } from '../modules/complaints/complaints.service.js';
import { pool } from '../config/db.js';

const runCron = async () => {
  console.log('Starting Auto-Closure Cron Job...');
  try {
    const closedCount = await autoCloseStaleComplaints();
    console.log(`Cron execution successful. Closed ${closedCount} stale complaints.`);
  } catch (error) {
    console.error('Error during Cron execution:', error);
  } finally {
    console.log('Closing database connection...');
    await pool.end(); // Properly close the pool so the script exits
    process.exit(0);
  }
};

runCron();

