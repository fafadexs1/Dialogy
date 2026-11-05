'use client';
import { useState } from 'react';
import { clearAiAppMemory } from '@/actions/ai-apps';

export function ToolMemoryPanel({ workspaceId }: { workspaceId?: string | null }) {
  const [contactId, setContactId] = useState('');
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState('');
  const clear = async (all: boolean) => {
    if (!workspaceId || (!all && !contactId.trim())) { setMessage('Informe o ID do contato para limpar apenas os dados dele.'); return; }
    const target = all ? 'todos os contatos deste workspace' : `o contato ${contactId.trim()}`;
    if (!window.confirm(`Apagar os resultados de integrações lembrados para ${target}? Esta ação não pode ser desfeita.`)) return;
    setClearing(true); setMessage('');
    try {
      const result = await clearAiAppMemory(workspaceId, all ? undefined : contactId);
      setMessage(result.success ? `${result.deleted} registro(s) apagado(s). Novas chamadas podem gerar novos registros.` : result.error);
    } catch { setMessage('Não foi possível limpar a memória. Tente novamente.'); }
    finally { setClearing(false); }
  };
  return <section aria-labelledby="memory-title" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 id="memory-title" className="text-lg font-semibold">Memória das integrações</h2>
    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Resultados elegíveis ficam criptografados por contato, agente e identidade da ferramenta, inclusive entre versões compatíveis. Por padrão, são mantidos até a limpeza; o administrador pode configurar prazo e limite por ferramenta. A remoção ou alteração da conexão impede seu uso. A limpeza abaixo apaga a memória persistente entre conversas; uma conversa ativa ainda pode manter seu próprio contexto.</p>
    <div className="mt-5 flex flex-wrap items-end gap-3"><label className="min-w-64 flex-1 text-sm font-medium text-slate-700">ID do contato<input value={contactId} onChange={(event) => setContactId(event.target.value)} placeholder="UUID do contato" className="mt-1 block h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label><button type="button" disabled={clearing || !workspaceId} onClick={() => void clear(false)} className="h-10 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Limpar contato</button><button type="button" disabled={clearing || !workspaceId} onClick={() => void clear(true)} className="h-10 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Limpar workspace</button></div>
    {message && <p role="status" className="mt-3 text-sm text-slate-600">{message}</p>}
  </section>;
}
