import { z } from 'zod';
import { DataOperationSchema } from './data-operations';
import type { WorkflowNode } from './types';

export const BatchConfigSchema = z.object({
  concurrency: z.number().int().min(1).max(5).default(1), errorMode: z.enum(['stop', 'collect']).default('stop'), maxItems: z.number().int().min(1).max(1000).default(1000),
  modelCallsPerChild: z.number().int().min(0).max(100).default(5), toolCallsPerChild: z.number().int().min(0).max(100).default(5),
  batchSize: z.number().int().min(1).max(100).default(1),
}).passthrough();
export function toolboxConfigurationErrors(node: WorkflowNode): string[] {
  const c = node.config, errors: string[] = [];
  if (node.type === 'data.operation') { const result = DataOperationSchema.safeParse(c); if (!result.success) errors.push(...result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)); }
  if (['logic.map_subflow', 'logic.fork_subflows', 'logic.async_subflow'].includes(node.type)) {
    const result = BatchConfigSchema.safeParse(c); if (!result.success) errors.push('Use concorrência de 1 a 5 e limites de chamadas válidos.');
    if (node.type !== 'logic.fork_subflows' && !String(c.workflowId || '').trim()) errors.push('Selecione um subfluxo publicado.');
    if (node.type === 'logic.fork_subflows' && (!Array.isArray(c.branches) || c.branches.length === 0 || c.branches.length > 20)) errors.push('Configure entre 1 e 20 subfluxos para executar.');
  }
  if (node.type === 'audio.elevenlabs' && (!String(c.text || '').trim() || !String(c.voiceId || '').trim() || !c.credentialId)) errors.push('Configure texto, voz e credencial ElevenLabs.');
  if (node.type === 'tool.text_to_speech' && (!String(c.voiceId || '').trim() || !c.credentialId)) errors.push('Configure voz e credencial ElevenLabs.');
  if (node.type === 'tool.schedule_workflow' && !String(c.workflowId || '').trim()) errors.push('Selecione o fluxo publicado para agendar.');
  if (node.type === 'tool.email_notification' && (!String(c.credentialId || '').trim() || !z.string().email().safeParse(c.recipient).success)) errors.push('Selecione credencial SMTP e informe um destinatário válido.');
  if (node.type === 'tool.zapier' && !String(c.credentialId || '').trim()) errors.push('Selecione a credencial protegida com o Catch Hook do Zapier.');
  if (node.type.includes('connector') && (!c.connectorId || !Number.isInteger(c.version) || Number(c.version) < 1)) errors.push('Selecione uma versão publicada do conector.');
  if (node.type === 'logic.approval' && (!Number.isFinite(c.expiresInMinutes) || Number(c.expiresInMinutes) < 1 || Number(c.expiresInMinutes) > 43200)) errors.push('Defina a validade da aprovação entre 1 minuto e 30 dias.');
  if (node.type === 'output.webhook_response' && (!Number.isInteger(c.status) || Number(c.status) < 200 || Number(c.status) > 599)) errors.push('Informe um status HTTP entre 200 e 599.');
  if (['integration.http_request', 'tool.http'].includes(node.type)) {
    const p = c.pagination as Record<string, unknown> | undefined;
    if (p && p.mode && p.mode !== 'none') {
      if (!['page', 'cursor'].includes(String(p.mode)) || c.method !== 'GET') errors.push('Paginação disponível para GET por página ou cursor.');
      for (const [key, max] of [['maxPages', 100], ['maxItems', 10000], ['timeoutMs', 120000]] as const) if (p[key] !== undefined && (!Number.isFinite(p[key]) || Number(p[key]) < 1 || Number(p[key]) > max)) errors.push(`Limite inválido: ${key}.`);
      if (p.mode === 'cursor' && !p.nextCursorPath) errors.push('Informe o caminho do próximo cursor.');
    }
  }
  return errors;
}
