import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { NodeExecutionResult, NodeRuntimeInput } from '@/services/workflow-runtime/types';
import { loadNexusCredentialPayload } from './credentials';
import { assertAutomationToolboxEnabled } from './toolbox-policy';
import { requestAutomationApproval } from './automation-approvals';
import { executeDurableEffect } from './durable-effects';
import { requestPublicHttps } from './public-http';

export const ZapierArgumentsSchema = z.object({ data: z.record(z.unknown()) }).strict();

/** A webhook URL is a secret: retain it in the workspace vault and never expose it to the model or approval UI. */
export async function triggerZapierWebhook(input: NodeRuntimeInput, args: unknown, invocationId: string): Promise<NodeExecutionResult> {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('Workspace ausente.');
  assertAutomationToolboxEnabled(workspaceId);
  const credentialId = z.string().min(1).max(200).parse(input.node.config.credentialId);
  const parsed = ZapierArgumentsSchema.parse(args);
  const body = JSON.stringify(parsed.data);
  if (Buffer.byteLength(body, 'utf8') > 32000) throw new Error('Os dados do webhook excedem 32 KB.');
  const credential = await loadNexusCredentialPayload({ workspaceId, credentialId, allowedTypes: ['api_key'] });
  const address = String(credential.payload.value || '');
  let url: URL;
  try { url = new URL(address); } catch { throw new Error('A credencial não contém uma URL de webhook Zapier válida.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'hooks.zapier.com' || url.port || url.username || url.password || url.search || url.hash || !/^\/hooks\/catch\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) throw new Error('Use uma URL Catch Hook HTTPS do Zapier.');
  const fingerprint = createHash('sha256').update(address).digest('hex');
  const proposal = { service: 'Zapier', credentialId, fingerprint, data: parsed.data };
  const approval = await requestAutomationApproval(input, proposal, 'Acionar automação Zapier', invocationId);
  if (approval) return approval.status === 'route' ? { status: 'error', error: { code: 'ZAPIER_APPROVAL_DENIED', message: 'A operação foi recusada ou expirou.', retryable: false } } : approval;
  await executeDurableEffect(workspaceId, invocationId, proposal, async () => {
    try {
      const response = await requestPublicHttps({ url: url.href, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body, timeoutMs: 15000, maxResponseBytes: 64000, signal: input.signal });
      return { accepted: true, status: response.status };
    } catch { throw new Error('Não foi possível confirmar a operação Zapier. Confira antes de repetir.'); }
  });
  return { status: 'success', output: { accepted: true, service: 'Zapier' } };
}
