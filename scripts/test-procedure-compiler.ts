import { Pool } from 'pg';
import 'dotenv/config';
import { compileAllProcedures } from '../src/services/autopilot/procedure-compiler';
import { matchProcedure } from '../src/services/autopilot/procedure-matcher';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const WORKSPACE_ID = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';

    // Fetch scoped knowledge base documents
    const docRes = await client.query(`
      SELECT document_id as id, document_name as name, content, metadata
      FROM embeddings_documents 
      WHERE workspace_id = $1
    `, [WORKSPACE_ID]);

    const documents = docRes.rows.map(r => ({
      id: r.id,
      name: r.name,
      content: r.content,
      metadata: r.metadata || {},
    }));

    const tools = [
      { name: 'sgp_fetch_contact_panel_data' },
      { name: 'mcp:8171892c-827b-4216-a631-02839d36af85:find_router_by_ip' },
      { name: 'mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router' },
      { name: 'mcp:8171892c-827b-4216-a631-02839d36af85:get_wifi_view' },
      { name: 'mcp:8171892c-827b-4216-a631-02839d36af85:refresh_wifi_summary' },
      { name: 'mcp:8171892c-827b-4216-a631-02839d36af85:change_wifi_credentials_f670lv9' },
      { name: 'close_chat' }
    ] as any;

    const enabledToolNames = tools.map((t: any) => t.name);

    const compiled = compileAllProcedures({ documents, tools, enabledToolNames });

    // Test matcher
    const testMessage = 'voce consegue ver qual e o problema de conexao por ai?';
    console.log(`\nMatching for message: "${testMessage}" with intent "troubleshooting":`);
    const match = matchProcedure({
      intent: 'troubleshooting',
      customerMessage: testMessage,
      compiledProcedures: compiled,
    });

    if (match) {
      console.log(`MATCHED: "${match.graph.documentName}" with score ${match.score} (reason: ${match.matchReason})`);
    } else {
      console.log('NO MATCH');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
