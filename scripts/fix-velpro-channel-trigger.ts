import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { db } from '@/lib/db';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import { nexusMessageTriggerMatches } from '@/modules/nexus/services/message-dispatcher';
import { validateNexusWorkflowCredentialBindings } from '@/modules/nexus/services/credentials';
import { validateNexusWorkflowDialogyBindings } from '@/modules/nexus/services/dialogy-resources';

// Bounded administrative correction requested by the workspace owner.
// Dry run by default. Never replay customer messages or publish unrelated draft edits.
const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
const workflowId = '77bc3879-e0eb-584f-b1bb-4ca1e640ab52';
const apply = process.argv.includes('--apply');

async function main() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '15s'");
    const result = await client.query(
      `SELECT * FROM nexus_workflows WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
      [workspaceId, workflowId],
    );
    const row = result.rows[0];
    assert(row?.status === 'published', 'Expected the published Velpro workflow.');
    assert.equal(Number(row.published_revision), 19, 'Publication changed; re-inspect before applying.');
    const persistence = new PostgresWorkflowPersistence(client);
    const before = await persistence.getWorkflowDefinition(row.published_workflow_id, row.published_workflow_version);
    assert(before && before.workspaceId === workspaceId);
    const candidate = structuredClone(before);
    const trigger = candidate.nodes.find(node => node.id === 'velpro_trigger');
    assert(trigger?.type === 'trigger.received_message');
    assert.deepEqual(trigger.config.instanceNames, ['zap1']);
    const previousConfig = structuredClone(trigger.config);
    trigger.config.instanceNames = [];
    const expected = structuredClone(before);
    expected.nodes.find(node => node.id === trigger.id)!.config.instanceNames = [];
    assert.deepEqual(candidate, expected, 'Only the global instance filter may change.');

    const validation = validateWorkflowDefinition(candidate);
    assert(validation.valid, validation.errors.map(issue => issue.message).join('\n'));
    const [credentials, bindings] = await Promise.all([
      validateNexusWorkflowCredentialBindings({ workspaceId, definition: candidate }),
      validateNexusWorkflowDialogyBindings({ workspaceId, definition: candidate }),
    ]);
    assert(credentials.valid && bindings.valid, 'Existing workspace bindings must remain valid.');

    const channels = ['whatsapp', 'instagram', 'messenger', 'telegram', 'webchat'];
    const matrix = channels.map(platform => {
      const context = { platform, instanceName: platform === 'whatsapp' ? 'zap1' : platform,
        messageType: 'text', chatStatus: 'gerais' };
      const matchedBefore = nexusMessageTriggerMatches(previousConfig, 'Olá', context);
      const matchedAfter = nexusMessageTriggerMatches(trigger.config, 'Olá', context);
      assert.equal(matchedBefore, platform === 'whatsapp');
      assert.equal(matchedAfter, true);
      assert.equal(nexusMessageTriggerMatches(trigger.config, 'Olá', { ...context, chatStatus: 'atendimentos' }), false);
      assert.equal(nexusMessageTriggerMatches(trigger.config, 'Olá', { ...context, agentId: 'assigned' }), false);
      return { platform, matchedBefore, matchedAfter, assignedChatBlocked: true };
    });
    const incoming = await client.query(
      `SELECT m.platform, m.instance_name, m.type, m.content
       FROM messages m WHERE m.workspace_id=$1 AND m.from_me=false
         AND m.platform IN ('instagram','messenger') AND m.type='text'
         AND m.created_at > now()-interval '7 days'`, [workspaceId],
    );
    // Use actual persisted input, with the general-queue status required at entry.
    // This checks eligibility only: it does not dispatch or contact customers.
    const historicalEligibility = incoming.rows.map(message => {
      const context = { platform: message.platform, instanceName: message.instance_name,
        messageType: message.type, chatStatus: 'gerais' };
      return {
        platform: message.platform,
        before: nexusMessageTriggerMatches(previousConfig, message.content || '', context),
        after: nexusMessageTriggerMatches(trigger.config, message.content || '', context),
      };
    });
    assert(historicalEligibility.length > 0);
    assert(historicalEligibility.every(item => !item.before && item.after));

    // Patch the same setting in the editor without publishing any other draft changes.
    const draft = WorkflowDefinitionSchema.parse(row.draft_definition);
    const draftTrigger = draft.nodes.find(node => node.id === trigger.id);
    assert(draftTrigger?.type === 'trigger.received_message');
    assert.deepEqual(draftTrigger.config.instanceNames, ['zap1']);
    draftTrigger.config.instanceNames = [];
    const timestamp = new Date().toISOString();
    const published = WorkflowDefinitionSchema.parse({ ...candidate, version: 'v20', updatedAt: timestamp });
    const evidence = {
      observedAt: timestamp, apply, workspaceId, workflowId,
      previousVersion: before.version, version: published.version,
      change: { field: 'velpro_trigger.config.instanceNames', before: ['zap1'], after: [] },
      nodes: published.nodes.length, validation: { workflow: true, credentials: true, bindings: true },
      matrix,
      historicalEligibility: { messages: historicalEligibility.length,
        before: historicalEligibility.filter(item => item.before).length,
        after: historicalEligibility.filter(item => item.after).length,
        assumption: 'Conversation in the general queue with no assigned agent at trigger entry.' },
      providerDeliveryTested: false,
    };
    if (apply) {
      await persistence.saveWorkflowDefinition(published);
      await client.query(
        `UPDATE nexus_workflows SET draft_definition=$3::jsonb,
          published_workflow_version=$4,published_revision=20,published_at=$5,updated_at=$5
         WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, workflowId, JSON.stringify(draft), published.version, timestamp],
      );
      await client.query(
        `INSERT INTO nexus_workflow_versions
          (nexus_workflow_id,workspace_id,revision,published_revision,definition,description,source,created_by)
         SELECT $1,$2,COALESCE(MAX(revision),0)+1,20,$3::jsonb,$4,'publish',$5
         FROM nexus_workflow_versions WHERE nexus_workflow_id=$1 AND workspace_id=$2`,
        [workflowId, workspaceId, JSON.stringify(published),
          'Correção multicanal solicitada pelo proprietário: removida a restrição global à instância zap1 que bloqueava Instagram, Messenger, Telegram e webchat.',
          row.created_by],
      );
      const saved = await persistence.getWorkflowDefinition(published.id, published.version);
      assert.deepEqual(saved, published);
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
    await writeFile(`docs/velpro-channel-trigger-${apply ? 'publication' : 'dry-run'}.json`, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Channel correction failed.');
  process.exitCode = 1;
});
