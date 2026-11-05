'use client';
import { useEffect, useState } from 'react';
import { listPublishedStudioAgentsAction } from '@/actions/agent-studio';
import { StudioFlowContractSchema, type StudioFlowReleaseSummary } from '@/services/agent-studio/flow-contract';

export function useStudioFlowLibrary(workspaceId?: string) {
  const [releases, setReleases] = useState<StudioFlowReleaseSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; setReleases([]); setError('');
    if (!workspaceId) return;
    setLoading(true);
    void listPublishedStudioAgentsAction(workspaceId).then((result) => {
      if (!active) return;
      if (!result.success) { setError(result.error || 'Não foi possível carregar o Studio.'); return; }
      setReleases(result.releases.flatMap((release) => {
        const contract = StudioFlowContractSchema.safeParse(release.flowContract);
        return contract.success && contract.data.enabled ? [{ agentId: release.agentId, agentName: release.agentName, releaseId: release.releaseId, version: release.version, contract: contract.data, procedures: release.procedures, testOperations: release.testOperations }] : [];
      }));
    }).catch(() => { if (active) setError('Não foi possível carregar o Studio.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId]);
  return { releases, loading, error };
}
