'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { listAutomationJobs } from '@/modules/nexus/actions/automation-toolbox';
export function WorkflowAutomationMonitor({ workspaceId, executionId, onInspect }: { workspaceId: string; executionId?: string; onInspect: (id: string) => void }) {
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof listAutomationJobs>>>([]), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => { void listAutomationJobs(workspaceId, executionId).then(rows => { if (active) { setJobs(rows); setError(''); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Monitor indisponível.'); }); };
    load(); const timer = setInterval(load, 5000); return () => { active = false; clearInterval(timer); };
  }, [workspaceId, executionId]);
  return <details className="mb-4 rounded-xl border border-[var(--wf-border)] p-3"><summary className="cursor-pointer text-sm font-medium">Execuções em segundo plano</summary>{error && <p role="alert" className="mt-2 text-xs text-[var(--wf-danger)]">{error}</p>}<div className="mt-3 max-h-72 space-y-2 overflow-auto">{jobs.map(job => <div key={job.id} className="rounded border border-[var(--wf-border)] p-2 text-xs"><p>{job.kind === 'child' ? 'Subfluxo' : job.kind === 'batch' ? 'Grupo de subfluxos' : 'Webhook'} · {job.status}</p><code className="block truncate">{job.executionId}</code><Button type="button" size="sm" variant="ghost" onClick={() => onInspect(job.executionId)}>Inspecionar execução</Button></div>)}{!jobs.length && !error && <p className="text-xs text-[var(--wf-muted)]">Nenhuma tarefa encontrada.</p>}</div></details>;
}
