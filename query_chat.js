const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  const chatId = 'ecec97b3-1d37-4f01-89bc-da18818ab049';

  // Get ALL orchestrator runs with slot info
  console.log("=== ORCHESTRATOR RUNS COM SLOTS ===");
  const runs = await client.query(`
    SELECT id, status, intent,
           metadata->>'workflowEngine' AS workflow_engine,
           metadata->>'workflowReason' AS workflow_reason,
           metadata->'workflowMissingSlots' AS missing_slots,
           metadata->'responseValidator'->>'decision' AS validator_decision,
           metadata->'responseValidator'->'reasons' AS validator_reasons,
           metadata->>'deterministicRouting' AS deterministic_routing,
           metadata->'toolPlanner'->'rejectedActions' AS rejected_actions,
           source_message_id,
           created_at
    FROM orchestrator_runs 
    WHERE chat_id = $1
    ORDER BY created_at ASC
  `, [chatId]);
  
  for (const run of runs.rows) {
    console.log(`\n--- Run ${run.created_at} ---`);
    console.log(`Intent: ${run.intent} | Status: ${run.status}`);
    console.log(`Workflow engine: ${run.workflow_engine} | Reason: ${run.workflow_reason}`);
    console.log(`Missing slots: ${JSON.stringify(run.missing_slots)}`);
    console.log(`Validator: ${run.validator_decision} | Reasons: ${JSON.stringify(run.validator_reasons)}`);
    console.log(`Rejected: ${JSON.stringify(run.rejected_actions)}`);
    
    // Get the source message
    if (run.source_message_id) {
      const msg = await client.query(`SELECT content FROM messages WHERE id = $1`, [run.source_message_id]);
      if (msg.rows.length > 0) {
        console.log(`Customer said: "${msg.rows[0].content}"`);
      }
    }
  }

  await client.end();
}

main().catch(console.error);
