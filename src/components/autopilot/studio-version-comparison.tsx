'use client';

import { useEffect, useState } from 'react';
import { getStudioVersionForDraftAction } from '@/actions/agent-studio';
import { compareStudioVersions } from '@/services/agent-studio/version-comparison';
import type { AgentStudioDocument } from '@/services/agent-studio/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function StudioVersionComparison({ agentId, release, current, onClose }: { agentId: string; release: { id: string; version: number }; current: AgentStudioDocument; onClose: () => void }) {
  const [previous, setPrevious] = useState<AgentStudioDocument | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void getStudioVersionForDraftAction(agentId, release.id).then((result) => { if (!cancelled) { if (result.success) setPrevious(result.document); else setError(result.error); } }).catch(() => { if (!cancelled) setError('Não foi possível carregar esta versão.'); });
    return () => { cancelled = true; };
  }, [agentId, release.id]);
  const changes = previous ? compareStudioVersions(previous, current) : [];
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Versão {release.version} → rascunho atual</DialogTitle><DialogDescription>Comparação da configuração. Não executa ações nem altera a publicação; disponibilidade externa pode ter mudado.</DialogDescription></DialogHeader>
    {error ? <p role="alert">{error}</p> : !previous ? <p>Carregando versão…</p> : changes.length ? <ul className="space-y-3 text-sm">{changes.map((change) => <li key={change} className="rounded-lg border p-3">{change}</li>)}</ul> : <p className="text-sm">Nenhuma diferença de configuração encontrada.</p>}
    {previous && <p className="text-xs text-muted-foreground">A restauração usa o conteúdo de conhecimento publicado. Esta comparação não busca nem compara documentos externos atuais.</p>}
  </DialogContent></Dialog>;
}
