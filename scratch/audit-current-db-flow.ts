import 'dotenv/config';
import { db } from '../src/lib/db';
import { auditAutopilotFlowGraph } from '../src/services/autopilot/flow-audit';

async function main() {
  const result = await db.query(
    `SELECT flow_graph
     FROM autopilot_configs
     WHERE id = '475cc308-03a6-483f-8fdd-10084f0c73b8'
     LIMIT 1`
  );
  const flowGraph = result.rows[0]?.flow_graph;
  if (!flowGraph) {
    console.log('No flow graph found in DB.');
  } else {
    const audit = auditAutopilotFlowGraph(flowGraph);
    console.log('Audit Status:', audit.status);
    console.log('Audit Issues Count:', audit.issues.length);
    console.log('Simulations details:');
    console.log(JSON.stringify(audit.simulations.map(s => ({ caseId: s.caseId, title: s.title, status: s.status, message: s.message })), null, 2));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
