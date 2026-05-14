import 'dotenv/config';
import { db } from './src/lib/db';

async function main() {
  try {
    const { rows } = await db.query(`
      SELECT tool_name, status, output, error, created_at, input
      FROM orchestrator_tool_calls
      WHERE system_agent_id = '779c0e28-b9c2-4604-9496-44d56cece388'
        AND tool_name = 'mcp_call_tool'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    console.log("MCP Tool calls:", JSON.stringify(rows, null, 2));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
