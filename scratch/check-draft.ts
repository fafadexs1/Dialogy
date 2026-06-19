import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const result = await db.query(
    `SELECT *
     FROM autopilot_config_drafts
     WHERE config_id = '475cc308-03a6-483f-8fdd-10084f0c73b8'
     LIMIT 1`
  );
  if (result.rowCount === 0) {
    console.log('No draft found for this agent.');
  } else {
    const draft = result.rows[0];
    console.log('Draft details:');
    console.log('- config_id:', draft.config_id);
    console.log('- created_at:', draft.created_at);
    console.log('- updated_at:', draft.updated_at);
    console.log('- ai_model in snapshot:', draft.snapshot?.ai_model);
    console.log('- flow_graph status in snapshot exists:', !!draft.snapshot?.flow_graph);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
