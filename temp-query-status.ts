import { db } from './src/lib/db';

async function run() {
  try {
    const res = await db.query(`
      SELECT status, COUNT(*) as count
      FROM evolution_webhook_events
      WHERE created_at >= '2026-07-09T22:50:00.000Z'
      GROUP BY status
    `);
    console.log("Current event counts by status since 22:50 UTC:");
    console.log(res.rows);

    const latestFailed = await db.query(`
      SELECT id, status, last_error, attempt_count, locked_by, updated_at
      FROM evolution_webhook_events
      WHERE created_at >= '2026-07-09T22:50:00.000Z'
      ORDER BY updated_at DESC
      LIMIT 5
    `);
    console.log("\nLatest updated events:");
    console.log(JSON.stringify(latestFailed.rows, null, 2));

  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
