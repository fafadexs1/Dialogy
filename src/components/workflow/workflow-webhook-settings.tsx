'use client';
import type { WorkflowNode } from '@/services/workflow-runtime/types';
import { Input } from '@/components/ui/input';

export function WorkflowWebhookSettings({ node, onUpdate, credentials }: { node: WorkflowNode; onUpdate: (node: WorkflowNode) => void; credentials: Array<{ id: string; name: string; type: string }> }) {
  const change = (key: string, value: unknown) => onUpdate({ ...node, config: { ...node.config, [key]: value } });
  const field = (key: string, label: string, placeholder = '') => <label key={key} className="block space-y-1 text-xs"><span>{label}</span><Input value={String(node.config[key] || '')} placeholder={placeholder} onChange={e => change(key, e.target.value)} /></label>;
  return <details className="mb-4 rounded-xl border border-[var(--wf-border)] p-3"><summary className="cursor-pointer text-sm font-medium">Resposta, assinatura e contexto do webhook</summary><div className="mt-3 space-y-3">
    <label className="block space-y-1 text-xs"><span>Quando responder</span><select value={String(node.config.responseMode || 'legacy')} onChange={e => change('responseMode', e.target.value)} className="h-10 w-full rounded border bg-[var(--wf-panel)] px-2"><option value="legacy">Compatibilidade com este fluxo</option><option value="queued">Aceitar na fila e retornar 202</option><option value="synchronous">Aguardar conclusão por prazo limitado</option><option value="response_node">Usar bloco Responder ao webhook</option></select></label>
    {['synchronous', 'response_node'].includes(String(node.config.responseMode)) && <label className="block text-xs">Prazo máximo da resposta (ms)<Input type="number" min={100} max={20000} value={Number(node.config.responseTimeoutMs || 10000)} onChange={e => change('responseTimeoutMs', Number(e.target.value))} /></label>}
    <p className="text-xs text-[var(--wf-muted)]">Ao atingir o prazo, retorna 202 com a URL de consulta. O worker continua a execução.</p>
    <label className="block space-y-1 text-xs"><span>Segredo HMAC-SHA256 adicional ao token Bearer</span><select value={String(node.config.signatureCredentialId || '')} onChange={e => change('signatureCredentialId', e.target.value)} className="h-10 w-full rounded border bg-[var(--wf-panel)] px-2"><option value="">Sem assinatura adicional</option>{credentials.filter(c => c.type === 'api_key').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {node.config.signatureCredentialId ? <>{field('signatureHeader', 'Header da assinatura', 'x-signature')}{field('timestampHeader', 'Header de timestamp Unix (opcional)', 'x-timestamp')}<p className="text-xs text-[var(--wf-muted)]">Com timestamp, o conteúdo assinado é timestamp + ponto + corpo original. A tolerância é de cinco minutos.</p></> : null}
    {field('conversationIdPath', 'Caminho do atendimento existente (opcional)', 'body.chatId')}
    <p className="text-xs text-[var(--wf-muted)]">Quando definido, valida o atendimento no workspace antes de permitir ações no canal e CRM.</p>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={node.config.includeRawBody === true} onChange={e => change('includeRawBody', e.target.checked)} />Disponibilizar também o corpo original como texto</label>
  </div></details>;
}
