'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react';

import type {
  AutopilotConfig,
  KnowledgeCollection,
  KnowledgeBaseDocument,
} from '@/lib/types';
import { useCurrentUser } from '@/hooks/use-online-status';
import { useAuth } from '@/providers/auth-provider';
import {
  getAutopilotConfig,
  getAgentToolCatalogAction,
} from '@/actions/autopilot';
import { getAgentStudioDataAction } from '@/actions/agent-studio';
import { getWorkspaceConfiguredAiModelsAction } from '@/actions/integrations';
import { type AiModelCatalogEntry } from '@/lib/ai-models';
import { Button } from '@/components/ui/button';
import { AiAgentJourneyStudio } from '@/components/autopilot/ai-agent-journey-studio';
import type { AgentStudioDocument } from '@/services/agent-studio/types';
import type { StudioMigrationReport } from '@/services/agent-studio/migration';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';

export default function AutopilotAgentStudioPage() {
  const params = useParams();
  const router = useRouter();
  const user = useCurrentUser();
  const auth = useAuth();

  const agentId = typeof params?.id === 'string' ? params.id : '';

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AutopilotConfig | null>(null);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeBaseDocument[]>([]);
  const [knowledgeCollections, setKnowledgeCollections] = useState<KnowledgeCollection[]>([]);
  const [availableTools, setAvailableTools] = useState<AgentToolCatalogItem[]>([]);
  const [modelCatalog, setModelCatalog] = useState<AiModelCatalogEntry[]>([]);
  const [studioDocument, setStudioDocument] = useState<AgentStudioDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requiresMigrationReview, setRequiresMigrationReview] = useState(false);
  const [migrationReport, setMigrationReport] = useState<StudioMigrationReport | null>(null);

  const fetchData = useCallback(async () => {
    if (!agentId || !user?.activeWorkspaceId) return;
    setLoading(true);
    setLoadError(null);

    try {
      const [configRes, studioRes, modelsRes, toolsRes] = await Promise.all([
        getAutopilotConfig(user.activeWorkspaceId, agentId),
        getAgentStudioDataAction(agentId),
        getWorkspaceConfiguredAiModelsAction(user.activeWorkspaceId),
        getAgentToolCatalogAction(user.activeWorkspaceId),
      ]);

      if (!configRes || !configRes.config) {
        setLoadError('Não foi possível carregar a configuração do agente.');
        setLoading(false);
        return;
      }

      setConfig(configRes.config);
      if (!studioRes.success) {
        setLoadError(studioRes.error || 'Não foi possível carregar o Estúdio de IA.');
        return;
      }
      setStudioDocument(studioRes.document);
      setRequiresMigrationReview(studioRes.requiresMigrationReview);
      setMigrationReport(studioRes.migrationReport);
      const collections = (configRes.config.knowledge_collections as KnowledgeCollection[]) || [];
      const defaultCollectionId = collections.find((c) => c.isDefault)?.id || collections[0]?.id || 'general';
      const rawDocs = (configRes.config.knowledge_base_documents as KnowledgeBaseDocument[]) || [];
      const normalizedDocs = rawDocs.map((doc) => ({
        ...doc,
        collectionIds: (Array.isArray(doc.collectionIds) && doc.collectionIds.length > 0)
          ? doc.collectionIds
          : [defaultCollectionId],
      }));
      setKnowledgeDocuments(normalizedDocs);
      setKnowledgeCollections(collections);

      if (modelsRes && modelsRes.models) {
        setModelCatalog(modelsRes.models);
      }

      if (toolsRes && toolsRes.tools) {
        setAvailableTools(toolsRes.tools);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Erro inesperado ao carregar agente.');
    } finally {
      setLoading(false);
    }
  }, [agentId, user?.activeWorkspaceId]);

  useEffect(() => {
    if (user?.activeWorkspaceId) {
      void fetchData();
    }
  }, [fetchData, user?.activeWorkspaceId]);

  if (!auth.isLoading && !auth.user) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white"><div className="max-w-sm space-y-4 text-center"><h1 className="font-semibold">Entre para abrir o Estúdio de IA</h1><p className="text-sm text-slate-400">Sua sessão não está ativa. Seus rascunhos continuam salvos.</p><Button onClick={() => router.push('/login')}>Entrar</Button></div></div>;
  }

  if (user && !user.activeWorkspaceId) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white"><div className="space-y-4 text-center"><h1 className="font-semibold">Selecione um workspace para continuar</h1><Button onClick={() => router.push('/autopilot')}>Voltar para agentes</Button></div></div>;
  }

  if (loading && !config) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-950 p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-9 w-9 animate-spin text-emerald-400" />
          <h1 className="text-base font-semibold text-white">Carregando Estúdio de IA...</h1>
          <p className="text-xs text-slate-400 max-w-xs">
            Preparando a jornada conversacional, etapas e procedimentos do agente.
          </p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-950 p-6">
        <div className="max-w-md rounded-2xl border border-red-500/20 bg-slate-900 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-400" />
          <h2 className="mt-3 text-base font-bold text-white">Erro ao abrir agente</h2>
          <p className="mt-2 text-xs text-slate-400">{loadError}</p>
          <div className="mt-5 flex justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/autopilot')}
              className="text-xs"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Voltar
            </Button>
            <Button
              size="sm"
              onClick={() => void fetchData()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!config || !studioDocument) return null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col h-screen overflow-hidden">
      <AiAgentJourneyStudio
        config={config}
        initialDocument={studioDocument}
        models={modelCatalog}
        knowledgeDocuments={knowledgeDocuments}
        knowledgeCollections={knowledgeCollections}
        tools={availableTools}
        workspaceId={user?.activeWorkspaceId || ''}
        requiresMigrationReview={requiresMigrationReview}
        migrationReport={migrationReport}
        onBackToOverview={() => router.push('/autopilot')}
      />
    </div>
  );
}
