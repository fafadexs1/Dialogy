import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { db } from '@/lib/db';
import { executeSgpIdentification } from '@/modules/nexus/services/sgp-identification';
import type { NodeRuntimeInput } from '@/services/workflow-runtime/types';
import type { NexusPlatformChoice } from '@/modules/nexus/services/platform-actions';

// Real SGP lookup, captured delivery only. Does not send messages or mutate the contact.
async function main() {
  const cpf = String(process.argv[2] || '').replace(/\D/g, '');
  if (cpf.length !== 11) throw new Error('Informe o CPF autorizado como argumento.');
  const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
  try {
    const { rows } = await db.query(`SELECT c.id, v.value, f.label FROM chats c
      JOIN workspace_integrations i ON i.workspace_id=c.workspace_id AND i.provider='sgp' AND i.is_active=true
      JOIN custom_field_definitions f ON f.id::text=i.config->>'cpfFieldId' AND f.workspace_id=c.workspace_id
      JOIN contact_custom_field_values v ON v.contact_id=c.contact_id AND v.field_id=f.id
      WHERE c.workspace_id=$1 AND regexp_replace(v.value,'[^0-9]','','g')=$2 ORDER BY c.updated_at DESC LIMIT 1`, [workspaceId, cpf]);
    if (rows.length !== 1) throw new Error('Não foi encontrado um atendimento com este CPF no campo mapeado.');
    const chatId = rows[0].id;
    const variables: Record<string, unknown> = {};
    let choices: NexusPlatformChoice[] = [];
    const pageSizes: number[] = [];
    const seen = new Set<string>();
    const step = async (answer?: string) => {
      const result = await executeSgpIdentification({
        workflow: { workspaceId }, node: { id: 'live_identify_readonly', config: { outputKey: 'identity', saveDocumentIfEmpty: false } },
        execution: { executionId: 'live-readonly', conversationId: chatId, variables },
        input: answer === undefined ? {} : { resume: { selectedOptionId: answer } },
      } as unknown as NodeRuntimeInput, {
        sendOptions: async menu => { choices = menu.choices; return { success: true, captured: true, delivered: false }; },
        sendResponse: async () => ({ success: true, captured: true, delivered: false }),
      });
      Object.assign(variables, result.statePatch);
      return result;
    };
    assert.equal((await step()).status, 'waiting');
    const actualContracts = (variables.__nexus_identify_live_identify_readonly as { contracts: Array<{ id: string; statusTone: string }> }).contracts;
    const contractStatuses = actualContracts.reduce<Record<string, number>>((counts, contract) => {
      counts[contract.statusTone] = (counts[contract.statusTone] || 0) + 1;
      return counts;
    }, {});
    while (true) {
      assert.ok(choices.length <= 10);
      assert.ok(choices.some(choice => choice.id === 'other_cpf'));
      pageSizes.push(choices.length);
      choices.filter(choice => choice.id.startsWith('contract:')).forEach(choice => seen.add(choice.id));
      if (!choices.some(choice => choice.id === 'next')) break;
      assert.equal((await step('next')).status, 'waiting');
    }
    const last = choices.find(choice => choice.id.startsWith('contract:'))!;
    const selected = await step(last.id);
    assert.equal(selected.selectedOutput, 'selected');
    assert.equal(selected.output?.contractId, last.id.replace('contract:', ''));
    // Start again, request another CPF and supply the same authorized CPF.
    await step(); await step('other_cpf');
    assert.equal((await step(cpf)).status, 'waiting');
    assert.ok(choices.some(choice => choice.id === 'other_cpf'));
    const cancelled = actualContracts.find(contract => contract.statusTone === 'cancelled');
    if (cancelled) {
      while (!choices.some(choice => choice.id === `contract:${cancelled.id}`)) {
        assert.ok(choices.some(choice => choice.id === 'next'));
        await step('next');
      }
      const selectedCancelled = await step(`contract:${cancelled.id}`);
      assert.equal(selectedCancelled.output?.statusTone, 'cancelled');
    }
    const saved = await db.query(`SELECT v.value FROM chats c JOIN contact_custom_field_values v ON v.contact_id=c.contact_id
      JOIN workspace_integrations i ON i.workspace_id=c.workspace_id AND i.provider='sgp' AND i.is_active=true
      WHERE c.id=$1 AND c.workspace_id=$2 AND v.field_id::text=i.config->>'cpfFieldId'`, [chatId, workspaceId]);
    assert.equal(saved.rows[0].value, rows[0].value);
    const evidence = { observedAt: new Date().toISOString(), source: 'real-sgp-api', mappedField: rows[0].label,
      cpfMasked: `***.***.${cpf.slice(6, 9)}-**`, contractsReachable: seen.size, pages: pageSizes.length, menuSizes: pageSizes,
      selectionConfirmed: true, alternateCpfLookupConfirmed: true, crmCpfUnchanged: true,
      contractStatuses, cancelledSelectionConfirmed: Boolean(cancelled),
      messagesSent: 0, delivery: 'captured-locally', productionWorkflowPublished: false };
    await writeFile('docs/velpro-identification-live-results.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Falha na validação.'); process.exitCode = 1; });
