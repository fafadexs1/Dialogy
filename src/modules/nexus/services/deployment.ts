import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { db } from '@/lib/db';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime';

type NexusDeploymentRow = Record<string, unknown>;

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function hashNexusWebhookToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function verifyNexusWebhookToken(token: string, expectedHash: string | null) {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(hashNexusWebhookToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function rotateNexusWebhookToken(workspaceId: string, nexusWorkflowId: string) {
  const token = `nxs_${randomBytes(32).toString('base64url')}`;
  const result = await db.query(
    `UPDATE public.nexus_workflows
     SET webhook_token_hash = $3, updated_at = timezone('utc', now())
     WHERE workspace_id = $1 AND id = $2
     RETURNING id`,
    [workspaceId, nexusWorkflowId, hashNexusWebhookToken(token)],
  );
  if (!result.rows[0]) throw new Error('Fluxo Nexus não encontrado neste workspace.');
  return token;
}

export async function getNexusDeploymentInfo(workspaceId: string, nexusWorkflowId: string) {
  const result = await db.query(
    `SELECT id, status, draft_definition, webhook_token_hash, published_revision, published_at
     FROM public.nexus_workflows
     WHERE workspace_id = $1 AND id = $2
     LIMIT 1`,
    [workspaceId, nexusWorkflowId],
  );
  const row = result.rows[0] as NexusDeploymentRow | undefined;
  if (!row) throw new Error('Fluxo Nexus não encontrado neste workspace.');
  const definition = WorkflowDefinitionSchema.parse(parseJson(row.draft_definition));
  const trigger = definition.nodes.find((node) => node.type.startsWith('trigger.'));
  return {
    status: String(row.status),
    triggerType: trigger?.type || null,
    triggerConfig: trigger?.config || {},
    webhookConfigured: Boolean(row.webhook_token_hash),
    webhookPath: `/api/nexus/webhooks/${nexusWorkflowId}`,
    publishedRevision: Number(row.published_revision || 0),
    publishedAt: row.published_at ? new Date(String(row.published_at)).toISOString() : null,
  };
}
