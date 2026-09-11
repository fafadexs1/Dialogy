import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { db } from '@/lib/db';
import { executeSgpIdentification } from '@/modules/nexus/services/sgp-identification';
import { isValidBrazilianDocument } from '@/lib/brazilian-document';
import type { NodeRuntimeInput } from '@/services/workflow-runtime/types';

// Read historical inputs and query SGP; capture all delivery and disable CRM writes.
async function main() {
  const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
  const phones = ['5561998773030', '5561996374943', '5574981278864'];
  const evidence = [];
  try {
    for (const phone of phones) {
      const { rows } = await db.query(`SELECT n.input, n.state_before, n.node_id, e.conversation_id
        FROM workflow_node_runs n JOIN workflow_executions e ON e.id=n.execution_id
        JOIN chats c ON c.id::text=e.conversation_id JOIN contacts p ON p.id=c.contact_id
        WHERE e.workspace_id=$1 AND p.phone=$2 AND n.started_at>'2026-09-08'
          AND n.node_type='dialogy.sgp_identify_customer'
          AND n.input->'resume'->>'value' ~ '^[0-9. /-]+$'
        ORDER BY n.started_at LIMIT 1`, [workspaceId, phone]);
      assert.equal(rows.length, 1);
      const row = rows[0];
      const resume = { ...row.input.resume };
      const staleSelection = resume.selectedOptionId;
      assert.equal(isValidBrazilianDocument(resume.value), true);
      // Reproduce the corrected executor's replacement semantics for this message.
      delete resume.selectedOptionId;
      delete resume.optionResolutionAttempted;
      const input = {
        workflow: { workspaceId }, node: { id: row.node_id, config: { saveDocumentIfEmpty: false } },
        execution: { executionId: 'readonly-routing-verification', conversationId: row.conversation_id, variables: row.state_before },
        input: { resume },
      } as unknown as NodeRuntimeInput;
      let choices: Array<{ id: string }> = [];
      const delivery = {
        sendResponse: async () => ({ success: true, captured: true }),
        sendOptions: async (menu: { choices: Array<{ id: string }> }) => { choices = menu.choices; return { success: true, captured: true }; },
      };
      const found = await executeSgpIdentification(input, delivery);
      const contracts = choices.filter(choice => choice.id.startsWith('contract:'));
      assert.ok(contracts.length > 0, 'SGP should return selectable contracts');
      Object.assign(input.execution.variables, found.statePatch);
      input.input = { resume: { selectedOptionId: contracts[0].id } };
      const selected = await executeSgpIdentification(input, delivery);
      assert.equal(selected.selectedOutput, 'selected');
      evidence.push({ phone, validDocument: true, staleSelection, realSgpLookup: true,
        visibleContracts: contracts.length, selectionRoutes: selected.selectedOutput,
        statusTone: selected.output?.statusTone, crmWrite: false, messagesSent: 0 });
    }
    const report = { observedAt: new Date().toISOString(), evidence,
      limitation: 'Historical input replay with real SGP lookup and captured side effects; production deploy and live handoff not verified.' };
    await writeFile('docs/velpro-routing-20260908-verification.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Verification failed'); process.exitCode = 1; });
