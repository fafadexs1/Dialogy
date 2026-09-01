'use client';

import type { StudioMigrationReport } from '@/services/agent-studio/migration';
import type { AgentStudioDocument } from '@/services/agent-studio/types';

export function StudioMigrationReview({ report, document, onChange }: { report: StudioMigrationReport; document: AgentStudioDocument; onChange: (document: AgentStudioDocument) => void }) {
  const checked = document.migrationReview?.sourceHash === report.sourceHash ? document.migrationReview.acknowledgedKeys : [];
  const pending = report.items.filter((item) => item.status === 'review' && !checked.includes(item.key)).length;
  return <details className="mx-auto mb-5 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950">
    <summary className="cursor-pointer font-semibold">Transição da configuração anterior · {pending ? `${pending} ponto(s) para revisar` : 'revisão registrada'}</summary>
    <p className="my-3">O atendimento anterior continua em uso. Este relatório não converte ações automaticamente. Marque cada ponto somente depois de reproduzir seu comportamento ou decidir conscientemente substituí-lo.</p>
    <ul className="space-y-3">{report.items.map((item) => <li key={item.key} className="rounded-lg border border-amber-200 bg-white/60 p-3">
      {item.status === 'review' ? <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={checked.includes(item.key)} onChange={(event) => onChange({ ...document, migrationReview: { sourceHash: report.sourceHash, acknowledgedKeys: event.target.checked ? [...checked, item.key] : checked.filter((key) => key !== item.key) } })} /><span><strong>{item.title}</strong><span className="block">{item.detail}</span></span></label> : <><strong>{item.title} · preservado</strong><p>{item.detail}</p></>}
    </li>)}</ul>
    <p className="mt-3">A primeira publicação exige esta revisão. O backup da configuração anterior é guardado no servidor; nenhuma credencial é exibida aqui.</p>
  </details>;
}
