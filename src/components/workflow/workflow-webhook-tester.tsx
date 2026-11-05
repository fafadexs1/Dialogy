'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createWebhookTestSession, readWebhookTestSample } from '@/modules/nexus/actions/automation-toolbox';

export function WorkflowWebhookTester({ workspaceId, onSample }: { workspaceId: string; onSample: (sample: Record<string, unknown>) => void }) {
  const [session, setSession] = useState<Awaited<ReturnType<typeof createWebhookTestSession>> | null>(null), [sample, setSample] = useState<Record<string, unknown> | null>(null), [error, setError] = useState('');
  useEffect(() => {
    if (!session || sample) return;
    const timer = setInterval(() => { void readWebhookTestSample(workspaceId, session.id).then(result => { if (result.sample) setSample(result.sample); else if (result.expired) { setSession(null); setError('A escuta de teste expirou.'); } }).catch(() => { setSession(null); setError('A sessão de teste está indisponível.'); }); }, 2000);
    return () => clearInterval(timer);
  }, [workspaceId, session, sample]);
  return <section className="mb-4 space-y-3 rounded-xl border border-[var(--wf-border)] p-3"><h3 className="text-sm font-semibold">Capturar webhook de teste</h3><p className="text-xs text-[var(--wf-muted)]">Captura uma requisição em até dez minutos. Não executa o fluxo.</p><Button type="button" variant="outline" onClick={() => { setError(''); setSample(null); void createWebhookTestSession(workspaceId).then(setSession).catch(e => setError(e instanceof Error ? e.message : 'Escuta indisponível.')); }}>Escutar evento de teste</Button>{error && <p role="alert" className="text-xs text-[var(--wf-danger)]">{error}</p>}{session && <><label className="block text-xs">URL de teste<input readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}${session.path}`} className="mt-1 h-9 w-full rounded border bg-[var(--wf-panel)] px-2 text-xs" /></label><label className="block text-xs">Token Bearer temporário<input readOnly type="password" value={session.token} className="mt-1 h-9 w-full rounded border bg-[var(--wf-panel)] px-2 text-xs" /><Button type="button" variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(session.token)}>Copiar token</Button></label></>}{sample && <><pre className="max-h-48 overflow-auto text-xs">{JSON.stringify(sample, null, 2)}</pre><Button type="button" onClick={() => onSample(sample)}>Fixar exemplo para testes</Button></>}</section>;
}
