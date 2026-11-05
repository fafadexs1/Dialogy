'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { listAutomationApprovals, decideAutomationApproval } from '@/modules/nexus/actions/automation-toolbox';

export function WorkflowApprovals({ workspaceId, executionId }: { workspaceId: string; executionId?: string }) {
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof listAutomationApprovals>>>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const load = async () => { try { setEntries(await listAutomationApprovals(workspaceId, executionId)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Aprovações indisponíveis.'); } };
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer); }, [workspaceId, executionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = async (id: string, decision: 'approved' | 'denied') => { setBusy(true); try { await decideAutomationApproval({ workspaceId, id, decision }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível decidir.'); } finally { setBusy(false); } };
  return <section className="space-y-3 rounded-xl border border-[var(--wf-border)] p-3"><h3 className="text-sm font-semibold">Aprovações de operações</h3>{error && <p role="alert" className="text-xs text-[var(--wf-danger)]">{error}</p>}{!entries.length && !error && <p className="text-xs text-[var(--wf-muted)]">Nenhuma aprovação pendente.</p>}{entries.map(entry => <div key={entry.id} className="space-y-2"><p className="text-sm font-medium">{entry.title}</p><p className="text-xs text-[var(--wf-muted)]">Expira em {new Date(entry.expiresAt).toLocaleString('pt-BR')}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(entry.arguments, null, 2)}</pre><div className="flex gap-2"><Button type="button" disabled={busy} onClick={() => void decide(entry.id, 'approved')}>Aprovar estes argumentos</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void decide(entry.id, 'denied')}>Recusar</Button></div></div>)}</section>;
}
