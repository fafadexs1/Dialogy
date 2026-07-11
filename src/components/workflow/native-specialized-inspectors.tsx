'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  getAiModelRuntimeProvider,
  type AiModelCatalogEntry,
} from '@/lib/ai-models';
import type { WorkflowNode } from '@/services/workflow-runtime/types';
import {
  applyWorkflowModelSelection,
  getWorkflowModelOptions,
} from '@/components/workflow/native-model-selection';
import type { KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';

export const SPECIALIZED_WORKFLOW_INSPECTOR_TYPES = new Set([
  'logic.ai_router',
  'ai.model',
  'knowledge.rag_retriever',
  'tool.internal',
  'tool.mcp',
  'guardrail.policy',
]);

export function hasSpecializedWorkflowInspector(type: string) {
  return SPECIALIZED_WORKFLOW_INSPECTOR_TYPES.has(type);
}

type InspectorProps = {
  node: WorkflowNode;
  onUpdate: (node: WorkflowNode) => void;
  modelOptions?: AiModelCatalogEntry[];
  knowledgeDocuments?: KnowledgeBaseDocument[];
  knowledgeCollections?: KnowledgeCollection[];
};

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {description ? <p className="text-[11px] leading-relaxed text-slate-500">{description}</p> : null}
    </div>
  );
}

function NativeSelect({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="flex h-10 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500"
    >
      {children}
    </select>
  );
}

function ToggleField({ label, checked, onCheckedChange, description }: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <span>
        <span className="block text-sm text-slate-200">{label}</span>
        {description ? <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{description}</span> : null}
      </span>
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
    </label>
  );
}

function JsonField({ label, value, onChange }: { label: string; value: unknown; onChange: (value: Record<string, unknown>) => void }) {
  const { toast } = useToast();
  return (
    <Field label={label}>
      <Textarea
        key={JSON.stringify(value)}
        defaultValue={JSON.stringify(value || {}, null, 2)}
        onBlur={(event) => {
          try {
            const parsed = JSON.parse(event.target.value || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object_required');
            onChange(parsed);
          } catch {
            toast({ title: 'JSON inválido', description: `${label} precisa ser um objeto JSON.`, variant: 'destructive' });
          }
        }}
        className="min-h-32 font-mono text-xs"
      />
    </Field>
  );
}

function StringListField({ label, value, onChange, description }: {
  label: string;
  value: unknown;
  onChange: (value: string[]) => void;
  description?: string;
}) {
  const externalValue = Array.isArray(value) ? value.map(String).join('\n') : '';
  const [draft, setDraft] = useState(externalValue);

  useEffect(() => {
    setDraft(externalValue);
  }, [externalValue]);

  const commit = () => {
    const normalized = draft.split('\n').map((item) => item.trim()).filter(Boolean);
    setDraft(normalized.join('\n'));
    onChange(normalized);
  };

  return (
    <Field label={label} description={description}>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className="min-h-24"
        placeholder="Um item por linha"
      />
    </Field>
  );
}

function useNodeUpdater(node: WorkflowNode, onUpdate: (node: WorkflowNode) => void) {
  const config = (key: string, value: unknown) => onUpdate({ ...node, config: { ...node.config, [key]: value } });
  const rename = (name: string) => onUpdate({ ...node, name });
  return { config, rename };
}

export function AiRouterInspector({ node, onUpdate }: InspectorProps) {
  const { config, rename } = useNodeUpdater(node, onUpdate);
  const routes = Array.isArray(node.config.routes)
    ? node.config.routes.filter((route): route is Record<string, unknown> => Boolean(route) && typeof route === 'object' && !Array.isArray(route))
    : [];

  const updateRoutes = (nextRoutes: Record<string, unknown>[]) => {
    const reserved = node.outputPorts.filter((port) => ['default', 'low_confidence', 'error'].includes(port.id));
    const dynamic = nextRoutes.map((route) => ({
      id: String(route.id),
      label: String(route.label || route.id),
      direction: 'output' as const,
      connectionType: 'main' as const,
      required: true,
      multiple: false,
    }));
    onUpdate({
      ...node,
      config: { ...node.config, routes: nextRoutes },
      outputPorts: [...dynamic, ...reserved],
    });
  };

  const patchRoute = (index: number, patch: Record<string, unknown>) => {
    const next = routes.map((route, routeIndex) => routeIndex === index ? { ...route, ...patch } : route);
    updateRoutes(next);
  };

  const addRoute = () => {
    let suffix = routes.length + 1;
    while (routes.some((route) => route.id === `rota_${suffix}`)) suffix += 1;
    updateRoutes([...routes, { id: `rota_${suffix}`, label: `Rota ${suffix}`, description: '', examples: [] }]);
  };

  return (
    <div className="space-y-5">
      <Field label="Nome do roteador"><Input value={node.name} onChange={(event) => rename(event.target.value)} /></Field>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div><Label>Rotas permitidas</Label><p className="text-[11px] text-slate-500">A IA somente pode selecionar IDs declarados aqui.</p></div>
          <Button type="button" size="sm" variant="outline" onClick={addRoute}><Plus className="mr-1 h-3.5 w-3.5" />Rota</Button>
        </div>
        {routes.map((route, index) => (
          <div key={`${index}-${String(route.id)}`} className="space-y-3 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.035] p-3">
            <div className="flex gap-2">
              <Input
                aria-label={`ID da rota ${index + 1}`}
                value={String(route.id || '')}
                onChange={(event) => patchRoute(index, { id: event.target.value.trim().replace(/[^a-zA-Z0-9_-]/g, '_') })}
                placeholder="id_da_rota"
              />
              <Button type="button" size="icon" variant="ghost" aria-label={`Excluir rota ${index + 1}`} onClick={() => updateRoutes(routes.filter((_, routeIndex) => routeIndex !== index))}><Trash2 className="h-4 w-4 text-red-300" /></Button>
            </div>
            <Input value={String(route.label || '')} onChange={(event) => patchRoute(index, { label: event.target.value })} placeholder="Nome visível" />
            <Textarea value={String(route.description || '')} onChange={(event) => patchRoute(index, { description: event.target.value })} placeholder="Quando esta rota deve ser escolhida" />
            <StringListField label="Exemplos" value={route.examples} onChange={(examples) => patchRoute(index, { examples })} />
          </div>
        ))}
      </div>
      <Field label="Confiança mínima" description="Abaixo deste valor a execução segue pela saída de baixa confiança.">
        <Input type="number" min={0} max={1} step={0.05} value={Number(node.config.minimumConfidence ?? 0.75)} onChange={(event) => config('minimumConfidence', Number(event.target.value))} />
      </Field>
      <Field label="Fallback para rota desconhecida"><NativeSelect value={String(node.config.defaultOutput || 'default')} onChange={(value) => config('defaultOutput', value)}><option value="default">Padrão</option>{routes.map((route) => <option key={String(route.id)} value={String(route.id)}>{String(route.label || route.id)}</option>)}</NativeSelect></Field>
      <Field label="Saída de baixa confiança"><NativeSelect value={String(node.config.lowConfidenceOutput || 'low_confidence')} onChange={(value) => config('lowConfidenceOutput', value)}><option value="low_confidence">Baixa confiança</option><option value="default">Padrão</option>{routes.map((route) => <option key={String(route.id)} value={String(route.id)}>{String(route.label || route.id)}</option>)}</NativeSelect></Field>
    </div>
  );
}

export function ModelInspector({ node, onUpdate, modelOptions = [] }: InspectorProps) {
  const { config, rename } = useNodeUpdater(node, onUpdate);
  const currentModel = String(node.config.model || '');
  const selectOptions = getWorkflowModelOptions(modelOptions, currentModel);
  const runtimeProvider = String(node.config.provider || getAiModelRuntimeProvider(currentModel));
  const showBaseUrl = runtimeProvider === 'lmstudio'
    || runtimeProvider === 'other'
    || Boolean(node.config.baseUrl);

  const selectModel = (modelId: string) => {
    onUpdate(applyWorkflowModelSelection(node, modelId));
  };

  return (
    <div className="space-y-5">
      <Field label="Nome do bloco"><Input value={node.name} onChange={(event) => rename(event.target.value)} /></Field>
      <Field
        label="Modelo"
        description={modelOptions.length > 0
          ? 'Somente modelos configurados com credencial neste workspace aparecem aqui. O provedor é preenchido automaticamente.'
          : 'Nenhum modelo com credencial está configurado neste workspace.'}
      >
        <NativeSelect value={currentModel} onChange={selectModel}>
          {!currentModel && <option value="">Selecione um modelo</option>}
          {selectOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} · {model.legacy ? 'configuração antiga' : model.provider}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Provedor" description="Definido pelo modelo selecionado.">
        <Input value={runtimeProvider} readOnly className="cursor-default opacity-75" />
      </Field>
      {showBaseUrl ? (
        <Field label="URL base" description="Opcional para LM Studio ou provedores customizados. A credencial é resolvida pelo workspace no servidor.">
          <Input value={String(node.config.baseUrl || '')} onChange={(event) => config('baseUrl', event.target.value || undefined)} placeholder="http://host.docker.internal:1234/v1" />
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-3"><Field label="Temperatura"><Input type="number" min={0} max={2} step={0.1} value={Number(node.config.temperature ?? 0.2)} onChange={(event) => config('temperature', Number(event.target.value))} /></Field><Field label="Máx. tokens"><Input type="number" min={1} value={Number(node.config.maxOutputTokens || 2048)} onChange={(event) => config('maxOutputTokens', Number(event.target.value))} /></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Timeout (ms)"><Input type="number" min={1000} value={Number(node.config.timeoutMs || 60000)} onChange={(event) => config('timeoutMs', Number(event.target.value))} /></Field><Field label="Tentativas"><Input type="number" min={0} max={10} value={Number(node.config.maxRetries ?? 2)} onChange={(event) => config('maxRetries', Number(event.target.value))} /></Field></div>
      <ToggleField label="Tool calling" checked={node.config.supportsTools === true} onCheckedChange={(value) => config('supportsTools', value)} />
      <ToggleField label="Saída estruturada" checked={node.config.supportsStructuredOutput === true} onCheckedChange={(value) => config('supportsStructuredOutput', value)} />
      <ToggleField label="Streaming" checked={node.config.supportsStreaming === true} onCheckedChange={(value) => config('supportsStreaming', value)} />
    </div>
  );
}

export function RagInspector({
  node,
  onUpdate,
  knowledgeDocuments = [],
  knowledgeCollections = [],
}: InspectorProps) {
  const { config, rename } = useNodeUpdater(node, onUpdate);
  const [documentQuery, setDocumentQuery] = useState('');
  const documentIds = Array.isArray(node.config.documentIds) ? node.config.documentIds.map(String) : [];
  const filters = node.config.filters && typeof node.config.filters === 'object' && !Array.isArray(node.config.filters)
    ? node.config.filters as Record<string, unknown>
    : {};
  const collectionIds = Array.isArray(filters.collectionIds) ? filters.collectionIds.map(String) : [];
  const normalizedDocumentQuery = documentQuery.trim().toLocaleLowerCase('pt-BR');
  const visibleDocuments = knowledgeDocuments.filter((document) => {
    if (document.status === 'archived' || document.status === 'expired') return false;
    const memberships = document.collectionIds?.length ? document.collectionIds : ['general'];
    if (collectionIds.length > 0 && !memberships.some((collectionId) => collectionIds.includes(collectionId))) return false;
    if (!normalizedDocumentQuery) return true;
    return `${document.name} ${document.category || ''} ${(document.tags || []).join(' ')}`
      .toLocaleLowerCase('pt-BR')
      .includes(normalizedDocumentQuery);
  });

  const toggleCollection = (collectionId: string) => {
    const nextCollectionIds = collectionIds.includes(collectionId)
      ? collectionIds.filter((id) => id !== collectionId)
      : [...collectionIds, collectionId];
    const allowedDocumentIds = new Set(knowledgeDocuments.filter((document) => {
      if (nextCollectionIds.length === 0) return true;
      const memberships = document.collectionIds?.length ? document.collectionIds : ['general'];
      return memberships.some((id) => nextCollectionIds.includes(id));
    }).map((document) => document.id));
    onUpdate({
      ...node,
      config: {
        ...node.config,
        documentIds: documentIds.filter((id) => allowedDocumentIds.has(id)),
        filters: { ...filters, collectionIds: nextCollectionIds },
      },
    });
  };

  const toggleDocument = (documentId: string) => {
    config('documentIds', documentIds.includes(documentId)
      ? documentIds.filter((id) => id !== documentId)
      : [...documentIds, documentId]);
  };

  return (
    <div className="space-y-5">
      <Field label="Nome do retriever"><Input value={node.name} onChange={(event) => rename(event.target.value)} /></Field>
      <Field label="Coleções permitidas" description="Se nenhuma estiver marcada, o bloco consulta todas as coleções.">
        <div className="flex flex-wrap gap-2">
          {knowledgeCollections.map((collection) => {
            const selected = collectionIds.includes(collection.id);
            return (
              <Button
                key={collection.id}
                type="button"
                size="sm"
                variant={selected ? 'default' : 'outline'}
                aria-pressed={selected}
                onClick={() => toggleCollection(collection.id)}
              >
                {collection.name}
              </Button>
            );
          })}
          {knowledgeCollections.length === 0 ? <p className="text-xs text-slate-500">Nenhuma coleção cadastrada.</p> : null}
        </div>
      </Field>
      <Field label="Documentos permitidos" description="Se nenhum estiver marcado, todos os documentos das coleções acima ficam disponíveis.">
        <Input
          value={documentQuery}
          onChange={(event) => setDocumentQuery(event.target.value)}
          placeholder="Buscar por nome, categoria ou tag"
          className="mb-2"
        />
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-white/[0.07] p-2">
          {visibleDocuments.map((document) => (
            <label key={document.id} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-white/[0.04]">
              <Checkbox checked={documentIds.includes(document.id)} onCheckedChange={() => toggleDocument(document.id)} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-200">{document.name}</span>
                {document.category ? <span className="block truncate text-[11px] text-slate-500">{document.category}</span> : null}
              </span>
            </label>
          ))}
          {visibleDocuments.length === 0 ? <p className="p-2 text-xs text-slate-500">Nenhum documento disponível nesta seleção.</p> : null}
        </div>
      </Field>
      <Field label="Estratégia"><NativeSelect value={String(node.config.strategy || 'hybrid')} onChange={(value) => config('strategy', value)}><option value="hybrid">Híbrida</option><option value="semantic">Semântica</option><option value="keyword">Palavras-chave</option></NativeSelect></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Máx. documentos"><Input type="number" min={1} value={Number(node.config.maxDocuments || 6)} onChange={(event) => config('maxDocuments', Number(event.target.value))} /></Field><Field label="Score mínimo"><Input type="number" min={0} max={1} step={0.05} value={Number(node.config.minimumScore ?? 0.55)} onChange={(event) => config('minimumScore', Number(event.target.value))} /></Field></div>
      <Field label="Limite de tokens"><Input type="number" min={1} value={Number(node.config.tokenLimit || 6000)} onChange={(event) => config('tokenLimit', Number(event.target.value))} /></Field>
      <ToggleField label="Reordenar resultados" checked={node.config.rerank !== false} onCheckedChange={(value) => config('rerank', value)} description="Aplica reranking dentro do orçamento configurado." />
    </div>
  );
}

export function ToolInspector({ node, onUpdate }: InspectorProps) {
  const { config, rename } = useNodeUpdater(node, onUpdate);
  const mcp = node.type === 'tool.mcp';
  return (
    <div className="space-y-5">
      <Field label="Nome do bloco"><Input value={node.name} onChange={(event) => rename(event.target.value)} /></Field>
      <Field label="Nome da ferramenta"><Input value={String(node.config.name || '')} onChange={(event) => config('name', event.target.value)} /></Field>
      <Field label="Descrição operacional"><Textarea value={String(node.config.description || '')} onChange={(event) => config('description', event.target.value)} className="min-h-24" placeholder="Explique quando o agente deve usar esta ferramenta." /></Field>
      {mcp ? <><Field label="Servidor MCP"><Input value={String(node.config.serverId || '')} onChange={(event) => config('serverId', event.target.value)} /></Field><StringListField label="Tools permitidas" value={node.config.allowedTools} onChange={(value) => config('allowedTools', value)} /></> : <Field label="Ação interna"><Input value={String(node.config.action || '')} onChange={(event) => config('action', event.target.value)} /></Field>}
      <JsonField label="Schema de entrada" value={node.config.inputSchema} onChange={(value) => config('inputSchema', value)} />
      <JsonField label="Schema de saída" value={node.config.outputSchema} onChange={(value) => config('outputSchema', value)} />
      {mcp ? <Field label="Timeout (ms)"><Input type="number" min={1000} value={Number(node.config.timeoutMs || 20000)} onChange={(event) => config('timeoutMs', Number(event.target.value))} /></Field> : <ToggleField label="Operação idempotente" checked={node.config.idempotent === true} onCheckedChange={(value) => config('idempotent', value)} />}
      <ToggleField label="Exigir confirmação" checked={node.config.requiresConfirmation === true} onCheckedChange={(value) => config('requiresConfirmation', value)} description="Obrigatório para operações sensíveis ou irreversíveis." />
      {mcp ? <ToggleField label="Auditoria" checked={node.config.audit !== false} onCheckedChange={(value) => config('audit', value)} /> : null}
    </div>
  );
}

export function GuardrailInspector({ node, onUpdate }: InspectorProps) {
  const { config, rename } = useNodeUpdater(node, onUpdate);
  return (
    <div className="space-y-5">
      <Field label="Nome do bloco"><Input value={node.name} onChange={(event) => rename(event.target.value)} /></Field>
      <Field label="Nome da política"><Input value={String(node.config.name || '')} onChange={(event) => config('name', event.target.value)} placeholder="Política de atendimento" /></Field>
      <StringListField label="Verificações" value={node.config.checks} onChange={(value) => config('checks', value)} description="Uma regra clara e auditável por linha." />
      <Field label="Ao detectar violação"><NativeSelect value={String(node.config.onViolation || 'route_to_error')} onChange={(value) => config('onViolation', value)}><option value="route_to_error">Seguir rota de erro</option><option value="block">Bloquear</option><option value="redact">Ocultar conteúdo sensível</option></NativeSelect></Field>
    </div>
  );
}

export function NativeSpecializedNodeInspector(props: InspectorProps) {
  switch (props.node.type) {
    case 'logic.ai_router': return <AiRouterInspector {...props} />;
    case 'ai.model': return <ModelInspector {...props} />;
    case 'knowledge.rag_retriever': return <RagInspector {...props} />;
    case 'tool.internal':
    case 'tool.mcp': return <ToolInspector {...props} />;
    case 'guardrail.policy': return <GuardrailInspector {...props} />;
    default: return null;
  }
}
