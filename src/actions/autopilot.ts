'use server';

import { v4 as uuidv4 } from 'uuid';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type {
    AutopilotConfig,
    AutopilotConfigDraft,
    AutopilotConfigDraftSnapshot,
    AutopilotConfigVersionSummary,
    AutopilotFlowGraph,
    AutopilotFlowAiProposal,
    NexusFlowInstance,
    Action,
    AutopilotUsageLog,
    AutopilotRagHealth,
    KnowledgeCollection,
    KnowledgeBaseDocument,
    Workspace,
} from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { enqueueAiDocumentIngest, shouldEnqueueJob } from '@/lib/queue';
import { DOCUMENT_EMBEDDING_DIMENSIONS, DOCUMENT_EMBEDDING_MODEL } from '@/lib/embeddings';
import { ingestKnowledgeBaseDocument } from '@/services/rag/document-ingestion';
import { hasKnowledgeDocumentIndexChanged } from '@/services/rag/knowledge-document';
import { VectorStore } from '@/lib/vector-store';
import { isUnsafeAsCustomerFacingKnowledge } from '@/services/rag/document-safety';
import { retrieveHybridSupportContext } from '@/services/rag/hybrid-retrieval';
import { buildRagLabCases, summarizeRagLabResults, type RagLabCaseResult, type RagLabReport } from '@/services/rag/evaluation';
import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { filterKnowledgeDocumentsForScope, resolveActiveFlowIntentScope } from '@/services/autopilot/flow-routing';
import { isAllowedAutopilotModel, resolveAutopilotModelFromCatalog } from '@/services/ai/model-selection';
import { listAgentToolCatalogItems, type AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { listMcpToolsForWorkspace } from '@/services/mcp/store';
import { classifyMcpToolSafety, resolveMcpToolTimeoutMs } from '@/services/mcp/tool-safety';
import { getAiModelRuntimeProvider, normalizeGoogleAiModelId } from '@/lib/ai-models';
import { improveKnowledgeDocumentForRag } from '@/ai/flows/knowledge-document-rewrite';
import { generateAutopilotFlowProposal } from '@/ai/flows/autopilot-flow-builder';
import {
    generateNativeWorkflowAiProposal,
    type NativeWorkflowAiProposal,
} from '@/services/workflow-runtime/native-ai-builder';
import { resolveWorkspaceAiExecutionContext } from '@/services/ai/runtime';
import { resolveAiProviderKeyCandidates } from '@/services/ai/provider-keys';
import {
    isWorkspaceConfiguredAiModel,
    listWorkspaceConfiguredAiModels,
    type ConfiguredWorkspaceAiModel,
} from '@/services/ai/workspace-ai-credentials';
import { resolveAllowedKnowledgeDocumentIds } from '@/services/autopilot/turn-policy';
import { auditAutopilotFlowGraph, summarizeFlowAuditIssues } from '@/services/autopilot/flow-audit';
import {
    analyzeAutopilotToolCoverage,
    isAutopilotToolCoveragePublishBlocked,
    summarizeAutopilotToolCoverageBlockers,
} from '@/services/autopilot/tool-coverage';
import { selectFlowBuilderTools } from '@/services/autopilot/flow-builder-tool-scope';
import { migrateAutopilotFlowGraphToV2 } from '@/services/autopilot/flow-v2';
import { detectAndPersistCausalPatternsForWorkspace } from '@/services/autopilot/causal-patterns';
import { reviewCausalPattern, type CausalPatternReviewDecision } from '@/services/autopilot/causal-pattern-review';
import {
    buildCausalPatternImpactReport,
    type CausalPatternImpactDecision,
    type CausalPatternImpactReport,
} from '@/services/autopilot/causal-pattern-impact';
import { buildAutopilotLearningTrend, type AutopilotLearningTrendInsight } from '@/services/autopilot/learning-trend';
import {
    buildAutopilotProcedureOutcomeInsights,
    type AutopilotProcedureOutcomeInsight,
} from '@/services/autopilot/procedure-outcomes';
import {
    buildAutopilotSwitchRouteOutcomeInsights,
    type AutopilotSwitchRouteOutcomeInsight,
} from '@/services/autopilot/switch-route-outcomes';
import {
    applyCausalPatternToDraft,
    applySafeCausalPatternAutoTuneToDraft,
    markDraftCausalPatternApplicationsDiscarded,
    markDraftCausalPatternApplicationsPublished,
    previewCausalPatternDraftApplication,
    revertCausalPatternDraftApplication,
    type CausalPatternDraftApplicationPreview,
} from '@/services/autopilot/causal-pattern-apply';
import { normalizeToolSelectionScoreWeights, recordAgentScoreHistory } from '@/services/autopilot/score-history';
import { shadowCompileAutopilotWorkflowRuntimeV2 } from '@/services/workflow-runtime/autopilot-rollout';
import {
    WorkflowDefinitionSchema,
    createNativeWorkflowTemplate,
    previewAutopilotNativeMigration,
    validateWorkflowDefinition,
    type ModelConfiguration,
    type NativeWorkflowTemplate,
    type WorkflowDefinition,
    WorkflowExecutor,
    createDefaultNodeHandlerRegistry,
    hashValue,
    modelChainForNode,
    createWorkflowNode,
    ModelConfigurationSchema,
    prepareWorkflowBlockTest,
    createWorkflowBlockTestSideEffectAdapters,
    type WorkflowBlockTestFixtures,
} from '@/services/workflow-runtime';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import {
    getPrimaryWorkflowModelId,
    resolveWorkflowAwareModelId,
    synchronizeWorkflowModelState,
} from '@/services/workflow-runtime/model-selection';
import {
    reconcileNativeWorkflowTools,
    synchronizeNativeWorkflowToolState,
} from '@/services/workflow-runtime/native-agent-tools';
import { selectNativeKnowledgeDocuments } from '@/services/workflow-runtime/native-knowledge-references';
import { importEcosystemPatternForWorkspace } from '@/services/autopilot/ecosystem-patterns';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import {
    assertSafeAutopilotWebhookUrl,
    sanitizeAutopilotRules,
} from '@/services/autopilot/automation-rules';


async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
    return hasWorkspacePermission(userId, workspaceId, 'automations:manage');
}

async function ensureAutopilotToolColumns(): Promise<void> {
    // Schema changes are applied by Prisma migrations before requests are served.
}

async function ensureAutopilotVersioningTables(): Promise<void> {
    // Schema changes are applied by Prisma migrations before requests are served.
}

function parseKnowledgeBaseDocuments(raw: unknown): KnowledgeBaseDocument[] {
    if (!raw) return [];
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeEnabledToolNames(raw: unknown): string[] {
    const parsed = typeof raw === 'string'
        ? (() => {
            try {
                return JSON.parse(raw);
            } catch {
                return [];
            }
        })()
        : raw;

    return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
}

function parseKnowledgeCollections(raw: unknown): KnowledgeCollection[] {
    if (!raw) return [];
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseFlowGraph(raw: unknown): AutopilotFlowGraph | null {
    const parsed = typeof raw === 'string'
        ? (() => {
            try {
                return JSON.parse(raw);
            } catch {
                return null;
            }
        })()
        : raw;

    if (!parsed || typeof parsed !== 'object') return null;
    const graph = parsed as Partial<AutopilotFlowGraph>;
    if (graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
    return migrateAutopilotFlowGraphToV2(graph as AutopilotFlowGraph);
}

function readFormBoolean(formData: FormData, field: string, fallback = false): boolean {
    if (!formData.has(field)) return fallback;
    const value = formData.get(field);
    const normalized = typeof value === 'string' ? value : '';
    return normalized === 'true' || normalized === 'on' || normalized === '1';
}

function normalizeWorkflowRuntimeV2Mode(value: unknown): 'off' | 'shadow' | 'primary' {
    return value === 'shadow' || value === 'primary' ? value : 'off';
}

function normalizeWorkflowBuilderMode(value: unknown): 'legacy' | 'native_v2' {
    // The legacy editor/runtime format is read-only historical data after the
    // native cutover. Every editable configuration is normalized to V2.
    void value;
    return 'native_v2';
}

function workflowModelConfiguration(modelValue: unknown): ModelConfiguration {
    const model = typeof modelValue === 'string' && modelValue.trim()
        ? modelValue.trim()
        : process.env.DEFAULT_AUTOPILOT_MODEL || 'gemini-2.0-flash';
    return {
        provider: getAiModelRuntimeProvider(model),
        model,
        temperature: 0.2,
        maxOutputTokens: 2048,
        supportsTools: true,
        supportsStructuredOutput: true,
        supportsStreaming: true,
        timeoutMs: 60_000,
        maxRetries: 2,
    };
}

function parseWorkflowDefinition(raw: unknown) {
    if (!raw) return null;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const result = WorkflowDefinitionSchema.safeParse(parsed);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
}

function normalizeInactivityTimeoutSeconds(value: unknown, fallback: number | null = null): number | null {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.min(2_592_000, parsed);
}

async function resolveApiKeyForModel(input: {
    config: { workspace_id?: string | null; gemini_api_key?: string | null };
    workspaceGeminiApiKey?: string | null;
    model: string;
}): Promise<string | undefined> {
    const targetProvider = getAiModelRuntimeProvider(input.model);
    const apiKeyCandidates = await resolveAiProviderKeyCandidates({
        config: input.config,
        workspaceGeminiApiKey: input.workspaceGeminiApiKey,
    });
    return apiKeyCandidates.find(candidate => (
        !candidate.provider || candidate.provider === targetProvider
    ))?.key;
}

function buildSnapshotFromConfigRow(row: any): AutopilotConfigDraftSnapshot {
    return {
        name: row.name || 'Meu agente de IA',
        gemini_api_key: null,
        ai_model: row.ai_model || null,
        transcription_model: row.transcription_model || null,
        knowledge_base: row.knowledge_base || null,
        knowledge_base_documents: parseKnowledgeBaseDocuments(row.knowledge_base_documents),
        knowledge_collections: parseKnowledgeCollections(row.knowledge_collections),
        is_active: Boolean(row.is_active),
        is_private: Boolean(row.is_private),
        default_fallback_reply: row.default_fallback_reply || null,
        escalation_policy: row.escalation_policy || null,
        closing_policy: row.closing_policy || null,
        inactivity_timeout_seconds: normalizeInactivityTimeoutSeconds(row.inactivity_timeout_seconds, null),
        enabled_tool_names: normalizeEnabledToolNames(row.enabled_tool_names),
        flow_graph: parseFlowGraph(row.flow_graph),
        workflow_runtime_v2_mode: normalizeWorkflowRuntimeV2Mode(row.workflow_runtime_v2_mode),
        workflow_builder_mode: normalizeWorkflowBuilderMode(row.workflow_builder_mode),
        workflow_definition: null,
        workflow_migration: null,
    };
}

function normalizeDraftSnapshot(
    raw: unknown,
    fallback: AutopilotConfigDraftSnapshot,
): AutopilotConfigDraftSnapshot {
    const snapshot = raw && typeof raw === 'object' ? raw as Partial<AutopilotConfigDraftSnapshot> : {};
    const hasOwn = (key: keyof AutopilotConfigDraftSnapshot) =>
        Object.prototype.hasOwnProperty.call(snapshot, key);

    return synchronizeNativeWorkflowToolState(synchronizeWorkflowModelState({
        name: typeof snapshot.name === 'string' && snapshot.name.trim().length > 0
            ? snapshot.name
            : fallback.name,
        gemini_api_key: null,
        ai_model: hasOwn('ai_model')
            ? (typeof snapshot.ai_model === 'string' && snapshot.ai_model.length > 0 ? snapshot.ai_model : null)
            : fallback.ai_model,
        transcription_model: hasOwn('transcription_model')
            ? (typeof snapshot.transcription_model === 'string' && snapshot.transcription_model.length > 0 ? snapshot.transcription_model : null)
            : fallback.transcription_model || null,
        knowledge_base: hasOwn('knowledge_base')
            ? (typeof snapshot.knowledge_base === 'string' && snapshot.knowledge_base.length > 0 ? snapshot.knowledge_base : null)
            : fallback.knowledge_base,
        knowledge_base_documents: Array.isArray(snapshot.knowledge_base_documents)
            ? snapshot.knowledge_base_documents
            : fallback.knowledge_base_documents,
        knowledge_collections: Array.isArray(snapshot.knowledge_collections)
            ? snapshot.knowledge_collections
            : fallback.knowledge_collections || [],
        is_active: hasOwn('is_active') ? Boolean(snapshot.is_active) : fallback.is_active,
        is_private: hasOwn('is_private') ? Boolean(snapshot.is_private) : fallback.is_private,
        default_fallback_reply: hasOwn('default_fallback_reply')
            ? (typeof snapshot.default_fallback_reply === 'string' && snapshot.default_fallback_reply.length > 0 ? snapshot.default_fallback_reply : null)
            : fallback.default_fallback_reply,
        escalation_policy: hasOwn('escalation_policy')
            ? (typeof snapshot.escalation_policy === 'string' && snapshot.escalation_policy.length > 0 ? snapshot.escalation_policy : null)
            : fallback.escalation_policy,
        closing_policy: hasOwn('closing_policy')
            ? (typeof snapshot.closing_policy === 'string' && snapshot.closing_policy.length > 0 ? snapshot.closing_policy : null)
            : fallback.closing_policy,
        inactivity_timeout_seconds: hasOwn('inactivity_timeout_seconds')
            ? normalizeInactivityTimeoutSeconds(snapshot.inactivity_timeout_seconds, null)
            : normalizeInactivityTimeoutSeconds(fallback.inactivity_timeout_seconds, null),
        enabled_tool_names: Array.isArray(snapshot.enabled_tool_names)
            ? normalizeEnabledToolNames(snapshot.enabled_tool_names)
            : fallback.enabled_tool_names,
        flow_graph: hasOwn('flow_graph')
            ? parseFlowGraph(snapshot.flow_graph)
            : fallback.flow_graph || null,
        workflow_runtime_v2_mode: hasOwn('workflow_runtime_v2_mode')
            ? normalizeWorkflowRuntimeV2Mode(snapshot.workflow_runtime_v2_mode)
            : normalizeWorkflowRuntimeV2Mode(fallback.workflow_runtime_v2_mode),
        workflow_builder_mode: hasOwn('workflow_builder_mode')
            ? normalizeWorkflowBuilderMode(snapshot.workflow_builder_mode)
            : normalizeWorkflowBuilderMode(fallback.workflow_builder_mode),
        workflow_definition: hasOwn('workflow_definition')
            ? parseWorkflowDefinition(snapshot.workflow_definition)
            : parseWorkflowDefinition(fallback.workflow_definition),
        workflow_migration: hasOwn('workflow_migration') && snapshot.workflow_migration
            ? snapshot.workflow_migration
            : fallback.workflow_migration || null,
    }));
}

async function buildSnapshotFromFormData(
    formData: FormData,
    fallback: AutopilotConfigDraftSnapshot,
): Promise<AutopilotConfigDraftSnapshot> {
    const workspaceId = formData.get('workspaceId')?.toString() || '';
    const requestedWorkflowBuilderMode = formData.has('workflowBuilderMode')
        ? normalizeWorkflowBuilderMode(formData.get('workflowBuilderMode')?.toString())
        : normalizeWorkflowBuilderMode(fallback.workflow_builder_mode);
    const requestedWorkflowDefinition = formData.has('workflowDefinition')
        ? parseWorkflowDefinition(formData.get('workflowDefinition')?.toString())
        : parseWorkflowDefinition(fallback.workflow_definition);
    const requestedModel = resolveWorkflowAwareModelId({
        ai_model: formData.get('aiModel')?.toString() || fallback.ai_model,
        workflow_builder_mode: requestedWorkflowBuilderMode,
        workflow_definition: requestedWorkflowDefinition,
    }) || '';
    if (requestedModel && !(await isAllowedModelForWorkspace(workspaceId, requestedModel))) {
        throw new Error('Modelo de IA nao esta habilitado no catalogo global ou nas integracoes do workspace.');
    }

    let documents = fallback.knowledge_base_documents;
    if (formData.has('knowledgeBaseDocuments')) {
        const parsedDocs = parseKnowledgeBaseDocuments(formData.get('knowledgeBaseDocuments')?.toString() || '[]');
        documents = parsedDocs;
    }
    const collections = formData.has('knowledgeCollections')
        ? parseKnowledgeCollections(formData.get('knowledgeCollections')?.toString() || '[]')
        : fallback.knowledge_collections || [];

    return synchronizeNativeWorkflowToolState({
        name: formData.get('agentName')?.toString() || fallback.name || 'Meu agente de IA',
        gemini_api_key: null,
        ai_model: requestedModel || null,
        transcription_model: fallback.transcription_model || null,
        knowledge_base: formData.has('knowledgeBase')
            ? (formData.get('knowledgeBase')?.toString() || null)
            : fallback.knowledge_base,
        knowledge_base_documents: documents,
        knowledge_collections: collections,
        is_active: readFormBoolean(formData, 'isActive', fallback.is_active),
        is_private: readFormBoolean(formData, 'isPrivate', fallback.is_private),
        default_fallback_reply: formData.has('defaultFallbackReply')
            ? (formData.get('defaultFallbackReply')?.toString() || null)
            : fallback.default_fallback_reply,
        escalation_policy: formData.has('escalationPolicy')
            ? (formData.get('escalationPolicy')?.toString() || null)
            : fallback.escalation_policy,
        closing_policy: formData.has('closingPolicy')
            ? (formData.get('closingPolicy')?.toString() || null)
            : fallback.closing_policy,
        inactivity_timeout_seconds: formData.has('inactivityTimeoutSeconds')
            ? normalizeInactivityTimeoutSeconds(formData.get('inactivityTimeoutSeconds'), null)
            : normalizeInactivityTimeoutSeconds(fallback.inactivity_timeout_seconds, null),
        enabled_tool_names: formData.has('enabledToolNames')
            ? normalizeEnabledToolNames(formData.get('enabledToolNames')?.toString() || '[]')
            : fallback.enabled_tool_names,
        flow_graph: formData.has('flowGraph')
            ? parseFlowGraph(formData.get('flowGraph')?.toString() || '')
            : fallback.flow_graph || null,
        workflow_runtime_v2_mode: formData.has('workflowRuntimeV2Mode')
            ? normalizeWorkflowRuntimeV2Mode(formData.get('workflowRuntimeV2Mode')?.toString())
            : normalizeWorkflowRuntimeV2Mode(fallback.workflow_runtime_v2_mode),
        workflow_builder_mode: requestedWorkflowBuilderMode,
        workflow_definition: requestedWorkflowDefinition,
        workflow_migration: fallback.workflow_migration || null,
    });
}

async function reindexChangedKnowledgeDocuments({
    workspaceId,
    configId,
    previousDocs,
    nextDocs,
}: {
    workspaceId: string;
    configId: string;
    previousDocs: KnowledgeBaseDocument[];
    nextDocs: KnowledgeBaseDocument[];
}): Promise<{ failedDocumentNames: string[] }> {
    const previousById = new Map(previousDocs.map((doc) => [doc.id, doc]));
    const nextById = new Map(nextDocs.map((doc) => [doc.id, doc]));

    const removedDocs = previousDocs.filter((doc) => !nextById.has(doc.id));
    const changedDocs = nextDocs.filter((doc) => {
        const previous = previousById.get(doc.id);
        return hasKnowledgeDocumentIndexChanged(previous, doc);
    });
    const failedDocumentNames = new Set<string>();

    await Promise.all(
        removedDocs.map((doc) =>
            VectorStore.deleteDocumentEmbeddings({
                documentId: doc.id,
                workspaceId,
                autopilotConfigId: configId,
            }).catch((ragError) => {
                console.error('[RAG] Failed to remove document embeddings:', ragError);
                failedDocumentNames.add(doc.name || doc.id);
            })
        )
    );

    for (const doc of changedDocs) {
        const content = (doc.content || '').trim();
        if (!content) {
            await VectorStore.deleteDocumentEmbeddings({
                documentId: doc.id,
                workspaceId,
                autopilotConfigId: configId,
            }).catch((ragError) => {
                console.error('[RAG] Failed to clear empty document embeddings:', ragError);
                failedDocumentNames.add(doc.name || doc.id);
            });
            continue;
        }

        try {
            await VectorStore.deleteDocumentEmbeddings({
                documentId: doc.id,
                workspaceId,
                autopilotConfigId: configId,
            });
            if (shouldEnqueueJob('ai_document_ingest')) {
                try {
                    await enqueueAiDocumentIngest({
                        workspaceId,
                        autopilotConfigId: configId,
                        documentId: doc.id,
                        documentName: doc.name || 'Documento',
                        content,
                        document: doc,
                    });
                } catch (queueError) {
                    console.warn('[RAG] Queue unavailable; ingesting document synchronously:', queueError);
                    await ingestKnowledgeBaseDocument({
                        workspaceId,
                        autopilotConfigId: configId,
                        documentId: doc.id,
                        documentName: doc.name || 'Documento',
                        content,
                        document: doc,
                    });
                }
            } else {
                await ingestKnowledgeBaseDocument({
                    workspaceId,
                    autopilotConfigId: configId,
                    documentId: doc.id,
                    documentName: doc.name || 'Documento',
                    content,
                    document: doc,
                });
            }
        } catch (ragError) {
            console.error('[RAG] Failed to reindex knowledge document:', ragError);
            failedDocumentNames.add(doc.name || doc.id);
        }
    }
    return { failedDocumentNames: [...failedDocumentNames] };
}

export async function getAutopilotRagHealth(configId: string): Promise<{
    health: AutopilotRagHealth | null;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { health: null, error: 'Usuario nao autenticado.' };

    try {
        const configRes = await db.query(
            `SELECT id, workspace_id, knowledge_base_documents, knowledge_collections
             FROM autopilot_configs
             WHERE id = $1
             LIMIT 1`,
            [configId]
        );
        if (configRes.rowCount === 0) return { health: null, error: 'Agente nao encontrado.' };

        const config = configRes.rows[0];
        const workspaceId = String(config.workspace_id);
        if (!await isWorkspaceMember(user.id, workspaceId)) {
            return { health: null, error: 'Acesso nao autorizado.' };
        }

        const publishedDocuments = parseKnowledgeBaseDocuments(config.knowledge_base_documents)
            .filter((document) => Boolean(document.id && document.content?.trim()));
        const quarantinedDocuments = publishedDocuments.filter((document) => isUnsafeAsCustomerFacingKnowledge(document));
        const documents = publishedDocuments.filter((document) => !isUnsafeAsCustomerFacingKnowledge(document));
        const documentIds = documents.map((document) => document.id);
        const statsRes = documentIds.length > 0
            ? await db.query(
                `SELECT
                    document_id::text AS document_id,
                    COUNT(*)::int AS chunks,
                    COUNT(*) FILTER (
                        WHERE vector_dims(vector) <> ${DOCUMENT_EMBEDDING_DIMENSIONS}
                           OR COALESCE(metadata->>'embeddingModel', '') <> $4
                           OR COALESCE(metadata->>'contentFormat', '') <> 'markdown'
                    )::int AS wrong_dims
                 FROM embeddings_documents
                 WHERE workspace_id = $1
                   AND autopilot_config_id = $2
                   AND document_id::text = ANY($3::text[])
                 GROUP BY document_id`,
                [workspaceId, configId, documentIds, DOCUMENT_EMBEDDING_MODEL]
            )
            : { rows: [] };
        const indexedIds = new Set(
            statsRes.rows
                .filter((row) => Number(row.chunks) > 0 && Number(row.wrong_dims) === 0)
                .map((row) => String(row.document_id))
        );
        const indexedChunks = statsRes.rows.reduce((total, row) => total + Number(row.chunks || 0), 0);
        const wrongDimensionChunks = statsRes.rows.reduce((total, row) => total + Number(row.wrong_dims || 0), 0);
        const staleRes = await db.query(
            `SELECT COUNT(DISTINCT document_id)::int AS documents
             FROM embeddings_documents
             WHERE workspace_id = $1
               AND autopilot_config_id = $2
               AND ($3::text[] = '{}'::text[] OR NOT (document_id::text = ANY($3::text[])))`,
            [workspaceId, configId, documentIds]
        );
        const logRes = await db.query(
            `SELECT COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS recent,
                    MAX(created_at) AS last_retrieval_at
             FROM rag_retrieval_logs
             WHERE workspace_id = $1 AND autopilot_config_id = $2`,
            [workspaceId, configId]
        ).catch(() => ({ rows: [{ recent: 0, last_retrieval_at: null }] }));
        const collections = parseKnowledgeCollections(config.knowledge_collections);
        const normalizedCollections = collections.some((collection) => collection.id === 'general')
            ? collections
            : [{ id: 'general', name: 'Geral', isDefault: true }, ...collections];

        return {
            health: {
                configuredDocuments: documents.length,
                indexedDocuments: indexedIds.size,
                indexedChunks,
                missingDocuments: documents.filter((document) => !indexedIds.has(document.id)).length,
                quarantinedDocuments: quarantinedDocuments.length,
                staleDocuments: Number(staleRes.rows[0]?.documents || 0),
                wrongDimensionChunks,
                recentRetrievals: Number(logRes.rows[0]?.recent || 0),
                lastRetrievalAt: logRes.rows[0]?.last_retrieval_at
                    ? new Date(logRes.rows[0].last_retrieval_at).toISOString()
                    : null,
                collections: normalizedCollections.map((collection) => {
                    const collectionDocuments = documents.filter((document) => (
                        (document.collectionIds?.length ? document.collectionIds : ['general']).includes(collection.id)
                    ));
                    return {
                        id: collection.id,
                        name: collection.name,
                        documents: collectionDocuments.length,
                        indexedDocuments: collectionDocuments.filter((document) => indexedIds.has(document.id)).length,
                    };
                }),
            },
        };
    } catch (error) {
        console.error('[GET_AUTOPILOT_RAG_HEALTH] Erro ao carregar saude do indice:', error);
        return { health: null, error: 'Falha ao carregar saude do indice RAG.' };
    }
}

export async function reindexAutopilotKnowledgeBase(configId: string): Promise<{
    success: boolean;
    queued?: number;
    removedStaleDocuments?: number;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuario nao autenticado.' };

    try {
        const configRes = await db.query(
            `SELECT id, workspace_id, knowledge_base_documents
             FROM autopilot_configs
             WHERE id = $1
             LIMIT 1`,
            [configId]
        );
        if (configRes.rowCount === 0) return { success: false, error: 'Agente nao encontrado.' };

        const config = configRes.rows[0];
        const workspaceId = String(config.workspace_id);
        if (!await isWorkspaceMember(user.id, workspaceId)) {
            return { success: false, error: 'Acesso nao autorizado.' };
        }

        const publishedDocuments = parseKnowledgeBaseDocuments(config.knowledge_base_documents)
            .filter((document) => Boolean(document.id && document.content?.trim()));
        const quarantinedDocuments = publishedDocuments.filter((document) => isUnsafeAsCustomerFacingKnowledge(document));
        const documents = publishedDocuments.filter((document) => !isUnsafeAsCustomerFacingKnowledge(document));
        const documentIds = documents.map((document) => document.id);
        await Promise.all(quarantinedDocuments.map((document) => VectorStore.deleteDocumentEmbeddings({
            documentId: document.id,
            workspaceId,
            autopilotConfigId: configId,
        })));
        const staleDeleteRes = await db.query(
            `DELETE FROM embeddings_documents
             WHERE workspace_id = $1
               AND autopilot_config_id = $2
               AND ($3::text[] = '{}'::text[] OR NOT (document_id::text = ANY($3::text[])))
             RETURNING document_id`,
            [workspaceId, configId, documentIds]
        );
        const runKey = `repair_${Date.now()}`;

        for (const document of documents) {
            if (shouldEnqueueJob('ai_document_ingest')) {
                await enqueueAiDocumentIngest({
                    workspaceId,
                    autopilotConfigId: configId,
                    documentId: document.id,
                    documentName: document.name || 'Documento',
                    content: document.content,
                    document,
                    jobKey: runKey,
                });
            } else {
                await ingestKnowledgeBaseDocument({
                    workspaceId,
                    autopilotConfigId: configId,
                    documentId: document.id,
                    documentName: document.name || 'Documento',
                    content: document.content,
                    document,
                });
            }
        }

        revalidatePath(`/autopilot/${configId}`);
        return {
            success: true,
            queued: documents.length,
            removedStaleDocuments: new Set(staleDeleteRes.rows.map((row) => String(row.document_id))).size,
        };
    } catch (error) {
        console.error('[REINDEX_AUTOPILOT_KNOWLEDGE] Erro ao reparar indice:', error);
        return { success: false, error: 'Falha ao reindexar a base de conhecimento.' };
    }
}

export async function runAutopilotRagLab(configId: string): Promise<{
    report: RagLabReport | null;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { report: null, error: 'Usuario nao autenticado.' };

    try {
        const configRes = await db.query(
            `SELECT *
             FROM autopilot_configs
             WHERE id = $1
             LIMIT 1`,
            [configId]
        );
        if (configRes.rowCount === 0) return { report: null, error: 'Agente nao encontrado.' };

        const row = configRes.rows[0];
        const workspaceId = String(row.workspace_id);
        if (!await isWorkspaceMember(user.id, workspaceId)) {
            return { report: null, error: 'Acesso nao autorizado.' };
        }

        const safeDocuments = parseKnowledgeBaseDocuments(row.knowledge_base_documents)
            .filter((document) => document.content?.trim() && !isUnsafeAsCustomerFacingKnowledge(document));
        const config = {
            ...row,
            knowledge_base_documents: safeDocuments,
            knowledge_collections: parseKnowledgeCollections(row.knowledge_collections),
            flow_graph: parseFlowGraph(row.flow_graph),
        } as AutopilotConfig;
        const cases = buildRagLabCases(safeDocuments);
        const results: RagLabCaseResult[] = [];

        for (const evalCase of cases) {
            const intent = resolveAutopilotIntent({
                customerMessage: evalCase.customerMessage,
                knowledgeDocuments: safeDocuments,
            });
            const scope = resolveActiveFlowIntentScope(config, intent.intent);
            const scopedDocuments = filterKnowledgeDocumentsForScope(config, safeDocuments, scope);
            const allowedDocumentIds = resolveAllowedKnowledgeDocumentIds({
                config,
                documents: safeDocuments,
                intentScope: scope,
            });
            const retrieval = await retrieveHybridSupportContext({
                workspaceId,
                autopilotConfigId: configId,
                query: evalCase.customerMessage,
                staticDocuments: scopedDocuments,
                intent,
                allowedDocumentIds,
            });
            const selectedDocuments = retrieval.selected.map((document) => ({
                id: document.id,
                name: document.name,
                score: document.score,
                source: document.source,
            }));
            const selectedIds = selectedDocuments.map((document) => document.id);
            const collectionLeakDetected = Boolean(
                allowedDocumentIds && selectedIds.some((documentId) => !allowedDocumentIds.includes(documentId))
            );
            const top1Passed = selectedIds[0] === evalCase.expectedDocumentId;
            const top3Passed = selectedIds.slice(0, 3).includes(evalCase.expectedDocumentId);
            const intentPassed = intent.intent === evalCase.expectedIntent;

            results.push({
                ...evalCase,
                actualIntent: intent.intent,
                activeSubAgent: scope?.title || null,
                allowedCollectionIds: scope?.knowledgeCollectionIds || null,
                knowledgeCoverage: retrieval.knowledgeCoverage,
                selectedDocuments,
                top1Passed,
                top3Passed,
                intentPassed,
                collectionLeakDetected,
                passed: top3Passed && intentPassed && !collectionLeakDetected,
            });
        }

        return { report: summarizeRagLabResults(results) };
    } catch (error) {
        console.error('[RUN_AUTOPILOT_RAG_LAB] Erro ao avaliar RAG:', error);
        return { report: null, error: 'Falha ao executar laboratorio RAG.' };
    }
}

export async function improveAutopilotKnowledgeDocument(
    configId: string,
    document: KnowledgeBaseDocument,
): Promise<{ document: KnowledgeBaseDocument | null; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { document: null, error: 'Usuario nao autenticado.' };

    try {
        const configRes = await db.query(
            `SELECT id, workspace_id, gemini_api_key, enabled_tool_names
             FROM autopilot_configs
             WHERE id = $1
             LIMIT 1`,
            [configId],
        );
        if (configRes.rowCount === 0) return { document: null, error: 'Agente nao encontrado.' };
        const config = configRes.rows[0];
        const workspaceId = String(config.workspace_id);
        if (!await isWorkspaceMember(user.id, workspaceId)) {
            return { document: null, error: 'Acesso nao autorizado.' };
        }
        if (!document.content?.trim()) {
            return { document: null, error: 'Adicione conteudo antes de solicitar a melhoria.' };
        }

        const runtime = await resolveWorkspaceAiExecutionContext(workspaceId, configId);
        const modelApiKeyCandidates = await resolveAiProviderKeyCandidates({
            config,
            workspaceGeminiApiKey: runtime.workspaceGeminiApiKey,
        });
        const improved = await improveKnowledgeDocumentForRag({
            document,
            model: runtime.model,
            apiKeyCandidates: modelApiKeyCandidates,
        });
        const requiredTools = Array.from(new Set([
            ...(document.requiredTools || []),
            ...improved.requiredTools,
            ...Array.from(improved.content.matchAll(/@([a-zA-Z0-9_.:-]+)/g)).map((match) => match[1]),
        ]));

        return {
            document: {
                ...document,
                name: improved.name,
                content: improved.content,
                summary: improved.summary,
                category: improved.category,
                tags: improved.tags,
                contextRole: improved.contextRole,
                canonicalAnswer: improved.canonicalAnswer || null,
                workflowHints: improved.workflowHints,
                requiredTools,
                sourceFormat: 'markdown',
                updatedAt: new Date().toISOString(),
            },
        };
    } catch (error) {
        console.error('[IMPROVE_AUTOPILOT_KNOWLEDGE] Falha ao melhorar documento:', error);
        return {
            document: null,
            error: error instanceof Error ? error.message : 'Falha ao melhorar documento com IA.',
        };
    }
}

export async function getWorkspaceAiRuntimeConfig(workspaceId: string): Promise<{
    apiKey: string | null,
    aiModel: string | null,
    hasGlobalKey: boolean,
    error?: string,
}> {
    const hasGlobalKey = !!(process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return {
            apiKey: null,
            aiModel: null,
            hasGlobalKey,
            error: 'Usuário não autenticado.',
        };
    }

    if (!await isWorkspaceMember(user.id, workspaceId)) {
        return {
            apiKey: null,
            aiModel: null,
            hasGlobalKey,
            error: 'Acesso não autorizado.',
        };
    }

    try {
        const integrationRes = await db.query(`
            SELECT config, is_active
            FROM workspace_integrations
            WHERE workspace_id = $1 AND provider = 'gemini'
            LIMIT 1
        `, [workspaceId]);

        if (integrationRes.rows.length > 0 && integrationRes.rows[0].is_active) {
            const integrationConfig = integrationRes.rows[0].config || {};
            const apiKey = typeof integrationConfig.apiKey === 'string' && integrationConfig.apiKey.trim().length > 0
                ? integrationConfig.apiKey.trim()
                : null;
            const aiModel = typeof integrationConfig.aiModel === 'string' && integrationConfig.aiModel.trim().length > 0
                ? normalizeGoogleAiModelId(integrationConfig.aiModel)
                : null;
            if (apiKey || aiModel) {
                return { apiKey, aiModel, hasGlobalKey };
            }
        }

        return {
            apiKey: null,
            aiModel: null,
            hasGlobalKey,
        };
    } catch (error) {
        console.error(`[GET_WORKSPACE_AI_RUNTIME_CONFIG] Erro ao resolver config do workspace ${workspaceId}:`, error);
        return {
            apiKey: null,
            aiModel: null,
            hasGlobalKey,
            error: 'Falha ao buscar configuração de IA do workspace.',
        };
    }
}

async function listWorkspaceAgentToolCatalog(workspaceId: string): Promise<AgentToolCatalogItem[]> {
    const mcpTools = await listMcpToolsForWorkspace(workspaceId);
    const mcpCatalogItems: AgentToolCatalogItem[] = mcpTools.map((tool) => {
        const safety = classifyMcpToolSafety(tool.qualifiedName, tool);
        return {
            name: tool.qualifiedName as AgentToolCatalogItem['name'],
            displayName: tool.title || undefined,
            category: 'mcp',
            version: 'mcp',
            description: tool.description || tool.title || `Ferramenta MCP ${tool.name} em ${tool.serverName}.`,
            class: safety.class,
            riskLevel: safety.riskLevel,
            sideEffect: safety.sideEffect,
            idempotent: safety.idempotent,
            timeoutMs: resolveMcpToolTimeoutMs(),
            maxAttempts: 1,
            requiresHumanApproval: safety.requiresHumanApproval,
            customerVisible: true,
            allowedIntents: [],
            requiredSlots: [],
            fallbackAction: 'handoff',
            source: 'mcp',
            enabledByDefault: false,
            serverId: tool.serverId,
            serverName: tool.serverName,
            inputSchema: tool.inputSchema || null,
            outputSchema: tool.outputSchema || null,
        };
    });

    return [...listAgentToolCatalogItems(), ...mcpCatalogItems];
}

export async function getAgentToolCatalogAction(workspaceId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { tools: [], error: 'UsuÃ¡rio nÃ£o autenticado.' };
    }
    if (!await isWorkspaceMember(user.id, workspaceId)) {
        return { tools: [], error: 'Acesso nÃ£o autorizado.' };
    }

    return { tools: await listWorkspaceAgentToolCatalog(workspaceId) };
}

export async function generateAutopilotFlowWithAi(input: {
    configId: string;
    conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
    currentGraph?: AutopilotFlowGraph | null;
    currentSystemPrompt?: string | null;
    knowledgeDocuments?: KnowledgeBaseDocument[] | null;
    knowledgeCollections?: KnowledgeCollection[] | null;
    enabledToolNames?: string[] | null;
    model?: string | null;
}): Promise<{ proposal: AutopilotFlowAiProposal | null; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { proposal: null, error: 'Usuario nao autenticado.' };

    try {
        const configRes = await db.query(
            `SELECT id, workspace_id, gemini_api_key, enabled_tool_names, knowledge_base_documents, knowledge_collections
             FROM autopilot_configs
             WHERE id = $1
             LIMIT 1`,
            [input.configId],
        );
        if (configRes.rowCount === 0) return { proposal: null, error: 'Agente nao encontrado.' };
        const config = configRes.rows[0];
        const workspaceId = String(config.workspace_id);
        if (!await isWorkspaceMember(user.id, workspaceId)) {
            return { proposal: null, error: 'Acesso nao autorizado.' };
        }

        const conversation = input.conversation
            .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content?.trim())
            .slice(-12)
            .map((message) => ({ role: message.role, content: message.content.trim().slice(0, 12000) }));
        if (!conversation.some((message) => message.role === 'user')) {
            return { proposal: null, error: 'Descreva o fluxo que deseja construir.' };
        }

        const [runtime, catalog] = await Promise.all([
            resolveWorkspaceAiExecutionContext(workspaceId, input.configId),
            getAgentToolCatalogAction(workspaceId),
        ]);
        if (catalog.error) return { proposal: null, error: catalog.error };
        const scopedTools = selectFlowBuilderTools({
            catalog: catalog.tools,
            requestedEnabledToolNames: input.enabledToolNames,
            persistedEnabledToolNames: config.enabled_tool_names,
            mode: 'all_eligible',
        });

        let targetModel = runtime.model;
        if (input.model) {
            const resolved = await resolveAutopilotModelFromCatalog(input.model);
            targetModel = resolved.model;
        }

        const modelApiKey = await resolveApiKeyForModel({
            config,
            workspaceGeminiApiKey: runtime.workspaceGeminiApiKey,
            model: targetModel,
        });
        const knowledgeDocuments = Array.isArray(input.knowledgeDocuments)
            ? input.knowledgeDocuments
            : parseKnowledgeBaseDocuments(config.knowledge_base_documents);
        const knowledgeCollections = Array.isArray(input.knowledgeCollections)
            ? input.knowledgeCollections
            : parseKnowledgeCollections(config.knowledge_collections);

        const proposal = await generateAutopilotFlowProposal({
            conversation,
            currentGraph: input.currentGraph || null,
            currentSystemPrompt: input.currentSystemPrompt || '',
            tools: scopedTools,
            knowledgeDocuments,
            knowledgeCollections,
            model: targetModel,
            apiKey: modelApiKey,
        });
        return { proposal };
    } catch (error) {
        console.error('[AUTOPILOT_FLOW_BUILDER_AI] Falha ao gerar proposta:', error);
        return {
            proposal: null,
            error: error instanceof Error ? error.message : 'Falha ao construir flow com IA.',
        };
    }
}

async function loadNativeWorkflowEditContext(configId: string, userId: string) {
    const configRes = await db.query('SELECT * FROM autopilot_configs WHERE id = $1 LIMIT 1', [configId]);
    if (configRes.rowCount === 0) throw new Error('Automação não encontrada.');
    const config = configRes.rows[0];
    if (!await isWorkspaceMember(userId, String(config.workspace_id))) throw new Error('Acesso não autorizado.');
    const fallback = buildSnapshotFromConfigRow(config);
    const draftRes = await db.query(
        'SELECT snapshot FROM autopilot_config_drafts WHERE config_id = $1 LIMIT 1',
        [configId],
    );
    const snapshot = draftRes.rows[0]
        ? normalizeDraftSnapshot(draftRes.rows[0].snapshot, fallback)
        : fallback;
    if (!snapshot.workflow_definition && config.active_workflow_id && config.active_workflow_version) {
        snapshot.workflow_definition = await new PostgresWorkflowPersistence(db)
            .getWorkflowDefinition(config.active_workflow_id, config.active_workflow_version);
    }
    return { config, snapshot, workspaceId: String(config.workspace_id) };
}

async function persistNativeWorkflowDraft(input: {
    configId: string;
    workspaceId: string;
    userId: string;
    snapshot: AutopilotConfigDraftSnapshot;
}) {
    const synchronizedSnapshot = synchronizeNativeWorkflowToolState(
        synchronizeWorkflowModelState(input.snapshot),
    );
    const saved = await db.query(
        `INSERT INTO autopilot_config_drafts (config_id, workspace_id, user_id, snapshot, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, timezone('utc', now()))
         ON CONFLICT (config_id) DO UPDATE
         SET workspace_id = EXCLUDED.workspace_id,
             user_id = EXCLUDED.user_id,
             snapshot = EXCLUDED.snapshot,
             updated_at = timezone('utc', now())
         RETURNING updated_at`,
        [input.configId, input.workspaceId, input.userId, JSON.stringify(synchronizedSnapshot)],
    );
    revalidatePath(`/autopilot/${input.configId}`);
    return saved.rows[0]?.updated_at as string | undefined;
}

export async function previewAutopilotNativeWorkflowMigration(configId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { workflow: null, validation: null, error: 'Usuário não autenticado.' };
    try {
        const { config, snapshot, workspaceId } = await loadNativeWorkflowEditContext(configId, user.id);
        if (!snapshot.flow_graph) return { workflow: null, validation: null, error: 'O fluxo legado não está configurado.' };
        const result = previewAutopilotNativeMigration({
            configId,
            workspaceId,
            name: snapshot.name,
            graph: snapshot.flow_graph,
            model: workflowModelConfiguration(snapshot.ai_model || config.ai_model),
            persona: snapshot.knowledge_base,
            existingDefinition: snapshot.workflow_definition,
            existingSourceHash: snapshot.workflow_migration?.sourceHash,
        });
        return { ...result, error: undefined };
    } catch (error) {
        return {
            workflow: null,
            validation: null,
            error: error instanceof Error ? error.message : 'Falha ao preparar migração.',
        };
    }
}

export async function applyAutopilotNativeWorkflowMigration(configId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuário não autenticado.' };
    try {
        const { config, snapshot, workspaceId } = await loadNativeWorkflowEditContext(configId, user.id);
        if (!snapshot.flow_graph) return { success: false, error: 'O fluxo legado não está configurado.' };
        const result = previewAutopilotNativeMigration({
            configId,
            workspaceId,
            name: snapshot.name,
            graph: snapshot.flow_graph,
            model: workflowModelConfiguration(snapshot.ai_model || config.ai_model),
            persona: snapshot.knowledge_base,
            existingDefinition: snapshot.workflow_definition,
            existingSourceHash: snapshot.workflow_migration?.sourceHash,
        });
        const nextSnapshot: AutopilotConfigDraftSnapshot = {
            ...snapshot,
            workflow_builder_mode: 'native_v2',
            workflow_runtime_v2_mode: 'shadow',
            workflow_definition: result.workflow,
            workflow_migration: {
                source: 'legacy_flow_graph',
                sourceHash: result.sourceHash,
                migratedAt: new Date().toISOString(),
            },
        };
        const updatedAt = await persistNativeWorkflowDraft({ configId, workspaceId, userId: user.id, snapshot: nextSnapshot });
        return { success: true, workflow: result.workflow, validation: result.validation, updatedAt };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Falha ao aplicar migração.' };
    }
}

export async function createAutopilotNativeWorkflowDraft(input: {
    configId: string;
    template: NativeWorkflowTemplate;
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuário não autenticado.' };
    try {
        const { config, snapshot, workspaceId } = await loadNativeWorkflowEditContext(input.configId, user.id);
        const workflow = createNativeWorkflowTemplate({
            configId: input.configId,
            workspaceId,
            name: snapshot.name,
            model: workflowModelConfiguration(snapshot.ai_model || config.ai_model),
            persona: snapshot.knowledge_base || '',
            template: input.template,
        });
        const nextSnapshot: AutopilotConfigDraftSnapshot = {
            ...snapshot,
            workflow_builder_mode: 'native_v2',
            workflow_runtime_v2_mode: 'shadow',
            workflow_definition: workflow,
            workflow_migration: null,
        };
        const updatedAt = await persistNativeWorkflowDraft({
            configId: input.configId,
            workspaceId,
            userId: user.id,
            snapshot: nextSnapshot,
        });
        return { success: true, workflow, validation: validateWorkflowDefinition(workflow), updatedAt };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Falha ao criar automação nativa.' };
    }
}

export async function generateAutopilotNativeWorkflowWithAi(input: {
    configId: string;
    conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
    currentWorkflow?: unknown;
    enabledToolNames?: string[] | null;
}): Promise<{ proposal: NativeWorkflowAiProposal | null; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { proposal: null, error: 'Usuario nao autenticado.' };
    try {
        const { config, snapshot, workspaceId } = await loadNativeWorkflowEditContext(input.configId, user.id);
        const conversation = input.conversation
            .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content?.trim())
            .slice(-12)
            .map((message) => ({ role: message.role, content: message.content.trim().slice(0, 12_000) }));
        if (!conversation.some((message) => message.role === 'user')) {
            return { proposal: null, error: 'Descreva a automacao que deseja construir.' };
        }

        const parsedCurrent = input.currentWorkflow
            ? WorkflowDefinitionSchema.safeParse(input.currentWorkflow)
            : { success: true as const, data: snapshot.workflow_definition };
        if (!parsedCurrent.success) {
            return { proposal: null, error: 'O workflow atual esta inconsistente. Corrija os erros do canvas antes de pedir alteracoes a IA.' };
        }
        const currentWorkflow = parsedCurrent.data || snapshot.workflow_definition || null;
        const [runtime, catalog] = await Promise.all([
            resolveWorkspaceAiExecutionContext(workspaceId, input.configId),
            listWorkspaceAgentToolCatalog(workspaceId),
        ]);
        const scopedTools = selectFlowBuilderTools({
            catalog,
            requestedEnabledToolNames: input.enabledToolNames,
            persistedEnabledToolNames: snapshot.enabled_tool_names,
            mode: 'all_eligible',
        });
        const existingModelNode = currentWorkflow?.nodes.find((node) => node.type === 'ai.model');
        const existingModel = existingModelNode
            ? ModelConfigurationSchema.safeParse(existingModelNode.config)
            : null;
        const model = existingModel?.success
            ? existingModel.data
            : workflowModelConfiguration(snapshot.ai_model || runtime.model || config.ai_model);
        const modelNode = existingModelNode || createWorkflowNode('ai.model', {
            id: 'native_ai_builder_model',
            name: 'Modelo do construtor',
            position: { x: 0, y: 0 },
            config: model,
        });
        const runtimeConfig: AutopilotConfig = {
            ...config,
            id: String(config.id),
            workspace_id: workspaceId,
            user_id: String(config.user_id),
            name: String(config.name || snapshot.name),
            gemini_api_key: config.gemini_api_key || null,
            ai_model: config.ai_model || snapshot.ai_model || null,
            transcription_model: config.transcription_model || null,
            knowledge_base: config.knowledge_base || null,
            knowledge_base_documents: parseKnowledgeBaseDocuments(config.knowledge_base_documents),
            is_primary: Boolean(config.is_primary),
            is_active: Boolean(config.is_active),
            is_private: Boolean(config.is_private),
            default_fallback_reply: config.default_fallback_reply || null,
            escalation_policy: config.escalation_policy || null,
            closing_policy: config.closing_policy || null,
            created_at: new Date(config.created_at || Date.now()).toISOString(),
            updated_at: new Date(config.updated_at || Date.now()).toISOString(),
        };
        const chain = await modelChainForNode({ workspaceId, config: runtimeConfig, modelNode });
        const proposal = await generateNativeWorkflowAiProposal({
            configId: input.configId,
            workspaceId,
            name: snapshot.name,
            model,
            modelChain: chain,
            conversation,
            currentWorkflow,
            tools: scopedTools.map((tool) => ({
                name: String(tool.name),
                displayName: tool.displayName,
                category: tool.category,
                description: tool.description,
                source: tool.source,
                serverId: tool.serverId,
                serverName: tool.serverName,
                version: tool.version,
                class: tool.class,
                riskLevel: tool.riskLevel,
                sideEffect: tool.sideEffect,
                idempotent: tool.idempotent,
                timeoutMs: tool.timeoutMs,
                maxAttempts: tool.maxAttempts,
                requiresHumanApproval: tool.requiresHumanApproval,
                customerVisible: tool.customerVisible,
                enabledByDefault: tool.enabledByDefault,
                allowedIntents: tool.allowedIntents,
                requiredSlots: tool.requiredSlots,
                fallbackAction: tool.fallbackAction,
                inputSchema: tool.inputSchema,
                outputSchema: tool.outputSchema,
            })),
            knowledgeDocuments: (snapshot.knowledge_base_documents || []).map((document) => ({
                id: document.id,
                name: document.name,
                collectionIds: document.collectionIds,
            })),
            knowledgeCollections: (snapshot.knowledge_collections || []).map((collection) => ({
                id: collection.id,
                name: collection.name,
                description: collection.description || undefined,
            })),
        });
        // This action is preview-only. The caller must explicitly apply the proposal to local draft state.
        return { proposal };
    } catch (error) {
        console.error('[NATIVE_WORKFLOW_AI_BUILDER] Falha ao gerar proposta:', error);
        return {
            proposal: null,
            error: error instanceof Error ? error.message : 'Falha ao construir a automacao com IA.',
        };
    }
}

export async function runAutopilotNativeWorkflowTest(input: {
    configId: string;
    customerMessage: string;
    workflowDefinition?: WorkflowDefinition;
    startNodeId?: string;
    fixtures?: WorkflowBlockTestFixtures;
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuário não autenticado.' };
    try {
        const { config, snapshot, workspaceId } = await loadNativeWorkflowEditContext(input.configId, user.id);
        const requestedWorkflowInput = input.workflowDefinition
            ? WorkflowDefinitionSchema.parse(input.workflowDefinition)
            : snapshot.workflow_definition;
        if (!requestedWorkflowInput) return { success: false, error: 'O rascunho nativo não possui workflow.' };
        const [configuredModels, toolCatalog] = await Promise.all([
            listWorkspaceConfiguredAiModels(workspaceId),
            listWorkspaceAgentToolCatalog(workspaceId),
        ]);
        const toolReconciliation = reconcileNativeWorkflowTools(requestedWorkflowInput, toolCatalog);
        if (toolReconciliation.errors.length > 0) {
            return { success: false, error: toolReconciliation.errors.join(' ') };
        }
        const requestedWorkflow = toolReconciliation.workflow;
        const availableModelIds = configuredModels.map((model) => model.id);
        const sourceValidation = validateWorkflowDefinition(requestedWorkflow, { availableModelIds });
        if (!input.startNodeId && !sourceValidation.valid) return { success: false, error: sourceValidation.errors.map((issue) => issue.message).join(' ') };
        const timestamp = new Date().toISOString();
        const standardInput = { customerMessage: input.customerMessage, message: input.customerMessage, text: input.customerMessage };
        const prepared = input.startNodeId
            ? prepareWorkflowBlockTest({
                definition: requestedWorkflow,
                nodeId: input.startNodeId,
                fixtures: input.fixtures,
                input: standardInput,
                context: { sandbox: true, userId: user.id },
            })
            : null;
        const executableWorkflow = prepared?.workflow || requestedWorkflow;
        const workflow = WorkflowDefinitionSchema.parse({
            ...executableWorkflow,
            id: `autopilot:${input.configId}:sandbox`,
            workspaceId,
            version: `draft-${hashValue(executableWorkflow).slice(0, 16)}`,
            status: 'draft',
            updatedAt: timestamp,
        });
        const validation = validateWorkflowDefinition(workflow, { availableModelIds });
        if (!validation.valid) return { success: false, error: validation.errors.map((issue) => issue.message).join(' ') };
        const runtimeConfig: AutopilotConfig = {
            ...config,
            id: String(config.id),
            workspace_id: workspaceId,
            user_id: String(config.user_id),
            name: String(config.name || snapshot.name),
            gemini_api_key: config.gemini_api_key || null,
            ai_model: config.ai_model || snapshot.ai_model || null,
            transcription_model: config.transcription_model || null,
            knowledge_base: config.knowledge_base || null,
            knowledge_base_documents: snapshot.knowledge_base_documents
                .filter((document) => document.content?.trim() && !isUnsafeAsCustomerFacingKnowledge(document)),
            is_primary: Boolean(config.is_primary),
            is_active: Boolean(config.is_active),
            is_private: Boolean(config.is_private),
            default_fallback_reply: config.default_fallback_reply || null,
            escalation_policy: config.escalation_policy || null,
            closing_policy: config.closing_policy || null,
            created_at: new Date(config.created_at || Date.now()).toISOString(),
            updated_at: new Date(config.updated_at || Date.now()).toISOString(),
        };
        const sandboxSideEffects = createWorkflowBlockTestSideEffectAdapters();
        const handlers = createDefaultNodeHandlerRegistry({
            resolveModelChain: async (context) => modelChainForNode({
                workspaceId,
                config: runtimeConfig,
                modelNode: context.modelNode,
            }),
            loadMemory: async () => ({ sandbox: true }),
            retrieveKnowledge: async (context) => {
                const documents = selectNativeKnowledgeDocuments(
                    context.knowledgeNodes,
                    runtimeConfig.knowledge_base_documents || [],
                );
                if (documents.length === 0) return [];
                const retrieval = await retrieveHybridSupportContext({
                    workspaceId,
                    autopilotConfigId: input.configId,
                    query: input.customerMessage,
                    staticDocuments: documents,
                    allowedDocumentIds: documents.map((document) => document.id),
                });
                return retrieval.knowledgeBaseDocuments.map((document) => ({ ...document }));
            },
            applyGuardrails: async (_phase, value) => value,
            ...sandboxSideEffects.dependencies,
        });
        const execution = await new WorkflowExecutor(new PostgresWorkflowPersistence(db), handlers).start({
            workflow,
            input: prepared?.startInput.input || standardInput,
            variables: prepared?.startInput.variables,
            context: prepared?.startInput.context || { sandbox: true, userId: user.id },
            sessionId: `sandbox:${user.id}`,
            conversationId: `sandbox:${input.configId}`,
            executionId: `sandbox_${uuidv4()}`,
        }, { workerId: `sandbox_${user.id}` });
        return { success: true, executionId: execution.executionId, status: execution.status };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Falha ao executar teste.' };
    }
}


export async function getAutopilotConfig(workspaceId: string, agentId?: string): Promise<{
    config: AutopilotConfig | null,
    rules: NexusFlowInstance[] | null,
    agents: AutopilotConfig[] | null,
    draft?: AutopilotConfigDraft | null,
    versions?: AutopilotConfigVersionSummary[],
    workspace: Workspace | null,
    workspaceDefaultAiModel?: string | null,
    workspaceConfiguredAiModels?: ConfiguredWorkspaceAiModel[],
    workspaceHasGeminiConfig?: boolean,
    error?: string,
    hasGlobalKey?: boolean
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { config: null, rules: null, agents: null, workspace: null, error: "Usuário não autenticado." };
    }
    const userId = user.id;

    if (!await isWorkspaceMember(userId, workspaceId)) {
        return { config: null, rules: null, agents: null, workspace: null, error: "Acesso não autorizado." };
    }

    try {
        await ensureAutopilotVersioningTables();

        // Fetch configs for the workspace
        const configRes = await db.query(
            `SELECT configs.*, active_workflow.definition AS active_workflow_definition
             FROM autopilot_configs configs
             LEFT JOIN public.workflow_definitions active_workflow
               ON active_workflow.workflow_id = configs.active_workflow_id
              AND active_workflow.workflow_version = configs.active_workflow_version
              AND active_workflow.workspace_id = configs.workspace_id
             WHERE configs.workspace_id = $1
             ORDER BY configs.created_at`,
            [workspaceId]
        );

        // Fetch workspace details (global messages)
        const workspaceRes = await db.query('SELECT * FROM workspaces WHERE id = $1', [workspaceId]);
        const workspace = workspaceRes.rows[0] as Workspace || null;

        if (configRes.rowCount === 0) {
            return { config: null, rules: [], agents: [], workspace };
        }

        const agents = configRes.rows.map((row: any) => {
            const {
                active_workflow_definition: rawActiveWorkflowDefinition,
                ...configRow
            } = row;
            const workflowBuilderMode = normalizeWorkflowBuilderMode(row.workflow_builder_mode);
            const activeWorkflowDefinition = workflowBuilderMode === 'native_v2'
                ? parseWorkflowDefinition(rawActiveWorkflowDefinition)
                : null;
            const resolvedModel = resolveWorkflowAwareModelId({
                ai_model: row.ai_model || null,
                workflow_builder_mode: workflowBuilderMode,
                workflow_definition: activeWorkflowDefinition,
            });
            const resolvedToolNames = synchronizeNativeWorkflowToolState({
                workflow_builder_mode: workflowBuilderMode,
                workflow_definition: activeWorkflowDefinition,
                enabled_tool_names: normalizeEnabledToolNames(row.enabled_tool_names),
            }).enabled_tool_names || [];
            return {
                ...configRow,
                ai_model: resolvedModel,
                knowledge_base_documents: parseKnowledgeBaseDocuments(row.knowledge_base_documents),
                knowledge_collections: parseKnowledgeCollections(row.knowledge_collections),
                enabled_tool_names: resolvedToolNames,
                is_active: Boolean(row.is_active),
                is_primary: Boolean(row.is_primary),
                is_private: Boolean(row.is_private),
                default_fallback_reply: row.default_fallback_reply || null,
                flow_graph: parseFlowGraph(row.flow_graph),
                workflow_runtime_v2_mode: normalizeWorkflowRuntimeV2Mode(row.workflow_runtime_v2_mode),
                workflow_builder_mode: workflowBuilderMode,
                active_workflow_id: row.active_workflow_id || null,
                active_workflow_version: row.active_workflow_version || null,
                workflow_definition: activeWorkflowDefinition,
            } as AutopilotConfig;
        }).filter(agent => !agent.is_private || agent.user_id === userId); // Show only own private agents or shared ones

        const selectedConfig =
            agents.find(agent => agent.id === agentId) ||
            agents.find(agent => agent.user_id === userId) || // Prioritize user's own agent
            agents.find(agent => agent.is_primary) ||
            agents[0] ||
            null;

        if (!selectedConfig) {
            return { config: null, rules: [], agents, workspace };
        }

        const rulesRes = await db.query('SELECT * FROM autopilot_rules WHERE config_id = $1 ORDER BY name', [selectedConfig.id]);

        const rules = rulesRes.rows.map(r => ({
            ...r,
            action: typeof r.action === 'string' ? JSON.parse(r.action) : r.action
        }));

        const draftRes = await db.query(
            `SELECT config_id, workspace_id, user_id, snapshot, created_at, updated_at
             FROM autopilot_config_drafts
             WHERE config_id = $1
             LIMIT 1`,
            [selectedConfig.id]
        );
        const selectedSnapshot = buildSnapshotFromConfigRow(selectedConfig);
        if (selectedConfig.active_workflow_id && selectedConfig.active_workflow_version) {
            selectedSnapshot.workflow_definition = selectedConfig.workflow_definition
                || await new PostgresWorkflowPersistence(db)
                    .getWorkflowDefinition(selectedConfig.active_workflow_id, selectedConfig.active_workflow_version);
            selectedConfig.workflow_definition = selectedSnapshot.workflow_definition;
            selectedSnapshot.ai_model = resolveWorkflowAwareModelId(selectedSnapshot);
            selectedSnapshot.enabled_tool_names = synchronizeNativeWorkflowToolState(selectedSnapshot).enabled_tool_names;
            selectedConfig.ai_model = selectedSnapshot.ai_model;
            selectedConfig.enabled_tool_names = selectedSnapshot.enabled_tool_names;
        }
        const draft = draftRes.rows[0]
            ? {
                ...draftRes.rows[0],
                snapshot: normalizeDraftSnapshot(draftRes.rows[0].snapshot, selectedSnapshot),
            } as AutopilotConfigDraft
            : null;

        const versionsRes = await db.query(
            `SELECT id, config_id, workspace_id, user_id, version_number, label, snapshot, created_at
             FROM autopilot_config_versions
             WHERE config_id = $1
             ORDER BY version_number DESC`,
            [selectedConfig.id]
        );
        const versions = versionsRes.rows.map((row) => ({
            ...row,
            version_number: Number(row.version_number),
            snapshot: normalizeDraftSnapshot(row.snapshot, selectedSnapshot),
        })) as AutopilotConfigVersionSummary[];

        const workspaceConfiguredAiModels = await listWorkspaceConfiguredAiModels(workspaceId);
        const workspaceDefaultAiModel = workspaceConfiguredAiModels[0]?.id || null;
        const hasGlobalAiKey = !!(
            process.env.GOOGLE_GENAI_API_KEY ||
            process.env.GEMINI_API_KEY ||
            process.env.OPENAI_API_KEY ||
            process.env.CODEX_API_KEY ||
            process.env.DEEPSEEK_API_KEY
        );

        return {
            config: selectedConfig,
            rules,
            agents,
            draft,
            versions,
            workspace,
            workspaceDefaultAiModel,
            workspaceConfiguredAiModels,
            workspaceHasGeminiConfig: workspaceConfiguredAiModels.length > 0,
            hasGlobalKey: hasGlobalAiKey
        };

    } catch (error) {
        console.error(`[GET_AUTOPILOT_CONFIG] Erro ao buscar configs para o usuário ${userId} no workspace ${workspaceId}:`, error);
        return {
            config: null,
            rules: null,
            agents: null,
            workspace: null,
            workspaceDefaultAiModel: null,
            workspaceConfiguredAiModels: [],
            workspaceHasGeminiConfig: false,
            error: 'Falha ao buscar configurações do banco de dados.',
            hasGlobalKey: false
        };
    }
}


export async function saveAutopilotConfig(
    prevState: any,
    formData: FormData
): Promise<{ success: boolean; error?: string; rule?: NexusFlowInstance }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    const userId = user.id;

    const workspaceId = formData.get('workspaceId') as string;
    if (!workspaceId) {
        return { success: false, error: 'ID de Workspace é obrigatório.' };
    }

    if (!await isWorkspaceMember(userId, workspaceId)) {
        return { success: false, error: "Você não tem permissão para editar as configurações." };
    }

    const configId = formData.get('configId') as string | null;
    if (!configId) {
        return { success: false, error: 'Crie ou selecione um agente antes de salvar.' };
    }

    try {
        const fieldsToUpdate: { [key: string]: any } = {};
        const setClauses: string[] = [];
        const values: any[] = [];
        let parsedDocsForIndex: KnowledgeBaseDocument[] | null = null;
        let previousDocsForIndex: KnowledgeBaseDocument[] = [];
        let valueIndex = 4; // Start index for parameterized query, after workspaceId, configId (removed userId from WHERE) + placeholder for userId logging if needed? No, purely config update.
        // Actually, let's reset index logic.
        // Params: [workspaceId, configId] -> indices $1, $2
        // Dynamic values start at $3

        valueIndex = 3;

        if (formData.has('aiModel')) {
            const requestedModel = formData.get('aiModel')?.toString() || '';
            if (!(await isAllowedModelForWorkspace(workspaceId, requestedModel))) {
                return { success: false, error: 'Modelo de IA nao esta habilitado no catalogo global ou nas integracoes do workspace.' };
            }
            setClauses.push(`ai_model = $${valueIndex++}`);
            values.push(requestedModel);
        }
        if (formData.has('knowledgeBase')) {
            setClauses.push(`knowledge_base = $${valueIndex++}`);
            values.push(formData.get('knowledgeBase'));
        }
        if (formData.has('agentName')) {
            setClauses.push(`name = $${valueIndex++}`);
            values.push(formData.get('agentName') || 'Meu agente de IA');
        }
        if (formData.has('knowledgeBaseDocuments')) {
            try {
                const parsedDocs = formData.get('knowledgeBaseDocuments') ? JSON.parse(formData.get('knowledgeBaseDocuments')!.toString()) : [];
                parsedDocsForIndex = Array.isArray(parsedDocs) ? parsedDocs : [];
                setClauses.push(`knowledge_base_documents = $${valueIndex++}`);
                values.push(JSON.stringify(parsedDocsForIndex));
            } catch (error) {
                console.error('[SAVE_AUTOPILOT_CONFIG] Erro ao parsear documentos da base:', error);
                return { success: false, error: 'Base de conhecimento inválida.' };
            }
        }
        if (formData.has('isActive')) {
            const isActive = formData.get('isActive');
            const value = typeof isActive === 'string' ? isActive : '';
            const truthy = value === 'true' || value === 'on' || value === '1';
            setClauses.push(`is_active = $${valueIndex++}`);
            values.push(truthy);
        }
        if (formData.has('defaultFallbackReply')) {
            setClauses.push(`default_fallback_reply = $${valueIndex++}`);
            values.push(formData.get('defaultFallbackReply') || null);
        }
        if (formData.has('escalationPolicy')) {
            setClauses.push(`escalation_policy = $${valueIndex++}`);
            values.push(formData.get('escalationPolicy') || null);
        }
        if (formData.has('closingPolicy')) {
            setClauses.push(`closing_policy = $${valueIndex++}`);
            values.push(formData.get('closingPolicy') || null);
        }
        if (formData.has('inactivityTimeoutSeconds')) {
            setClauses.push(`inactivity_timeout_seconds = $${valueIndex++}`);
            values.push(normalizeInactivityTimeoutSeconds(formData.get('inactivityTimeoutSeconds'), null));
        }
        if (formData.has('enabledToolNames')) {
            try {
                await ensureAutopilotToolColumns();
                const parsed = JSON.parse(formData.get('enabledToolNames')?.toString() || '[]');
                const enabledToolNames = Array.isArray(parsed)
                    ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                    : [];
                setClauses.push(`enabled_tool_names = $${valueIndex++}`);
                values.push(JSON.stringify(enabledToolNames));
            } catch (error) {
                console.error('[SAVE_AUTOPILOT_CONFIG] Erro ao parsear ferramentas habilitadas:', error);
                return { success: false, error: 'Lista de ferramentas habilitadas invÃ¡lida.' };
            }
        }
        if (formData.has('knowledgeCollections')) {
            const parsedCollections = parseKnowledgeCollections(formData.get('knowledgeCollections')?.toString() || '[]');
            setClauses.push(`knowledge_collections = $${valueIndex++}`);
            values.push(JSON.stringify(parsedCollections));
        }
        if (formData.has('flowGraph')) {
            const flowGraph = parseFlowGraph(formData.get('flowGraph')?.toString() || '');
            setClauses.push(`flow_graph = $${valueIndex++}`);
            values.push(flowGraph ? JSON.stringify(flowGraph) : null);
        }
        if (formData.has('workflowRuntimeV2Mode')) {
            setClauses.push(`workflow_runtime_v2_mode = $${valueIndex++}`);
            values.push(normalizeWorkflowRuntimeV2Mode(formData.get('workflowRuntimeV2Mode')?.toString()));
        }
        if (formData.has('workflowBuilderMode')) {
            setClauses.push(`workflow_builder_mode = $${valueIndex++}`);
            values.push(normalizeWorkflowBuilderMode(formData.get('workflowBuilderMode')?.toString()));
        }

        const isPrivate = formData.get('isPrivate');
        const value = typeof isPrivate === 'string' ? isPrivate : '';
        const truthy = value === 'true' || value === 'on' || value === '1';
        setClauses.push(`is_private = $${valueIndex++}`);
        values.push(truthy);


        if (setClauses.length === 0) {
            return { success: true }; // Nothing to update
        }

        if (parsedDocsForIndex) {
            const currentDocsRes = await db.query(
                `SELECT knowledge_base_documents FROM autopilot_configs WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
                [workspaceId, configId]
            );
            const rawDocs = currentDocsRes.rows[0]?.knowledge_base_documents;
            previousDocsForIndex = typeof rawDocs === 'string'
                ? JSON.parse(rawDocs || '[]')
                : Array.isArray(rawDocs)
                    ? rawDocs
                    : [];
        }

        const updateQuery = `
            UPDATE autopilot_configs
            SET ${setClauses.join(', ')}, updated_at = NOW()
            WHERE workspace_id = $1 AND id = $2
        `;

        const result = await db.query(updateQuery, [workspaceId, configId, ...values]);

        if (result.rowCount === 0) {
            return { success: false, error: 'Agente não encontrado ou nenhuma alteração foi feita.' };
        }

        if (parsedDocsForIndex) {
            const previousById = new Map(previousDocsForIndex.map((doc) => [doc.id, doc]));
            const nextById = new Map(parsedDocsForIndex.map((doc) => [doc.id, doc]));

            const removedDocs = previousDocsForIndex.filter((doc) => !nextById.has(doc.id));
            const changedDocs = parsedDocsForIndex.filter((doc) => {
                const previous = previousById.get(doc.id);
                return hasKnowledgeDocumentIndexChanged(previous, doc);
            });

            await Promise.all(
                removedDocs.map((doc) =>
                    VectorStore.deleteDocumentEmbeddings({
                        documentId: doc.id,
                        workspaceId,
                        autopilotConfigId: configId,
                    }).catch((ragError) => {
                        console.error('[RAG] Failed to remove document embeddings:', ragError);
                    })
                )
            );

            for (const doc of changedDocs) {
                const content = (doc.content || '').trim();
                if (!content) {
                    await VectorStore.deleteDocumentEmbeddings({
                        documentId: doc.id,
                        workspaceId,
                        autopilotConfigId: configId,
                    }).catch((ragError) => {
                        console.error('[RAG] Failed to clear empty document embeddings:', ragError);
                    });
                    continue;
                }

                try {
                    await VectorStore.deleteDocumentEmbeddings({
                        documentId: doc.id,
                        workspaceId,
                        autopilotConfigId: configId,
                    });
                    if (shouldEnqueueJob('ai_document_ingest')) {
                        await enqueueAiDocumentIngest({
                            workspaceId,
                            autopilotConfigId: configId,
                            documentId: doc.id,
                            documentName: doc.name || 'Documento',
                            content,
                            document: doc,
                        });
                    } else {
                        await ingestKnowledgeBaseDocument({
                            workspaceId,
                            autopilotConfigId: configId,
                            documentId: doc.id,
                            documentName: doc.name || 'Documento',
                            content,
                            document: doc,
                        });
                    }
                } catch (ragError) {
                    console.error('[RAG] Failed to reindex knowledge document:', ragError);
                }
            }
        }

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${configId}`);
        return { success: true };

    } catch (error) {
        console.error('[SAVE_AUTOPILOT_CONFIG] Erro ao salvar configurações:', error);
        return { success: false, error: "Falha ao salvar as configurações no banco de dados." };
    }
}

export async function saveAutopilotDraft(
    prevState: any,
    formData: FormData
): Promise<{ success: boolean; error?: string; updatedAt?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuario nao autenticado.' };
    }

    const workspaceId = formData.get('workspaceId') as string;
    const configId = formData.get('configId') as string;
    if (!workspaceId || !configId) {
        return { success: false, error: 'Workspace e agente sao obrigatorios.' };
    }

    if (!await isWorkspaceMember(user.id, workspaceId)) {
        return { success: false, error: 'Acesso nao autorizado.' };
    }

    try {
        await ensureAutopilotVersioningTables();

        const configRes = await db.query(
            'SELECT * FROM autopilot_configs WHERE workspace_id = $1 AND id = $2 LIMIT 1',
            [workspaceId, configId]
        );
        if (configRes.rowCount === 0) {
            return { success: false, error: 'Agente nao encontrado.' };
        }

        const fallback = buildSnapshotFromConfigRow(configRes.rows[0]);
        const snapshot = await buildSnapshotFromFormData(formData, fallback);
        const saveRes = await db.query(
            `INSERT INTO autopilot_config_drafts (config_id, workspace_id, user_id, snapshot, updated_at)
             VALUES ($1, $2, $3, $4, timezone('utc', now()))
             ON CONFLICT (config_id)
             DO UPDATE SET
                workspace_id = EXCLUDED.workspace_id,
                user_id = EXCLUDED.user_id,
                snapshot = EXCLUDED.snapshot,
                updated_at = timezone('utc', now())
             RETURNING updated_at`,
            [configId, workspaceId, user.id, JSON.stringify(snapshot)]
        );

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${configId}`);
        return { success: true, updatedAt: saveRes.rows[0]?.updated_at };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao salvar rascunho.';
        console.error('[SAVE_AUTOPILOT_DRAFT] Erro ao salvar rascunho:', error);
        return { success: false, error: message };
    }
}

export async function discardAutopilotDraft(configId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuario nao autenticado.' };
    }

    try {
        await ensureAutopilotVersioningTables();
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const configRes = await client.query(
                'SELECT workspace_id FROM autopilot_configs WHERE id = $1 LIMIT 1',
                [configId]
            );
            if (configRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Agente nao encontrado.' };
            }

            const workspaceId = configRes.rows[0].workspace_id;
            if (!await isWorkspaceMember(user.id, workspaceId)) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Acesso nao autorizado.' };
            }

            await markDraftCausalPatternApplicationsDiscarded(client, {
                workspaceId: String(workspaceId),
                configId,
                userId: user.id,
                reason: 'draft_discarded',
            });

            await client.query('DELETE FROM autopilot_config_drafts WHERE config_id = $1', [configId]);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${configId}`);
        return { success: true };
    } catch (error) {
        console.error('[DISCARD_AUTOPILOT_DRAFT] Erro ao descartar rascunho:', error);
        return { success: false, error: 'Falha ao descartar rascunho.' };
    }
}

export async function publishAutopilotDraft(configId: string): Promise<{
    success: boolean;
    error?: string;
    warning?: string;
    versionNumber?: number;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuario nao autenticado.' };
    }

    const client = await db.connect();
    let previousDocs: KnowledgeBaseDocument[] = [];
    let nextDocs: KnowledgeBaseDocument[] = [];
    let versionNumber = 0;

    try {
        await ensureAutopilotVersioningTables();
        await client.query('BEGIN');

        const configRes = await client.query(
            'SELECT * FROM autopilot_configs WHERE id = $1 FOR UPDATE',
            [configId]
        );
        if (configRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Agente nao encontrado.' };
        }

        const configRow = configRes.rows[0];
        const currentWorkspaceId = String(configRow.workspace_id);
        if (!await isWorkspaceMember(user.id, currentWorkspaceId)) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Acesso nao autorizado.' };
        }

        const draftRes = await client.query(
            'SELECT snapshot FROM autopilot_config_drafts WHERE config_id = $1 LIMIT 1',
            [configId]
        );
        if (draftRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Nenhum rascunho para publicar.' };
        }

        const fallback = buildSnapshotFromConfigRow(configRow);
        const snapshot = normalizeDraftSnapshot(draftRes.rows[0].snapshot, fallback);
        if (snapshot.workflow_builder_mode === 'native_v2') {
            snapshot.ai_model = getPrimaryWorkflowModelId(snapshot.workflow_definition) || snapshot.ai_model;
        }
        if (snapshot.ai_model && !(await isAllowedModelForWorkspace(currentWorkspaceId, snapshot.ai_model))) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Modelo de IA nao esta habilitado no catalogo global ou nas integracoes do workspace.' };
        }
        const isNativeWorkflow = snapshot.workflow_builder_mode === 'native_v2';
        if (isNativeWorkflow) {
            if (!snapshot.workflow_definition) {
                await client.query('ROLLBACK');
                return { success: false, error: 'A automação nativa não possui uma definição de workflow.' };
            }
            const [configuredModels, toolCatalog] = await Promise.all([
                listWorkspaceConfiguredAiModels(currentWorkspaceId),
                listWorkspaceAgentToolCatalog(currentWorkspaceId),
            ]);
            const toolReconciliation = reconcileNativeWorkflowTools(snapshot.workflow_definition, toolCatalog);
            if (toolReconciliation.errors.length > 0) {
                await client.query('ROLLBACK');
                return { success: false, error: toolReconciliation.errors.join(' ') };
            }
            snapshot.workflow_definition = toolReconciliation.workflow;
            snapshot.enabled_tool_names = synchronizeNativeWorkflowToolState(snapshot).enabled_tool_names;
            const nativeValidation = validateWorkflowDefinition(snapshot.workflow_definition, {
                availableModelIds: configuredModels.map((model) => model.id),
            });
            if (!nativeValidation.valid) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    error: nativeValidation.errors.map((issue) => issue.message).join(' '),
                };
            }
        } else {
            const flowAudit = auditAutopilotFlowGraph(snapshot.flow_graph);
            if (flowAudit.status === 'failed') {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    error: summarizeFlowAuditIssues(flowAudit.issues)
                        || 'Fluxo possui problemas criticos antes de publicar.',
                };
            }
            const toolCatalog = await listWorkspaceAgentToolCatalog(currentWorkspaceId);
            const toolCoverage = analyzeAutopilotToolCoverage({
                graph: snapshot.flow_graph,
                enabledToolNames: snapshot.enabled_tool_names,
                toolCatalog,
            });
            if (isAutopilotToolCoveragePublishBlocked(toolCoverage)) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    error: summarizeAutopilotToolCoverageBlockers(toolCoverage)
                        || 'Fluxo possui ferramentas habilitadas sem branch seguro.',
                };
            }
        }

        previousDocs = fallback.knowledge_base_documents;
        nextDocs = snapshot.knowledge_base_documents;

        const nextVersionRes = await client.query(
            'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM autopilot_config_versions WHERE config_id = $1',
            [configId]
        );
        versionNumber = Number(nextVersionRes.rows[0]?.next_version || 1);
        let activeWorkflowId = configRow.active_workflow_id || null;
        let activeWorkflowVersion = configRow.active_workflow_version || null;
        if (isNativeWorkflow && snapshot.workflow_definition) {
            const timestamp = new Date().toISOString();
            const publishedWorkflow = WorkflowDefinitionSchema.parse({
                ...snapshot.workflow_definition,
                id: `autopilot:${configId}`,
                workspaceId: currentWorkspaceId,
                name: snapshot.name,
                version: `v${versionNumber}`,
                status: 'published',
                updatedAt: timestamp,
            });
            const publishedValidation = validateWorkflowDefinition(publishedWorkflow);
            if (!publishedValidation.valid) {
                await client.query('ROLLBACK');
                return { success: false, error: publishedValidation.errors.map((issue) => issue.message).join(' ') };
            }
            await new PostgresWorkflowPersistence(client).saveWorkflowDefinition(publishedWorkflow);
            snapshot.workflow_definition = publishedWorkflow;
            activeWorkflowId = publishedWorkflow.id;
            activeWorkflowVersion = publishedWorkflow.version;
        } else {
            const workflowRuntimeV2Compile = await shadowCompileAutopilotWorkflowRuntimeV2({
                config: {
                    id: configId,
                    workspace_id: currentWorkspaceId,
                    name: snapshot.name,
                    ai_model: snapshot.ai_model,
                    flow_graph: snapshot.flow_graph,
                    workflow_runtime_v2_mode: normalizeWorkflowRuntimeV2Mode(snapshot.workflow_runtime_v2_mode),
                },
                version: `v${versionNumber}`,
                userId: user.id,
                database: client,
            });
            if (workflowRuntimeV2Compile.enabled && !workflowRuntimeV2Compile.valid) {
                console.warn('[WORKFLOW_RUNTIME_V2_SHADOW_COMPILE] Published draft did not compile cleanly:', {
                    configId,
                    workspaceId: currentWorkspaceId,
                    versionNumber,
                    error: workflowRuntimeV2Compile.error,
                });
            }
        }

        await client.query(
            `UPDATE autopilot_configs
             SET
                name = $3,
                gemini_api_key = $4,
                ai_model = $5,
                transcription_model = $6,
                knowledge_base = $7,
                knowledge_base_documents = $8,
                knowledge_collections = $9,
                is_active = $10,
                is_private = $11,
                default_fallback_reply = $12,
                escalation_policy = $13,
                closing_policy = $14,
                inactivity_timeout_seconds = $15,
                enabled_tool_names = $16,
                flow_graph = $17,
                workflow_runtime_v2_mode = $18,
                workflow_builder_mode = $19,
                active_workflow_id = $20,
                active_workflow_version = $21,
                updated_at = NOW()
             WHERE workspace_id = $1 AND id = $2`,
            [
                currentWorkspaceId,
                configId,
                snapshot.name,
                snapshot.gemini_api_key,
                snapshot.ai_model,
                snapshot.transcription_model || null,
                snapshot.knowledge_base,
                JSON.stringify(snapshot.knowledge_base_documents),
                JSON.stringify(snapshot.knowledge_collections || []),
                snapshot.is_active,
                snapshot.is_private,
                snapshot.default_fallback_reply,
                snapshot.escalation_policy,
                snapshot.closing_policy,
                normalizeInactivityTimeoutSeconds(snapshot.inactivity_timeout_seconds, null),
                JSON.stringify(snapshot.enabled_tool_names),
                snapshot.flow_graph ? JSON.stringify(snapshot.flow_graph) : null,
                normalizeWorkflowRuntimeV2Mode(snapshot.workflow_runtime_v2_mode),
                normalizeWorkflowBuilderMode(snapshot.workflow_builder_mode),
                activeWorkflowId,
                activeWorkflowVersion,
            ]
        );

        await client.query(
            `INSERT INTO autopilot_config_versions
                (config_id, workspace_id, user_id, version_number, label, snapshot)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                configId,
                currentWorkspaceId,
                user.id,
                versionNumber,
                `Publicacao v${versionNumber}`,
                JSON.stringify(snapshot),
            ]
        );

        await markDraftCausalPatternApplicationsPublished(client, {
            workspaceId: currentWorkspaceId,
            configId,
            userId: user.id,
            versionNumber,
        });

        await client.query('DELETE FROM autopilot_config_drafts WHERE config_id = $1', [configId]);
        await client.query('COMMIT');

        const indexing = await reindexChangedKnowledgeDocuments({
            workspaceId: currentWorkspaceId,
            configId,
            previousDocs,
            nextDocs,
        });

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${configId}`);
        return {
            success: true,
            versionNumber,
            warning: indexing.failedDocumentNames.length > 0
                ? `A automação foi publicada, mas ${indexing.failedDocumentNames.length} documento(s) aguardam reindexação: ${indexing.failedDocumentNames.join(', ')}.`
                : undefined,
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error('[PUBLISH_AUTOPILOT_DRAFT] Erro ao publicar rascunho:', error);
        return { success: false, error: 'Falha ao publicar rascunho.' };
    } finally {
        client.release();
    }
}

export async function restoreAutopilotVersion(configId: string, versionId: string): Promise<{
    success: boolean;
    error?: string;
    warning?: string;
    versionNumber?: number;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuario nao autenticado.' };
    }

    const client = await db.connect();
    let previousDocs: KnowledgeBaseDocument[] = [];
    let nextDocs: KnowledgeBaseDocument[] = [];
    let versionNumber = 0;

    try {
        await ensureAutopilotVersioningTables();
        await client.query('BEGIN');

        const configRes = await client.query(
            'SELECT * FROM autopilot_configs WHERE id = $1 FOR UPDATE',
            [configId]
        );
        if (configRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Agente nao encontrado.' };
        }

        const configRow = configRes.rows[0];
        const currentWorkspaceId = String(configRow.workspace_id);
        if (!await isWorkspaceMember(user.id, currentWorkspaceId)) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Acesso nao autorizado.' };
        }

        const versionRes = await client.query(
            `SELECT version_number, snapshot
             FROM autopilot_config_versions
             WHERE id = $1 AND config_id = $2
             LIMIT 1`,
            [versionId, configId]
        );
        if (versionRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Versao nao encontrada.' };
        }

        const fallback = buildSnapshotFromConfigRow(configRow);
        const snapshot = normalizeDraftSnapshot(versionRes.rows[0].snapshot, fallback);
        if (snapshot.ai_model && !(await isAllowedModelForWorkspace(currentWorkspaceId, snapshot.ai_model))) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Modelo de IA desta versao nao esta habilitado no catalogo global ou nas integracoes do workspace.' };
        }

        previousDocs = fallback.knowledge_base_documents;
        nextDocs = snapshot.knowledge_base_documents;

        const nextVersionRes = await client.query(
            'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM autopilot_config_versions WHERE config_id = $1',
            [configId]
        );
        versionNumber = Number(nextVersionRes.rows[0]?.next_version || 1);

        let restoredWorkflowId: string | null = null;
        let restoredWorkflowVersion: string | null = null;
        if (snapshot.workflow_builder_mode === 'native_v2' && snapshot.workflow_definition) {
            const restoredValidation = validateWorkflowDefinition(snapshot.workflow_definition);
            if (!restoredValidation.valid || snapshot.workflow_definition.status !== 'published') {
                await client.query('ROLLBACK');
                return { success: false, error: 'A versão selecionada não possui um workflow nativo publicado válido.' };
            }
            await new PostgresWorkflowPersistence(client).saveWorkflowDefinition(snapshot.workflow_definition);
            restoredWorkflowId = snapshot.workflow_definition.id;
            restoredWorkflowVersion = snapshot.workflow_definition.version;
        }

        await client.query(
            `UPDATE autopilot_configs
             SET
                name = $3,
                gemini_api_key = $4,
                ai_model = $5,
                transcription_model = $6,
                knowledge_base = $7,
                knowledge_base_documents = $8,
                knowledge_collections = $9,
                is_active = $10,
                is_private = $11,
                default_fallback_reply = $12,
                escalation_policy = $13,
                closing_policy = $14,
                inactivity_timeout_seconds = $15,
                enabled_tool_names = $16,
                flow_graph = $17,
                workflow_runtime_v2_mode = $18,
                workflow_builder_mode = $19,
                active_workflow_id = $20,
                active_workflow_version = $21,
                updated_at = NOW()
             WHERE workspace_id = $1 AND id = $2`,
            [
                currentWorkspaceId,
                configId,
                snapshot.name,
                snapshot.gemini_api_key,
                snapshot.ai_model,
                snapshot.transcription_model || null,
                snapshot.knowledge_base,
                JSON.stringify(snapshot.knowledge_base_documents),
                JSON.stringify(snapshot.knowledge_collections || []),
                snapshot.is_active,
                snapshot.is_private,
                snapshot.default_fallback_reply,
                snapshot.escalation_policy,
                snapshot.closing_policy,
                normalizeInactivityTimeoutSeconds(snapshot.inactivity_timeout_seconds, null),
                JSON.stringify(snapshot.enabled_tool_names),
                snapshot.flow_graph ? JSON.stringify(snapshot.flow_graph) : null,
                normalizeWorkflowRuntimeV2Mode(snapshot.workflow_runtime_v2_mode),
                normalizeWorkflowBuilderMode(snapshot.workflow_builder_mode),
                restoredWorkflowId,
                restoredWorkflowVersion,
            ]
        );

        await client.query(
            `INSERT INTO autopilot_config_versions
                (config_id, workspace_id, user_id, version_number, label, snapshot)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                configId,
                currentWorkspaceId,
                user.id,
                versionNumber,
                `Rollback para v${Number(versionRes.rows[0].version_number)}`,
                JSON.stringify(snapshot),
            ]
        );

        await markDraftCausalPatternApplicationsDiscarded(client, {
            workspaceId: currentWorkspaceId,
            configId,
            userId: user.id,
            reason: 'version_restored',
        });

        await client.query('DELETE FROM autopilot_config_drafts WHERE config_id = $1', [configId]);
        await client.query('COMMIT');

        const indexing = await reindexChangedKnowledgeDocuments({
            workspaceId: currentWorkspaceId,
            configId,
            previousDocs,
            nextDocs,
        });

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${configId}`);
        return {
            success: true,
            versionNumber,
            warning: indexing.failedDocumentNames.length > 0
                ? `A versão foi restaurada, mas ${indexing.failedDocumentNames.length} documento(s) aguardam reindexação.`
                : undefined,
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error('[RESTORE_AUTOPILOT_VERSION] Erro ao restaurar versao:', error);
        return { success: false, error: 'Falha ao restaurar versao.' };
    } finally {
        client.release();
    }
}

export async function createAutopilotAgent(workspaceId: string, name: string, isPrivate: boolean = false): Promise<{ success: boolean; id?: string; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuário não autenticado.' };

    if (!await isWorkspaceMember(user.id, workspaceId)) {
        return { success: false, error: 'Acesso não autorizado.' };
    }

    try {
        const countRes = await db.query('SELECT COUNT(*)::int AS total FROM autopilot_configs WHERE workspace_id = $1', [workspaceId]);
        const existingCount = countRes.rows[0]?.total ?? 0;
        const normalizedName = name?.trim() || `Automação ${existingCount + 1}`;
        const shouldBePrimary = existingCount === 0;

        const insertRes = await db.query(
            `INSERT INTO autopilot_configs (workspace_id, user_id, name, is_primary, is_private)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [workspaceId, user.id, normalizedName, shouldBePrimary, isPrivate]
        );

        const newId = insertRes.rows[0]?.id;
        revalidatePath('/autopilot');
        return { success: true, id: newId };
    } catch (error) {
        console.error('[CREATE_AUTOPILOT_AGENT] Erro ao criar agente:', error);
        return { success: false, error: 'Falha ao criar agente.' };
    }
}

export async function setPrimaryAutopilotAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuário não autenticado.' };

    try {
        const agentRes = await db.query('SELECT workspace_id, user_id FROM autopilot_configs WHERE id = $1', [agentId]);
        if (agentRes.rowCount === 0) { // Removed user_id check as multiple users can manage workspace
            return { success: false, error: 'Agente não encontrado.' };
        }
        const workspaceId = agentRes.rows[0].workspace_id;

        // Check permissions
        if (!await isWorkspaceMember(user.id, workspaceId)) {
            return { success: false, error: 'Acesso não autorizado.' };
        }

        await db.query('UPDATE autopilot_configs SET is_primary = false WHERE workspace_id = $1', [workspaceId]);
        await db.query('UPDATE autopilot_configs SET is_primary = true WHERE id = $1', [agentId]);

        revalidatePath('/autopilot');
        return { success: true };
    } catch (error) {
        console.error('[SET_PRIMARY_AUTOPILOT_AGENT] Erro:', error);
        return { success: false, error: 'Não foi possível definir o agente principal.' };
    }
}

export async function deleteAutopilotAgent(agentId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) return { success: false, error: 'Usuário não autenticado' };

        // Verify ownership/membership
        const agentRes = await db.query('SELECT workspace_id FROM autopilot_configs WHERE id = $1', [agentId]);

        if (agentRes.rowCount === 0) {
            return { success: false, error: 'Agente não encontrado' };
        }

        const workspaceId = agentRes.rows[0].workspace_id;

        const isMember = await isWorkspaceMember(user.id, workspaceId);
        if (!isMember) return { success: false, error: 'Sem permissão no workspace' };

        await db.query('DELETE FROM autopilot_configs WHERE id = $1', [agentId]);

        revalidatePath('/autopilot');
        return { success: true };
    } catch (error) {
        console.error('Error deleting autopilot agent:', error);
        return { success: false, error: 'Falha ao deletar agente' };
    }
}


export async function saveAutopilotRule(
    configId: string,
    rule: Omit<NexusFlowInstance, 'enabled'>
): Promise<{ success: boolean; error?: string; rule?: NexusFlowInstance }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    try {
        if (!configId || !rule.name || !rule.trigger || !rule.action) {
            return { success: false, error: 'Dados da regra incompletos.' };
        }

        const sanitized = sanitizeAutopilotRules([{ ...rule, enabled: true }]);
        const normalizedRule = sanitized.rules[0];
        if (!normalizedRule || sanitized.rules.length !== 1) {
            return {
                success: false,
                error: 'A regra possui uma aÃ§Ã£o invÃ¡lida. Webhooks devem usar uma URL HTTPS pÃºblica.',
            };
        }
        if (normalizedRule.action.type === 'webhook') {
            await assertSafeAutopilotWebhookUrl(normalizedRule.action.url);
        }

        const actionJson = JSON.stringify(normalizedRule.action);

        let savedRuleRes;
        if (rule.id) {
            // Update existing rule
            console.log(`[SAVE_AUTOPILOT_RULE] Atualizando regra ID: ${rule.id}`);
            savedRuleRes = await db.query(
                `UPDATE autopilot_rules SET name = $1, trigger = $2, action = $3 WHERE id = $4 AND config_id = $5 RETURNING id, name, trigger, action, enabled`,
                [normalizedRule.name, normalizedRule.trigger, actionJson, rule.id, configId]
            );
        } else {
            // Create new rule - o ID será gerado pelo banco de dados (gen_random_uuid())
            console.log(`[SAVE_AUTOPILOT_RULE] Criando nova regra para config ID: ${configId}`);
            savedRuleRes = await db.query(
                `INSERT INTO autopilot_rules (config_id, name, trigger, action) VALUES ($1, $2, $3, $4) RETURNING id, name, trigger, action, enabled`,
                [configId, normalizedRule.name, normalizedRule.trigger, actionJson]
            );
        }

        const savedRuleRow = savedRuleRes.rows[0];

        revalidatePath('/autopilot');
        return {
            success: true,
            rule: savedRuleRow ? {
                ...savedRuleRow,
                action: typeof savedRuleRow.action === 'string' ? JSON.parse(savedRuleRow.action) : savedRuleRow.action,
            } : undefined,
        };

    } catch (error) {
        console.error('[SAVE_AUTOPILOT_RULE] Erro detalhado:', error);
        return { success: false, error: 'Falha ao salvar a regra no servidor.' };
    }
}


export async function deleteAutopilotRule(ruleId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    try {
        await db.query('DELETE FROM autopilot_rules WHERE id = $1', [ruleId]);
        revalidatePath('/autopilot');
        return { success: true };
    } catch (error) {
        console.error('[DELETE_AUTOPILOT_RULE] Erro:', error);
        return { success: false, error: 'Falha ao remover a regra.' };
    }
}

export async function toggleAutopilotRule(ruleId: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    try {
        await db.query('UPDATE autopilot_rules SET enabled = $1 WHERE id = $2', [enabled, ruleId]);
        revalidatePath('/autopilot');
        return { success: true };
    } catch (error) {
        console.error('[TOGGLE_AUTOPILOT_RULE] Erro:', error);
        return { success: false, error: 'Falha ao alterar o status da regra.' };
    }
}


interface UsageLogData {
    configId: string;
    flowName: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    ruleName?: string;
    chatId?: string | null;
    systemAgentId?: string | null;
    inputMessage?: string | null;
    outputMessage?: string | null;
    status?: string | null;
    metadata?: Record<string, unknown> | null;
}

export async function logAutopilotUsage(data: UsageLogData): Promise<void> {
    try {
        await db.query(
            `INSERT INTO autopilot_usage_logs 
             (config_id, flow_name, model_name, input_tokens, output_tokens, total_tokens, rule_name,
              chat_id, system_agent_id, input_message, output_message, status, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                data.configId,
                data.flowName,
                data.modelName,
                data.inputTokens,
                data.outputTokens,
                data.totalTokens,
                data.ruleName,
                data.chatId || null,
                data.systemAgentId || null,
                data.inputMessage || null,
                data.outputMessage || null,
                data.status || null,
                data.metadata ? JSON.stringify(data.metadata) : null,
            ]
        );
        console.log(`[LOG_USAGE] Usage logged for flow ${data.flowName} with model ${data.modelName}. Total Tokens: ${data.totalTokens}`);
    } catch (error) {
        console.error('[LOG_USAGE] Failed to log autopilot usage:', error);
        // We don't throw an error here because logging failure should not break the main flow.
    }
}


export async function getAutopilotUsageLogs(configId: string): Promise<{ logs: AutopilotUsageLog[] | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { logs: null, error: "Usuário não autenticado." };

    // We can assume if the user is fetching logs, they have access to the config.
    // A more robust check would verify ownership of the configId.

    try {
        const res = await db.query(
            `SELECT flow_name, rule_name, model_name, total_tokens, input_tokens, output_tokens,
                    chat_id, system_agent_id, input_message, output_message, status, metadata, created_at
             FROM autopilot_usage_logs
             WHERE config_id = $1
             ORDER BY created_at DESC
             LIMIT 20`,
            [configId]
        );
        return { logs: res.rows };
    } catch (error) {
        console.error('[GET_AUTOPILOT_LOGS] Erro ao buscar logs de uso:', error);
        return { logs: null, error: "Falha ao buscar o histórico de uso." };
    }
}

export type AutopilotDecisionInsightItem = {
    id: string;
    stage: string;
    decisionType: string;
    goal: string | null;
    procedureId: string | null;
    stepId: string | null;
    selectedTool: string | null;
    selectedTools: string[];
    candidateTools: AutopilotDecisionToolCandidateInsight[];
    blockedTools: AutopilotBlockedToolInsight[];
    blockedToolsCount: number;
    presentSlots: AutopilotDecisionPresentSlotInsight[];
    invalidSlots: AutopilotDecisionInvalidSlotInsight[];
    requiredSlots: string[];
    switchResolution: AutopilotDecisionSwitchInsight | null;
    confidence: number | null;
    outcomeResolutionType: string | null;
    outcomeResolved: boolean | null;
    createdAt: string;
};

export type AutopilotDecisionPresentSlotInsight = {
    name: string;
    source: string | null;
    confidence: number | null;
};

export type AutopilotDecisionInvalidSlotInsight = {
    name: string;
    reason: string | null;
};

export type AutopilotDecisionSwitchRouteInsight = {
    routeId: string;
    routeLabel: string | null;
    targetNodeId: string | null;
    confidence: number | null;
    selected: boolean;
    fallback: boolean;
    rejectedReason: string | null;
};

export type AutopilotDecisionSwitchInsight = {
    switchNodeId: string;
    routeId: string;
    routeLabel: string | null;
    targetNodeId: string | null;
    confidence: number | null;
    fallbackUsed: boolean;
    candidateRoutes: AutopilotDecisionSwitchRouteInsight[];
    rejectedRoutes: AutopilotDecisionSwitchRouteInsight[];
};

export type AutopilotDecisionToolCandidateInsight = {
    tool: string;
    capability: string | null;
    allowed: boolean;
    code: string | null;
    score: number | null;
    reason: string | null;
    missingSlots: string[];
};

export type AutopilotBlockedToolInsight = {
    toolName: string;
    reason: string;
    missingSlots: string[];
};

export type AutopilotResourceMappingFieldInsight = {
    slot: string;
    fieldId: string | null;
    fieldLabel: string | null;
    confidence: number | null;
    source: string | null;
    reason: string | null;
};

export type AutopilotResourceMappingInsight = {
    id: string;
    resource: string;
    operation: string;
    status: string;
    confidence: number | null;
    mappedFields: AutopilotResourceMappingFieldInsight[];
    rejectedFieldsCount: number;
    payloadHash: string | null;
    createdAt: string;
};

export type AutopilotCausalPatternInsight = {
    id: string;
    patternType: string;
    procedureId: string | null;
    stepId: string | null;
    switchNodeId: string | null;
    switchRouteId: string | null;
    toolName: string | null;
    insight: string;
    evidence: Record<string, unknown>;
    suggestedFix: Record<string, unknown>;
    impact: Record<string, unknown>;
    confidence: number;
    status: string;
    applicationStatus: string | null;
    applicationType: string | null;
    appliedAt: string | null;
    applicationImpact: CausalPatternImpactReport | null;
    createdAt: string;
};

export type AutopilotCausalPatternApplicationInsight = {
    id: string;
    patternId: string;
    patternType: string;
    insight: string;
    applicationType: string;
    applicationSource: 'manual' | 'safe_auto_tune' | 'unknown';
    status: string;
    beforeSnapshotHash: string;
    afterSnapshotHash: string;
    graphPatchIncluded: boolean;
    graphPatchOperationCount: number;
    publishedVersionNumber: number | null;
    publishedAt: string | null;
    revertedAt: string | null;
    createdAt: string;
};

export type AutopilotEcosystemPatternInsight = {
    id: string;
    fingerprint: string;
    patternType: string;
    vertical: string;
    insight: string;
    evidence: Record<string, unknown>;
    suggestedFix: Record<string, unknown>;
    sourceWorkspaceCount: number;
    sampleSize: number;
    confidence: number;
    status: string;
    validatedAt: string | null;
    createdAt: string;
};

export type AutopilotScoreHistoryInsight = {
    id: string;
    source: string;
    weights: Record<string, number>;
    evidencePatternId: string | null;
    reason: string | null;
    appliedAt: string;
};

export type AutopilotDecisionInsights = {
    summary: {
        totalDecisions: number;
        decisionsWithOutcome: number;
        resolvedOutcomes: number;
        handoffOutcomes: number;
        averageConfidence: number | null;
        blockedToolDecisions: number;
        pendingPatterns: number;
        approvedPatterns: number;
        appliedPatterns: number;
    };
    decisionTypeCounts: Array<{ decisionType: string; count: number }>;
    outcomeCounts: Array<{ resolutionType: string; count: number }>;
    recentDecisions: AutopilotDecisionInsightItem[];
    patterns: AutopilotCausalPatternInsight[];
    recentApplications: AutopilotCausalPatternApplicationInsight[];
    ecosystemPatterns: AutopilotEcosystemPatternInsight[];
    scoreHistory: AutopilotScoreHistoryInsight[];
    learningTrend: AutopilotLearningTrendInsight;
    procedureOutcomes: AutopilotProcedureOutcomeInsight[];
    switchRouteOutcomes: AutopilotSwitchRouteOutcomeInsight[];
    resourceMappings: AutopilotResourceMappingInsight[];
};

export type AutopilotCausalPatternApplicationPreview = CausalPatternDraftApplicationPreview;

function parseJsonValue(value: unknown): unknown {
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }
    return value ?? null;
}

function parseStringList(value: unknown): string[] {
    const parsed = parseJsonValue(value);
    return Array.isArray(parsed)
        ? Array.from(new Set(parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)))
        : [];
}

function parseObject(value: unknown): Record<string, unknown> {
    const parsed = parseJsonValue(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
}

function parseOptionalNumber(value: unknown): number | null {
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
}

function parseBlockedToolInsights(value: unknown): AutopilotBlockedToolInsight[] {
    const parsed = parseJsonValue(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
        .map((item): AutopilotBlockedToolInsight | null => {
            const record = parseObject(item);
            const toolName = String(record.toolName || record.tool || '').trim();
            if (!toolName) return null;
            return {
                toolName,
                reason: String(record.reason || '').trim(),
                missingSlots: parseStringList(record.missingSlots),
            };
        })
        .filter((item): item is AutopilotBlockedToolInsight => item !== null);
}

function parseCandidateToolInsights(input: {
    metadata: unknown;
    selectedTools: string[];
    blockedTools: AutopilotBlockedToolInsight[];
}): AutopilotDecisionToolCandidateInsight[] {
    const metadata = parseObject(input.metadata);
    const planner = parseObject(metadata.toolPlanner);
    const capabilityDecisions = parseJsonValue(planner.capabilityDecisions);
    const explicitCandidates = parseJsonValue(metadata.candidateTools);
    const byTool = new Map<string, AutopilotDecisionToolCandidateInsight>();

    if (Array.isArray(capabilityDecisions)) {
        for (const item of capabilityDecisions) {
            const record = parseObject(item);
            const tool = String(record.tool || '').trim();
            if (!tool) continue;
            byTool.set(tool, {
                tool,
                capability: typeof record.capability === 'string' ? record.capability : null,
                allowed: Boolean(record.allowed),
                code: typeof record.code === 'string' ? record.code : null,
                score: parseOptionalNumber(record.score),
                reason: typeof record.reason === 'string' ? record.reason : null,
                missingSlots: parseStringList(record.missingSlots),
            });
        }
    }

    if (Array.isArray(explicitCandidates)) {
        for (const item of explicitCandidates) {
            const record = parseObject(item);
            const tool = String(record.tool || record.toolName || '').trim();
            if (!tool || byTool.has(tool)) continue;
            byTool.set(tool, {
                tool,
                capability: typeof record.source === 'string' ? record.source : null,
                allowed: input.selectedTools.includes(tool),
                code: input.selectedTools.includes(tool) ? 'selected' : 'candidate',
                score: null,
                reason: typeof record.reason === 'string' ? record.reason : null,
                missingSlots: [],
            });
        }
    }

    for (const tool of input.selectedTools) {
        if (!byTool.has(tool)) {
            byTool.set(tool, {
                tool,
                capability: null,
                allowed: true,
                code: 'selected',
                score: null,
                reason: 'Ferramenta selecionada pelo motor.',
                missingSlots: [],
            });
        }
    }

    for (const blocked of input.blockedTools) {
        if (!byTool.has(blocked.toolName)) {
            byTool.set(blocked.toolName, {
                tool: blocked.toolName,
                capability: null,
                allowed: false,
                code: 'blocked',
                score: null,
                reason: blocked.reason,
                missingSlots: blocked.missingSlots,
            });
        }
    }

    return Array.from(byTool.values()).slice(0, 8);
}

function parsePresentSlotInsights(metadata: unknown): AutopilotDecisionPresentSlotInsight[] {
    const slotSummary = parseObject(parseObject(metadata).slotSummary);
    const presentSlots = parseJsonValue(slotSummary.presentSlots);
    if (!Array.isArray(presentSlots)) return [];
    return presentSlots
        .map((item): AutopilotDecisionPresentSlotInsight | null => {
            const record = parseObject(item);
            const name = String(record.name || '').trim();
            if (!name) return null;
            return {
                name,
                source: typeof record.source === 'string' ? record.source : null,
                confidence: parseOptionalNumber(record.confidence),
            };
        })
        .filter((item): item is AutopilotDecisionPresentSlotInsight => item !== null)
        .slice(0, 8);
}

function parseInvalidSlotInsights(metadata: unknown): AutopilotDecisionInvalidSlotInsight[] {
    const slotSummary = parseObject(parseObject(metadata).slotSummary);
    const invalidSlots = parseJsonValue(slotSummary.invalidSlots);
    if (!Array.isArray(invalidSlots)) return [];
    return invalidSlots
        .map((item): AutopilotDecisionInvalidSlotInsight | null => {
            const record = parseObject(item);
            const name = String(record.name || '').trim();
            if (!name) return null;
            return {
                name,
                reason: typeof record.reason === 'string' ? record.reason : null,
            };
        })
        .filter((item): item is AutopilotDecisionInvalidSlotInsight => item !== null)
        .slice(0, 8);
}

function parseSwitchRouteInsights(value: unknown): AutopilotDecisionSwitchRouteInsight[] {
    const parsed = parseJsonValue(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
        .map((item): AutopilotDecisionSwitchRouteInsight | null => {
            const record = parseObject(item);
            const routeId = String(record.routeId || '').trim();
            if (!routeId) return null;
            return {
                routeId,
                routeLabel: typeof record.routeLabel === 'string' ? record.routeLabel : null,
                targetNodeId: typeof record.targetNodeId === 'string' ? record.targetNodeId : null,
                confidence: parseOptionalNumber(record.confidence),
                selected: Boolean(record.selected),
                fallback: Boolean(record.fallback),
                rejectedReason: typeof record.rejectedReason === 'string' ? record.rejectedReason : null,
            };
        })
        .filter((item): item is AutopilotDecisionSwitchRouteInsight => item !== null)
        .slice(0, 8);
}

function parseSwitchResolutionInsight(metadata: unknown): AutopilotDecisionSwitchInsight | null {
    const switchResolution = parseObject(parseObject(metadata).switchResolution);
    const switchNodeId = String(switchResolution.switchNodeId || '').trim();
    const routeId = String(switchResolution.routeId || '').trim();
    if (!switchNodeId || !routeId) return null;
    const candidateRoutes = parseSwitchRouteInsights(switchResolution.candidateRoutes);
    const rejectedRoutes = parseSwitchRouteInsights(switchResolution.rejectedRoutes);

    return {
        switchNodeId,
        routeId,
        routeLabel: typeof switchResolution.routeLabel === 'string' ? switchResolution.routeLabel : null,
        targetNodeId: typeof switchResolution.targetNodeId === 'string' ? switchResolution.targetNodeId : null,
        confidence: parseOptionalNumber(switchResolution.confidence),
        fallbackUsed: Boolean(switchResolution.fallbackUsed),
        candidateRoutes,
        rejectedRoutes: rejectedRoutes.length > 0
            ? rejectedRoutes
            : candidateRoutes.filter((candidate) => !candidate.selected),
    };
}

function parseResourceMappingFieldInsights(value: unknown): AutopilotResourceMappingFieldInsight[] {
    const parsed = parseJsonValue(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
        .map((item): AutopilotResourceMappingFieldInsight | null => {
            const record = parseObject(item);
            const slot = String(record.slot || record.slotName || '').trim();
            if (!slot) return null;
            return {
                slot,
                fieldId: typeof record.fieldId === 'string' ? record.fieldId : null,
                fieldLabel: typeof record.fieldLabel === 'string'
                    ? record.fieldLabel
                    : typeof record.field === 'string'
                        ? record.field
                        : null,
                confidence: parseOptionalNumber(record.confidence),
                source: typeof record.source === 'string' ? record.source : null,
                reason: typeof record.reason === 'string'
                    ? record.reason
                    : Array.isArray(record.matchReasons)
                        ? record.matchReasons.map((item) => String(item)).join(', ')
                        : null,
            };
        })
        .filter((item): item is AutopilotResourceMappingFieldInsight => item !== null);
}

function countBy<T extends string>(values: T[]): Array<{ key: T; count: number }> {
    const counts = new Map<T, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) || 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count);
}

async function resolveAutopilotConfigWorkspace(configId: string, userId: string) {
    const configRes = await db.query(
        `SELECT c.id, c.workspace_id, w.vertical
         FROM autopilot_configs c
         LEFT JOIN workspaces w ON w.id = c.workspace_id
         WHERE c.id = $1
         LIMIT 1`,
        [configId],
    );
    const config = configRes.rows[0];
    if (!config) return { error: 'Agente nao encontrado.' };
    if (!(await isWorkspaceMember(userId, config.workspace_id))) {
        return { error: 'Voce nao tem acesso a este workspace.' };
    }
    return {
        workspaceId: config.workspace_id as string,
        vertical: typeof config.vertical === 'string' && config.vertical.trim().length > 0
            ? config.vertical.trim().toLowerCase()
            : null,
    };
}

async function isAllowedModelForWorkspace(
    workspaceId: string,
    model?: string | null,
): Promise<boolean> {
    if (!model || model.trim().length === 0) return false;
    if (await isAllowedAutopilotModel(model)) return true;
    return isWorkspaceConfiguredAiModel(workspaceId, model);
}

async function optionalDecisionInsightQuery<T extends { rows: any[] }>(
    label: string,
    query: Promise<T>,
): Promise<T> {
    try {
        return await query;
    } catch (error) {
        console.warn(`[GET_AUTOPILOT_DECISION_INSIGHTS] Consulta opcional indisponivel (${label}):`, error);
        return { rows: [] } as unknown as T;
    }
}

export async function getAutopilotDecisionInsights(configId: string): Promise<{
    insights: AutopilotDecisionInsights | null;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { insights: null, error: 'Usuario nao autenticado.' };

    try {
        const resolved = await resolveAutopilotConfigWorkspace(configId, user.id);
        if (resolved.error || !resolved.workspaceId) return { insights: null, error: resolved.error };

        const [decisionsRes, patternsRes, impactDecisionsRes, applicationsRes, ecosystemPatternsRes, scoreHistoryRes, resourceMappingsRes] = await Promise.all([
            optionalDecisionInsightQuery('agent_decision_ledger.recent', db.query(
                `SELECT id, decision_type, goal, procedure_id, step_id,
                        selected_tool, selected_tools_json, blocked_tools_json,
                        missing_slots_json, confidence, outcome_json, metadata, created_at
                 FROM agent_decision_ledger
                 WHERE workspace_id = $1
                   AND autopilot_config_id = $2
                 ORDER BY created_at DESC
                 LIMIT 80`,
                [resolved.workspaceId, configId],
            )),
            optionalDecisionInsightQuery('agent_causal_patterns.active', db.query(
                `SELECT p.id, p.pattern_type, p.procedure_id, p.step_id, p.switch_node_id, p.switch_route_id,
                        p.tool_name, p.insight, p.evidence_json, p.suggested_fix_json, p.impact_json,
                        p.confidence, p.status, p.applied_at, p.created_at,
                        a.status AS application_status,
                        a.application_type AS application_type,
                        a.created_at AS application_created_at
                 FROM agent_causal_patterns p
                 LEFT JOIN agent_causal_pattern_applications a
                   ON a.workspace_id = p.workspace_id
                  AND a.config_id = $2
                  AND a.pattern_id = p.id
                 WHERE p.workspace_id = $1
                   AND p.status IN ('pending', 'approved', 'applied')
                 ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'applied' THEN 2 ELSE 3 END,
                          p.confidence DESC,
                          p.created_at DESC
                LIMIT 12`,
                [resolved.workspaceId, configId],
            )),
            optionalDecisionInsightQuery('agent_decision_ledger.outcomes', db.query(
                `SELECT decision_type, procedure_id, step_id, selected_tool, selected_tools_json,
                        metadata, outcome_json, created_at
                 FROM agent_decision_ledger
                 WHERE workspace_id = $1
                   AND autopilot_config_id = $2
                   AND outcome_json IS NOT NULL
                   AND created_at >= clock_timestamp() - (90::int * interval '1 day')
                 ORDER BY created_at ASC
                LIMIT 2000`,
                [resolved.workspaceId, configId],
            )),
            optionalDecisionInsightQuery('agent_causal_pattern_applications.recent', db.query(
                `SELECT a.id, a.pattern_id, a.application_type, a.status,
                        a.before_snapshot_hash, a.after_snapshot_hash,
                        a.patch_json, a.created_at,
                        p.pattern_type, p.insight, p.review_metadata
                 FROM agent_causal_pattern_applications a
                 INNER JOIN agent_causal_patterns p
                   ON p.id = a.pattern_id
                  AND p.workspace_id = a.workspace_id
                 WHERE a.workspace_id = $1
                   AND a.config_id = $2
                 ORDER BY a.created_at DESC
                LIMIT 10`,
                [resolved.workspaceId, configId],
            )),
            optionalDecisionInsightQuery('agent_ecosystem_patterns.available', db.query(
                `SELECT e.id, e.fingerprint, e.pattern_type, e.vertical, e.insight,
                        e.evidence_json, e.suggested_fix_json, e.source_workspace_count,
                        e.sample_size, e.confidence, e.status, e.validated_at, e.created_at
                 FROM agent_ecosystem_patterns e
                 WHERE e.vertical = $2
                   AND e.status IN ('validated', 'active')
                   AND NOT EXISTS (
                     SELECT 1
                     FROM agent_causal_patterns p
                     WHERE p.workspace_id = $1
                       AND p.fingerprint = e.fingerprint
                       AND p.status IN ('pending', 'approved', 'applied', 'dismissed', 'conflicted')
                   )
                 ORDER BY CASE e.status WHEN 'active' THEN 0 ELSE 1 END,
                          e.confidence DESC,
                          e.validated_at DESC NULLS LAST,
                          e.created_at DESC
                 LIMIT 6`,
                [resolved.workspaceId, resolved.vertical || '__none__'],
            )),
            optionalDecisionInsightQuery('agent_score_history.recent', db.query(
                `SELECT id, weights_json, source, evidence_pattern_id, reason, applied_at
                 FROM agent_score_history
                 WHERE workspace_id = $1
                   AND (autopilot_config_id = $2 OR autopilot_config_id IS NULL)
                 ORDER BY applied_at DESC
                 LIMIT 8`,
                [resolved.workspaceId, configId],
            )),
            optionalDecisionInsightQuery('resource_mapping_ledger.recent', db.query(
                `SELECT id, resource, operation, status, confidence, mapped_fields_json,
                        rejected_fields_json, payload_hash, created_at
                 FROM resource_mapping_ledger
                 WHERE workspace_id = $1
                 ORDER BY created_at DESC
                 LIMIT 12`,
                [resolved.workspaceId],
            )),
        ]);

        const decisions = decisionsRes.rows.map((row): AutopilotDecisionInsightItem => {
            const outcome = parseObject(row.outcome_json);
            const selectedTools = parseStringList(row.selected_tools_json);
            const blockedTools = parseBlockedToolInsights(row.blocked_tools_json);
            const metadata = parseObject(row.metadata);
            return {
                id: row.id,
                stage: row.decision_type || 'runtime',
                decisionType: row.decision_type,
                goal: row.goal || null,
                procedureId: row.procedure_id || null,
                stepId: row.step_id || null,
                selectedTool: row.selected_tool || null,
                selectedTools,
                candidateTools: parseCandidateToolInsights({
                    metadata,
                    selectedTools,
                    blockedTools,
                }),
                blockedTools,
                blockedToolsCount: blockedTools.length,
                presentSlots: parsePresentSlotInsights(metadata),
                invalidSlots: parseInvalidSlotInsights(metadata),
                requiredSlots: parseStringList(row.missing_slots_json),
                switchResolution: parseSwitchResolutionInsight(metadata),
                confidence: row.confidence == null ? null : Number(row.confidence),
                outcomeResolutionType: typeof outcome.resolutionType === 'string' ? outcome.resolutionType : null,
                outcomeResolved: typeof outcome.resolved === 'boolean' ? outcome.resolved : null,
                createdAt: new Date(row.created_at).toISOString(),
            };
        });

        const impactDecisions = impactDecisionsRes.rows
            .map((row): CausalPatternImpactDecision | null => {
                const outcome = parseObject(row.outcome_json);
                if (typeof outcome.resolved !== 'boolean'
                    || typeof outcome.resolutionType !== 'string'
                    || !Array.isArray(outcome.toolsExecuted)
                    || !Array.isArray(outcome.toolsFailed)) {
                    return null;
                }
                return {
                    createdAt: row.created_at,
                    decisionType: String(row.decision_type || ''),
                    procedureId: row.procedure_id || null,
                    stepId: row.step_id || null,
                    selectedTool: row.selected_tool || null,
                    selectedTools: parseStringList(row.selected_tools_json),
                    metadata: parseObject(row.metadata),
                    outcome: {
                        resolved: outcome.resolved,
                        resolutionType: outcome.resolutionType as any,
                        turnsToResolve: typeof outcome.turnsToResolve === 'number' ? outcome.turnsToResolve : 0,
                        timeToResolutionSeconds: typeof outcome.timeToResolutionSeconds === 'number' ? outcome.timeToResolutionSeconds : null,
                        customerAskedForHuman: Boolean(outcome.customerAskedForHuman),
                        customerSentimentFinal: typeof outcome.customerSentimentFinal === 'string' ? outcome.customerSentimentFinal as any : 'neutral',
                        toolsExecuted: parseStringList(outcome.toolsExecuted),
                        toolsFailed: parseStringList(outcome.toolsFailed),
                        escalationNeeded: Boolean(outcome.escalationNeeded),
                        closedBy: typeof outcome.closedBy === 'string' ? outcome.closedBy as any : null,
                        chatStatus: typeof outcome.chatStatus === 'string' ? outcome.chatStatus : null,
                        stepOutcomes: Array.isArray(outcome.stepOutcomes) ? outcome.stepOutcomes as any : [],
                    },
                };
            })
            .filter((decision): decision is CausalPatternImpactDecision => decision !== null);

        const patterns = patternsRes.rows.map((row): AutopilotCausalPatternInsight => {
            const appliedAt = row.applied_at
                ? new Date(row.applied_at).toISOString()
                : row.application_created_at
                    ? new Date(row.application_created_at).toISOString()
                    : null;
            const applicationStatus = row.application_status || null;
            const applicationImpact = row.status === 'applied'
                ? buildCausalPatternImpactReport({
                    id: row.id,
                    patternType: row.pattern_type,
                    procedureId: row.procedure_id || null,
                    stepId: row.step_id || null,
                    switchNodeId: row.switch_node_id || null,
                    switchRouteId: row.switch_route_id || null,
                    toolName: row.tool_name || null,
                    appliedAt,
                    applicationStatus,
                }, impactDecisions)
                : null;

            return ({
                id: row.id,
                patternType: row.pattern_type,
                procedureId: row.procedure_id || null,
                stepId: row.step_id || null,
                switchNodeId: row.switch_node_id || null,
                switchRouteId: row.switch_route_id || null,
                toolName: row.tool_name || null,
                insight: row.insight,
                evidence: parseObject(row.evidence_json),
                suggestedFix: parseObject(row.suggested_fix_json),
                impact: parseObject(row.impact_json),
                confidence: row.confidence == null ? 0 : Number(row.confidence),
                status: row.status,
                applicationStatus,
                applicationType: row.application_type || null,
                appliedAt,
                applicationImpact,
                createdAt: new Date(row.created_at).toISOString(),
            });
        });

        const recentApplications = applicationsRes.rows.map((row): AutopilotCausalPatternApplicationInsight => {
            const patch = parseObject(row.patch_json);
            const reviewMetadata = parseObject(row.review_metadata);
            const publication = parseObject(patch.publication);
            const rollback = parseObject(patch.rollback);
            const graphPatch = parseObject(patch.graphPatch);
            const rawSource = typeof patch.applicationSource === 'string'
                ? patch.applicationSource
                : typeof reviewMetadata.applicationSource === 'string'
                    ? reviewMetadata.applicationSource
                    : 'unknown';
            const applicationSource = rawSource === 'manual' || rawSource === 'safe_auto_tune'
                ? rawSource
                : 'unknown';
            const graphPatchOperations = Array.isArray(graphPatch.operations) ? graphPatch.operations : [];

            return {
                id: row.id,
                patternId: row.pattern_id,
                patternType: row.pattern_type,
                insight: row.insight,
                applicationType: row.application_type,
                applicationSource,
                status: row.status,
                beforeSnapshotHash: row.before_snapshot_hash,
                afterSnapshotHash: row.after_snapshot_hash,
                graphPatchIncluded: Boolean(patch.graphPatchIncluded),
                graphPatchOperationCount: typeof graphPatch.operationCount === 'number'
                    ? graphPatch.operationCount
                    : graphPatchOperations.length,
                publishedVersionNumber: typeof publication.versionNumber === 'number'
                    ? publication.versionNumber
                    : null,
                publishedAt: typeof publication.publishedAt === 'string' ? publication.publishedAt : null,
                revertedAt: typeof rollback.revertedAt === 'string' ? rollback.revertedAt : null,
                createdAt: new Date(row.created_at).toISOString(),
            };
        });

        const ecosystemPatterns = ecosystemPatternsRes.rows.map((row): AutopilotEcosystemPatternInsight => ({
            id: row.id,
            fingerprint: row.fingerprint,
            patternType: row.pattern_type,
            vertical: row.vertical,
            insight: row.insight,
            evidence: parseObject(row.evidence_json),
            suggestedFix: parseObject(row.suggested_fix_json),
            sourceWorkspaceCount: Number(row.source_workspace_count || 0),
            sampleSize: Number(row.sample_size || 0),
            confidence: row.confidence == null ? 0 : Number(row.confidence),
            status: row.status,
            validatedAt: row.validated_at ? new Date(row.validated_at).toISOString() : null,
            createdAt: new Date(row.created_at).toISOString(),
        }));

        const scoreHistory = scoreHistoryRes.rows.map((row): AutopilotScoreHistoryInsight => {
            const rawWeights = parseObject(row.weights_json);
            const weights = Object.fromEntries(
                Object.entries(rawWeights)
                    .map(([key, value]) => [key, Number(value)])
                    .filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
            );
            return {
                id: row.id,
                source: row.source,
                weights,
                evidencePatternId: row.evidence_pattern_id || null,
                reason: row.reason || null,
                appliedAt: new Date(row.applied_at).toISOString(),
            };
        });
        const resourceMappings = resourceMappingsRes.rows.map((row): AutopilotResourceMappingInsight => {
            const rejectedFields = parseJsonValue(row.rejected_fields_json);
            return {
                id: row.id,
                resource: row.resource,
                operation: row.operation,
                status: row.status,
                confidence: row.confidence == null ? null : Number(row.confidence),
                mappedFields: parseResourceMappingFieldInsights(row.mapped_fields_json).slice(0, 8),
                rejectedFieldsCount: Array.isArray(rejectedFields) ? rejectedFields.length : 0,
                payloadHash: row.payload_hash || null,
                createdAt: new Date(row.created_at).toISOString(),
            };
        });
        const learningTrend = buildAutopilotLearningTrend(impactDecisions);
        const procedureOutcomes = buildAutopilotProcedureOutcomeInsights(impactDecisions);
        const switchRouteOutcomes = buildAutopilotSwitchRouteOutcomeInsights(impactDecisions);

        const confidences = decisions
            .map((decision) => decision.confidence)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
        const decisionsWithOutcome = decisions.filter((decision) => decision.outcomeResolutionType);
        const decisionTypeCounts = countBy(decisions.map((decision) => decision.decisionType))
            .map(({ key, count }) => ({ decisionType: key, count }));
        const outcomeCounts = countBy(decisionsWithOutcome.map((decision) => decision.outcomeResolutionType || 'unknown'))
            .map(({ key, count }) => ({ resolutionType: key, count }));
        const pendingPatterns = patterns.filter((pattern) => pattern.status === 'pending').length;
        const approvedPatterns = patterns.filter((pattern) => pattern.status === 'approved').length;
        const appliedPatterns = patterns.filter((pattern) => pattern.status === 'applied').length;

        return {
            insights: {
                summary: {
                    totalDecisions: decisions.length,
                    decisionsWithOutcome: decisionsWithOutcome.length,
                    resolvedOutcomes: decisionsWithOutcome.filter((decision) => decision.outcomeResolved === true).length,
                    handoffOutcomes: decisionsWithOutcome.filter((decision) => decision.outcomeResolutionType === 'human_handoff').length,
                    averageConfidence: confidences.length > 0
                        ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(3))
                        : null,
                    blockedToolDecisions: decisions.filter((decision) => decision.blockedToolsCount > 0).length,
                    pendingPatterns,
                    approvedPatterns,
                    appliedPatterns,
                },
                decisionTypeCounts,
                outcomeCounts,
                recentDecisions: decisions.slice(0, 12),
                patterns,
                recentApplications,
                ecosystemPatterns,
                scoreHistory,
                learningTrend,
                procedureOutcomes,
                switchRouteOutcomes,
                resourceMappings,
            },
        };
    } catch (error) {
        console.error('[GET_AUTOPILOT_DECISION_INSIGHTS] Erro ao buscar insights:', error);
        return { insights: null, error: 'Falha ao buscar insights do motor de decisao.' };
    }
}

export async function refreshAutopilotDecisionPatterns(configId: string): Promise<{
    success: boolean;
    insights?: AutopilotDecisionInsights | null;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuario nao autenticado.' };

    try {
        const resolved = await resolveAutopilotConfigWorkspace(configId, user.id);
        if (resolved.error || !resolved.workspaceId) return { success: false, error: resolved.error };
        await detectAndPersistCausalPatternsForWorkspace({
            workspaceId: resolved.workspaceId,
            sinceDays: 30,
        });
        const nextInsights = await getAutopilotDecisionInsights(configId);
        return {
            success: !nextInsights.error,
            insights: nextInsights.insights,
            error: nextInsights.error,
        };
    } catch (error) {
        console.error('[REFRESH_AUTOPILOT_DECISION_PATTERNS] Erro ao atualizar padroes:', error);
        return { success: false, error: 'Falha ao atualizar aprendizados do agente.' };
    }
}

export async function importAutopilotEcosystemPattern(input: {
    configId: string;
    ecosystemPatternId: string;
}): Promise<{
    success: boolean;
    insights?: AutopilotDecisionInsights | null;
    patternId?: string;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuario nao autenticado.' };

    try {
        const resolved = await resolveAutopilotConfigWorkspace(input.configId, user.id);
        if (resolved.error || !resolved.workspaceId) return { success: false, error: resolved.error };
        if (!resolved.vertical) {
            return { success: false, error: 'Defina a vertical do workspace antes de importar sugestoes do ecossistema.' };
        }

        const imported = await importEcosystemPatternForWorkspace({
            workspaceId: resolved.workspaceId,
            ecosystemPatternId: input.ecosystemPatternId,
            vertical: resolved.vertical,
            importedByUserId: user.id,
        });
        if (imported.error || !imported.pattern) {
            return { success: false, error: imported.error || 'Falha ao importar sugestao do ecossistema.' };
        }

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${input.configId}`);

        const nextInsights = await getAutopilotDecisionInsights(input.configId);
        return {
            success: !nextInsights.error,
            insights: nextInsights.insights,
            patternId: imported.pattern.id,
            error: nextInsights.error,
        };
    } catch (error) {
        console.error('[IMPORT_AUTOPILOT_ECOSYSTEM_PATTERN] Erro ao importar padrao do ecossistema:', error);
        return { success: false, error: 'Falha ao importar sugestao do ecossistema.' };
    }
}

export async function reviewAutopilotCausalPattern(input: {
    configId: string;
    patternId: string;
    decision: CausalPatternReviewDecision;
    note?: string | null;
}): Promise<{
    success: boolean;
    insights?: AutopilotDecisionInsights | null;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuario nao autenticado.' };

    try {
        const resolved = await resolveAutopilotConfigWorkspace(input.configId, user.id);
        if (resolved.error || !resolved.workspaceId) return { success: false, error: resolved.error };
        const review = await reviewCausalPattern({
            workspaceId: resolved.workspaceId,
            patternId: input.patternId,
            decision: input.decision,
            reviewedByUserId: user.id,
            note: input.note,
        });
        if (review.error) return { success: false, error: review.error };

        const nextInsights = await getAutopilotDecisionInsights(input.configId);
        return {
            success: !nextInsights.error,
            insights: nextInsights.insights,
            error: nextInsights.error,
        };
    } catch (error) {
        console.error('[REVIEW_AUTOPILOT_CAUSAL_PATTERN] Erro ao revisar padrao:', error);
        return { success: false, error: 'Falha ao revisar sugestao do agente.' };
    }
}

export async function previewAutopilotCausalPatternApplication(input: {
    configId: string;
    patternId: string;
}): Promise<{
    success: boolean;
    preview?: AutopilotCausalPatternApplicationPreview | null;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuario nao autenticado.' };

    try {
        const resolved = await resolveAutopilotConfigWorkspace(input.configId, user.id);
        if (resolved.error || !resolved.workspaceId) return { success: false, error: resolved.error };

        const preview = await previewCausalPatternDraftApplication({
            workspaceId: resolved.workspaceId,
            configId: input.configId,
            patternId: input.patternId,
        });
        if (preview.error) return { success: false, error: preview.error };
        return { success: true, preview: preview.preview };
    } catch (error) {
        console.error('[PREVIEW_AUTOPILOT_CAUSAL_PATTERN_APPLICATION] Erro ao gerar preview:', error);
        return { success: false, error: 'Falha ao gerar preview da sugestao.' };
    }
}

export async function applyAutopilotCausalPattern(input: {
    configId: string;
    patternId: string;
    applicationMode?: 'full' | 'knowledge_only';
}): Promise<{
    success: boolean;
    insights?: AutopilotDecisionInsights | null;
    draftUpdatedAt?: string;
    documentId?: string;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuario nao autenticado.' };

    try {
        const resolved = await resolveAutopilotConfigWorkspace(input.configId, user.id);
        if (resolved.error || !resolved.workspaceId) return { success: false, error: resolved.error };

        const applied = await applyCausalPatternToDraft({
            workspaceId: resolved.workspaceId,
            configId: input.configId,
            patternId: input.patternId,
            userId: user.id,
            includeGraphPatch: input.applicationMode !== 'knowledge_only',
        });
        if (!applied.success) return { success: false, error: applied.error };

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${input.configId}`);

        const nextInsights = await getAutopilotDecisionInsights(input.configId);
        return {
            success: !nextInsights.error,
            insights: nextInsights.insights,
            draftUpdatedAt: applied.draftUpdatedAt,
            documentId: applied.documentId,
            error: nextInsights.error,
        };
    } catch (error) {
        console.error('[APPLY_AUTOPILOT_CAUSAL_PATTERN] Erro ao aplicar padrao:', error);
        return { success: false, error: 'Falha ao aplicar sugestao no rascunho.' };
    }
}

export async function applySafeAutopilotCausalPatternAutoTune(input: {
    configId: string;
}): Promise<{
    success: boolean;
    insights?: AutopilotDecisionInsights | null;
    appliedCount?: number;
    skippedCount?: number;
    draftUpdatedAt?: string;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuario nao autenticado.' };

    try {
        const resolved = await resolveAutopilotConfigWorkspace(input.configId, user.id);
        if (resolved.error || !resolved.workspaceId) return { success: false, error: resolved.error };

        const result = await applySafeCausalPatternAutoTuneToDraft({
            workspaceId: resolved.workspaceId,
            configId: input.configId,
            userId: user.id,
        });
        if (!result.success && result.appliedCount === 0) {
            return { success: false, error: result.error || 'Nenhum aprendizado seguro foi aplicado.' };
        }

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${input.configId}`);

        const nextInsights = await getAutopilotDecisionInsights(input.configId);
        return {
            success: !nextInsights.error && result.errors.length === 0,
            insights: nextInsights.insights,
            appliedCount: result.appliedCount,
            skippedCount: result.skippedCount,
            draftUpdatedAt: result.draftUpdatedAt,
            error: result.errors.length > 0 ? result.error : nextInsights.error,
        };
    } catch (error) {
        console.error('[SAFE_AUTOPILOT_CAUSAL_PATTERN_AUTO_TUNE] Erro ao executar auto-tune:', error);
        return { success: false, error: 'Falha ao executar auto-tune seguro.' };
    }
}

export async function applyAutopilotScoreSuggestion(input: {
    configId: string;
    scoreHistoryId: string;
}): Promise<{
    success: boolean;
    insights?: AutopilotDecisionInsights | null;
    appliedScoreHistoryId?: string;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuario nao autenticado.' };

    try {
        const resolved = await resolveAutopilotConfigWorkspace(input.configId, user.id);
        if (resolved.error || !resolved.workspaceId) return { success: false, error: resolved.error };

        const suggestionRes = await db.query(
            `SELECT id, workspace_id, agent_id, autopilot_config_id, weights_json, reason, evidence_pattern_id, source
               FROM agent_score_history
              WHERE id = $1
                AND workspace_id = $2
                AND source = 'suggestion'
                AND (autopilot_config_id = $3 OR autopilot_config_id IS NULL)
              LIMIT 1`,
            [input.scoreHistoryId, resolved.workspaceId, input.configId],
        );
        const suggestion = suggestionRes.rows[0];
        if (!suggestion) {
            return { success: false, error: 'Sugestao de score nao encontrada ou ja aplicada.' };
        }

        const applied = await recordAgentScoreHistory({
            workspaceId: resolved.workspaceId,
            agentId: suggestion.agent_id || null,
            autopilotConfigId: suggestion.autopilot_config_id || input.configId,
            weights: normalizeToolSelectionScoreWeights(parseObject(suggestion.weights_json) as any),
            source: 'manual',
            evidencePatternId: suggestion.evidence_pattern_id || null,
            reason: `Aplicado manualmente a partir da sugestao ${suggestion.id}. ${suggestion.reason || ''}`.trim(),
            userId: user.id,
        });

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${input.configId}`);

        const nextInsights = await getAutopilotDecisionInsights(input.configId);
        return {
            success: Boolean(applied) && !nextInsights.error,
            insights: nextInsights.insights,
            appliedScoreHistoryId: applied?.id,
            error: nextInsights.error,
        };
    } catch (error) {
        console.error('[APPLY_AUTOPILOT_SCORE_SUGGESTION] Erro ao aplicar sugestao de score:', error);
        return { success: false, error: 'Falha ao aplicar pesos do score.' };
    }
}

export async function revertAutopilotCausalPatternApplication(input: {
    configId: string;
    patternId: string;
}): Promise<{
    success: boolean;
    insights?: AutopilotDecisionInsights | null;
    draftUpdatedAt?: string;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuario nao autenticado.' };

    try {
        const resolved = await resolveAutopilotConfigWorkspace(input.configId, user.id);
        if (resolved.error || !resolved.workspaceId) return { success: false, error: resolved.error };

        const reverted = await revertCausalPatternDraftApplication({
            workspaceId: resolved.workspaceId,
            configId: input.configId,
            patternId: input.patternId,
            userId: user.id,
        });
        if (!reverted.success) return { success: false, error: reverted.error };

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${input.configId}`);

        const nextInsights = await getAutopilotDecisionInsights(input.configId);
        return {
            success: !nextInsights.error,
            insights: nextInsights.insights,
            draftUpdatedAt: reverted.draftUpdatedAt,
            error: nextInsights.error,
        };
    } catch (error) {
        console.error('[REVERT_AUTOPILOT_CAUSAL_PATTERN_APPLICATION] Erro ao reverter aplicacao:', error);
        return { success: false, error: 'Falha ao reverter sugestao no rascunho.' };
    }
}

export async function addDocumentToKnowledgeBase(
    workspaceId: string,
    title: string,
    content: string
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    if (!await isWorkspaceMember(user.id, workspaceId)) {
        return { success: false, error: 'Acesso não autorizado.' };
    }

    // Try to find the user's own PRIVATE agent first, then their own SHARED, then fallback to primary
    try {
        const configRes = await db.query(
            `SELECT * FROM autopilot_configs 
             WHERE workspace_id = $1 
             ORDER BY CASE WHEN user_id = $2 THEN 0 ELSE 1 END, is_private DESC, is_primary DESC, created_at ASC 
             LIMIT 1`,
            [workspaceId, user.id]
        );

        if (configRes.rowCount === 0) {
            return { success: false, error: 'Nenhum agente de IA encontrado neste workspace.' };
        }

        const config = configRes.rows[0];
        const currentDocs: KnowledgeBaseDocument[] = typeof config.knowledge_base_documents === 'string'
            ? JSON.parse(config.knowledge_base_documents)
            : Array.isArray(config.knowledge_base_documents)
                ? config.knowledge_base_documents
                : [];

        const docId = uuidv4();
        const newDoc: KnowledgeBaseDocument = {
            id: docId,
            name: title,
            content: content,
            sourceFormat: 'markdown',
            uploaded_at: new Date().toISOString(),
            tokens: 0 // We could estimate tokens here if needed
        };

        const updatedDocs = [...currentDocs, newDoc];

        await db.query(
            'UPDATE autopilot_configs SET knowledge_base_documents = $1, updated_at = NOW() WHERE id = $2',
            [JSON.stringify(updatedDocs), config.id]
        );

        try {
            if (shouldEnqueueJob('ai_document_ingest')) {
                await enqueueAiDocumentIngest({
                    workspaceId,
                    autopilotConfigId: config.id,
                    documentId: docId,
                    documentName: title,
                    content,
                    document: newDoc,
                });
            } else {
                await ingestKnowledgeBaseDocument({
                    workspaceId,
                    autopilotConfigId: config.id,
                    documentId: docId,
                    documentName: title,
                    content,
                    document: newDoc,
                });
            }
        } catch (ragError) {
            console.error('[RAG] Failed to enqueue document ingestion:', ragError);
        }

        revalidatePath('/autopilot');
        return { success: true };

    } catch (error) {
        console.error('[ADD_DOC_KB] Erro ao adicionar documento:', error);
        return { success: false, error: 'Falha ao salvar o documento na base de conhecimento.' };
    }
}
