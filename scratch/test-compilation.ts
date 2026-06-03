import { Pool } from 'pg';
import 'dotenv/config';
import { compileAllProcedures } from '../src/services/autopilot/procedure-compiler';
import { listAgentToolCatalogItems } from '../src/services/agent-tools/catalog';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT knowledge_base_documents, enabled_tool_names 
       FROM public.autopilot_configs 
       WHERE id = '7d7259ab-a6c3-4057-a9ca-28ddbb15db95'`
    );
    const config = res.rows[0];
    if (!config) {
      console.log('Lucas config not found!');
      return;
    }

    const documents = config.knowledge_base_documents || [];
    const enabledToolNames = config.enabled_tool_names || [];
    const tools = listAgentToolCatalogItems();

    console.log(`Compiling procedures for ${documents.length} documents...`);
    console.log(`Enabled tools:`, enabledToolNames);

    const { compileProcedureFromDocument } = await import('../src/services/autopilot/procedure-compiler');
    for (const doc of documents) {
      const result = compileProcedureFromDocument({
        document: doc,
        tools,
        enabledToolNames,
      });
      console.log(`\nDocument: "${doc.name}"`);
      console.log(`  Success:`, result.success);
      if (result.success) {
        console.log(`  Steps:`, result.graph?.steps.map(s => `${s.id} (${s.type}): ${s.label.slice(0, 50)}...`));
      } else {
        console.log(`  Error:`, result.error);
        console.log(`  Warnings:`, result.warnings);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
