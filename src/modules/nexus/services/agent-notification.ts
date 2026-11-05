import 'server-only';
import { z } from 'zod';
import type { NodeRuntimeInput, NodeExecutionResult } from '@/services/workflow-runtime/types';
import { requestAutomationApproval } from './automation-approvals';
import { executeDurableEffect } from './durable-effects';
import { executeNexusIntegration } from './integration-executors';
import { assertAutomationToolboxEnabled } from './toolbox-policy';

export const AgentNotificationSchema = z.object({
  subject: z.string().trim().min(1).max(200).refine((value) => !/[\r\n]/.test(value), 'Assunto inválido.'),
  text: z.string().trim().min(1).max(10000),
}).strict();

/** Send to the administrator-selected recipient only, and only after approval of exact content. */
export async function sendAgentNotification(input: NodeRuntimeInput, args: unknown, invocationId: string): Promise<NodeExecutionResult> {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('Workspace ausente.');
  assertAutomationToolboxEnabled(workspaceId);
  const parsed = AgentNotificationSchema.parse(args);
  const recipient = z.string().trim().email().max(254).parse(input.node.config.recipient);
  const credentialId = z.string().min(1).max(200).parse(input.node.config.credentialId);
  const request = { recipient, subject: parsed.subject, text: parsed.text, credentialId };
  const approval = await requestAutomationApproval(input, request, `Enviar notificação para ${recipient}`, invocationId);
  if (approval) return approval.status === 'route' ? { status: 'error', error: { code: 'NOTIFICATION_APPROVAL_DENIED', message: 'O envio foi recusado ou expirou.', retryable: false } } : approval;
  const result = await executeDurableEffect(workspaceId, invocationId, request, () => executeNexusIntegration({
    ...input, input: parsed, node: { ...input.node, type: 'integration.email', config: { credentialId, to: recipient, subject: '{{current.subject}}', text: '{{current.text}}' } },
  }));
  if (result.accepted !== true) throw new Error('O servidor SMTP não confirmou o recebimento da mensagem.');
  return { status: 'success', output: { accepted: true, recipient, status: 'smtp_accepted' } };
}
