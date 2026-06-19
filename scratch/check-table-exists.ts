import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const result = await db.query(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables 
       WHERE table_name = 'agent_causal_pattern_applications'
     );`
  );
  console.log('Table agent_causal_pattern_applications exists:', result.rows[0].exists);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
