import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  console.log('Adding column decision_stage to agent_decision_ledger...');
  await db.query(
    `ALTER TABLE public.agent_decision_ledger 
     ADD COLUMN IF NOT EXISTS decision_stage text`
  );
  console.log('Column added successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
