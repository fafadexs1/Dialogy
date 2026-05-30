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
import { DOCUMENT_EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { ingestKnowledgeBaseDocument } from '@/services/rag/document-ingestion';
import { VectorStore } from '@/lib/vector-store';
import { isUnsafeAsCustomerFacingKnowledge } from '@/services/rag/document-safety';
import { retrieveHybridSupportContext } from '@/services/rag/hybrid-retrieval';
import { buildRagLabCases, summarizeRagLabResults, type RagLabCaseResult, type RagLabReport } from '@/services/rag/evaluation';
import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { filterKnowledgeDocumentsForScope, resolveActiveFlowIntentScope } from '@/services/autopilot/flow-routing';
import { isAllowedAutopilotModel } from '@/services/ai/model-selection';
import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';
import { listMcpToolsForWorkspace } from '@/services/mcp/store';
import { normalizeGoogleAiModelId } from '@/lib/ai-models';


async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
    const res = await db.query('SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]);
    return (res.rowCount ?? 0) > 0;
}

async function ensureAutopilotToolColumns(): Promise<void> {
    await db.query(`
        ALTER TABLE IF EXISTS autopilot_configs
        ADD COLUMN IF NOT EXISTS enabled_tool_names jsonb,
        ADD COLUMN IF NOT EXISTS transcription_model text,
        ADD COLUMN IF NOT EXISTS flow_graph jsonb,
        ADD COLUMN IF NOT EXISTS knowledge_collections jsonb
    `);
}

async function ensureAutopilotVersioningTables(): Promise<void> {
    await ensureAutopilotToolColumns();
    await db.query(`
        CREATE TABLE IF NOT EXISTS autopilot_config_drafts (
            config_id uuid PRIMARY KEY,
            workspace_id uuid NOT NULL,
            user_id uuid NOT NULL,
            snapshot jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
            updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
            CONSTRAINT autopilot_config_drafts_config_id_fkey
                FOREIGN KEY (config_id) REFERENCES autopilot_configs(id) ON DELETE CASCADE,
            CONSTRAINT autopilot_config_drafts_workspace_id_fkey
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
            CONSTRAINT autopilot_config_drafts_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_autopilot_config_drafts_workspace
            ON autopilot_config_drafts(workspace_id);

        CREATE TABLE IF NOT EXISTS autopilot_config_versions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            config_id uuid NOT NULL,
            workspace_id uuid NOT NULL,
            user_id uuid,
            version_number int NOT NULL,
            label text,
            snapshot jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
            CONSTRAINT autopilot_config_versions_config_id_fkey
                FOREIGN KEY (config_id) REFERENCES autopilot_configs(id) ON DELETE CASCADE,
            CONSTRAINT autopilot_config_versions_workspace_id_fkey
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
            CONSTRAINT autopilot_config_versions_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT autopilot_config_versions_config_number_key
                UNIQUE (config_id, version_number)
        );

        CREATE INDEX IF NOT EXISTS idx_autopilot_config_versions_config_created
            ON autopilot_config_versions(config_id, version_number DESC);
    `);
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
    return graph as AutopilotFlowGraph;
}

function readFormBoolean(formData: FormData, field: string, fallback = false): boolean {
    if (!formData.has(field)) return fallback;
    const value = formData.get(field);
    const normalized = typeof value === 'string' ? value : '';
    return normalized === 'true' || normalized === 'on' || normalized === '1';
}

function buildSnapshotFromConfigRow(row: any): AutopilotConfigDraftSnapshot {
    return {
        name: row.name || 'Meu agente de IA',
        gemini_api_key: row.gemini_api_key || null,
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
        enabled_tool_names: normalizeEnabledToolNames(row.enabled_tool_names),
        flow_graph: parseFlowGraph(row.flow_graph),
    };
}

function normalizeDraftSnapshot(
    raw: unknown,
    fallback: AutopilotConfigDraftSnapshot,
): AutopilotConfigDraftSnapshot {
    const snapshot = raw && typeof raw === 'object' ? raw as Partial<AutopilotConfigDraftSnapshot> : {};
    const hasOwn = (key: keyof AutopilotConfigDraftSnapshot) =>
        Object.prototype.hasOwnProperty.call(snapshot, key);

    return {
        name: typeof snapshot.name === 'string' && snapshot.name.trim().length > 0
            ? snapshot.name
            : fallback.name,
        gemini_api_key: hasOwn('gemini_api_key')
            ? (typeof snapshot.gemini_api_key === 'string' && snapshot.gemini_api_key.length > 0 ? snapshot.gemini_api_key : null)
            : fallback.gemini_api_key,
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
        enabled_tool_names: Array.isArray(snapshot.enabled_tool_names)
            ? normalizeEnabledToolNames(snapshot.enabled_tool_names)
            : fallback.enabled_tool_names,
        flow_graph: hasOwn('flow_graph')
            ? parseFlowGraph(snapshot.flow_graph)
            : fallback.flow_graph || null,
    };
}

async function buildSnapshotFromFormData(
    formData: FormData,
    fallback: AutopilotConfigDraftSnapshot,
): Promise<AutopilotConfigDraftSnapshot> {
    const requestedModel = formData.get('aiModel')?.toString() || fallback.ai_model || '';
    if (requestedModel && !(await isAllowedAutopilotModel(requestedModel))) {
        throw new Error('Modelo de IA nao esta habilitado no catalogo global.');
    }

    let documents = fallback.knowledge_base_documents;
    if (formData.has('knowledgeBaseDocuments')) {
        const parsedDocs = parseKnowledgeBaseDocuments(formData.get('knowledgeBaseDocuments')?.toString() || '[]');
        documents = parsedDocs;
    }
    const collections = formData.has('knowledgeCollections')
        ? parseKnowledgeCollections(formData.get('knowledgeCollections')?.toString() || '[]')
        : fallback.knowledge_collections || [];

    return {
        name: formData.get('agentName')?.toString() || fallback.name || 'Meu agente de IA',
        gemini_api_key: formData.has('geminiApiKey')
            ? (formData.get('geminiApiKey')?.toString() || null)
            : fallback.gemini_api_key,
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
        enabled_tool_names: formData.has('enabledToolNames')
            ? normalizeEnabledToolNames(formData.get('enabledToolNames')?.toString() || '[]')
            : fallback.enabled_tool_names,
        flow_graph: formData.has('flowGraph')
            ? parseFlowGraph(formData.get('flowGraph')?.toString() || '')
            : fallback.flow_graph || null,
    };
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
}): Promise<void> {
    const previousById = new Map(previousDocs.map((doc) => [doc.id, doc]));
    const nextById = new Map(nextDocs.map((doc) => [doc.id, doc]));

    const removedDocs = previousDocs.filter((doc) => !nextById.has(doc.id));
    const changedDocs = nextDocs.filter((doc) => {
        const previous = previousById.get(doc.id);
        return !previous || previous.name !== doc.name || previous.content !== doc.content;
    });

    await Promise.all(
        removedDocs.map((doc) =>
            VectorStore.deleteDocumentEmbeddings(doc.id).catch((ragError) => {
                console.error('[RAG] Failed to remove document embeddings:', ragError);
            })
        )
    );

    for (const doc of changedDocs) {
        const content = (doc.content || '').trim();
        if (!content) {
            await VectorStore.deleteDocumentEmbeddings(doc.id).catch((ragError) => {
                console.error('[RAG] Failed to clear empty document embeddings:', ragError);
            });
            continue;
        }

        try {
            await VectorStore.deleteDocumentEmbeddings(doc.id);
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
                    COUNT(*) FILTER (WHERE vector_dims(vector) <> ${DOCUMENT_EMBEDDING_DIMENSIONS})::int AS wrong_dims
                 FROM embeddings_documents
                 WHERE workspace_id = $1
                   AND autopilot_config_id = $2
                   AND document_id::text = ANY($3::text[])
                 GROUP BY document_id`,
                [workspaceId, configId, documentIds]
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
        await Promise.all(quarantinedDocuments.map((document) => VectorStore.deleteDocumentEmbeddings(document.id)));
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
            const allowedDocumentIds = scope?.knowledgeCollectionIds?.length
                ? scopedDocuments.map((document) => document.id)
                : undefined;
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

export async function getAgentToolCatalogAction(workspaceId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { tools: [], error: 'UsuÃ¡rio nÃ£o autenticado.' };
    }
    if (!await isWorkspaceMember(user.id, workspaceId)) {
        return { tools: [], error: 'Acesso nÃ£o autorizado.' };
    }

    const mcpTools = await listMcpToolsForWorkspace(workspaceId);
    const mcpCatalogItems = mcpTools.map((tool) => ({
        name: tool.qualifiedName as any,
        version: 'mcp',
        description: tool.description || tool.title || `Ferramenta MCP ${tool.name} em ${tool.serverName}.`,
        class: tool.annotations?.readOnlyHint ? 'read_only' as const : 'retrieval' as const,
        riskLevel: tool.annotations?.destructiveHint ? 'high' as const : 'medium' as const,
        sideEffect: tool.annotations?.destructiveHint ? 'high' as const : tool.annotations?.readOnlyHint ? 'none' as const : 'medium' as const,
        idempotent: Boolean(tool.annotations?.idempotentHint || tool.annotations?.readOnlyHint),
        timeoutMs: Number.parseInt(process.env.AI_ORCHESTRATOR_TOOL_TIMEOUT_MS || '', 10) || 8000,
        maxAttempts: 1,
        requiresHumanApproval: Boolean(tool.annotations?.destructiveHint),
        customerVisible: true,
        allowedIntents: [],
        requiredSlots: [],
        fallbackAction: 'handoff' as const,
        source: 'mcp' as const,
        enabledByDefault: false,
        serverId: tool.serverId,
        serverName: tool.serverName,
        inputSchema: tool.inputSchema || null,
        outputSchema: null,
    }));

    return { tools: [...listAgentToolCatalogItems(), ...mcpCatalogItems] };
}


export async function getAutopilotConfig(workspaceId: string, agentId?: string): Promise<{
    config: AutopilotConfig | null,
    rules: NexusFlowInstance[] | null,
    agents: AutopilotConfig[] | null,
    draft?: AutopilotConfigDraft | null,
    versions?: AutopilotConfigVersionSummary[],
    workspace: Workspace | null,
    workspaceDefaultAiModel?: string | null,
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
        const configRes = await db.query('SELECT * FROM autopilot_configs WHERE workspace_id = $1 ORDER BY created_at', [workspaceId]);

        // Fetch workspace details (global messages)
        const workspaceRes = await db.query('SELECT * FROM workspaces WHERE id = $1', [workspaceId]);
        const workspace = workspaceRes.rows[0] as Workspace || null;

        if (configRes.rowCount === 0) {
            return { config: null, rules: [], agents: [], workspace };
        }

        const agents = configRes.rows.map((row: any) => {
            return {
                ...row,
                knowledge_base_documents: parseKnowledgeBaseDocuments(row.knowledge_base_documents),
                knowledge_collections: parseKnowledgeCollections(row.knowledge_collections),
                enabled_tool_names: normalizeEnabledToolNames(row.enabled_tool_names),
                is_active: Boolean(row.is_active),
                is_primary: Boolean(row.is_primary),
                is_private: Boolean(row.is_private),
                default_fallback_reply: row.default_fallback_reply || null,
                flow_graph: parseFlowGraph(row.flow_graph),
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
             ORDER BY version_number DESC
             LIMIT 12`,
            [selectedConfig.id]
        );
        const versions = versionsRes.rows.map((row) => ({
            ...row,
            version_number: Number(row.version_number),
            snapshot: normalizeDraftSnapshot(row.snapshot, selectedSnapshot),
        })) as AutopilotConfigVersionSummary[];

        // Fetch Gemini Integration Config
        const integrationRes = await db.query(`
            SELECT config, is_active 
            FROM workspace_integrations 
            WHERE workspace_id = $1 AND provider = 'gemini'
        `, [workspaceId]);

        let geminiKeyFromIntegration = null;
        let aiModelFromIntegration = null;

        if (integrationRes.rows.length > 0 && integrationRes.rows[0].is_active) {
            const intConfig = integrationRes.rows[0].config;
            geminiKeyFromIntegration = intConfig.apiKey;
            aiModelFromIntegration = normalizeGoogleAiModelId(intConfig.aiModel);
        }

        return {
            config: selectedConfig,
            rules,
            agents,
            draft,
            versions,
            workspace,
            workspaceDefaultAiModel: aiModelFromIntegration,
            workspaceHasGeminiConfig: Boolean(geminiKeyFromIntegration || aiModelFromIntegration),
            hasGlobalKey: !!(process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY)
        };

    } catch (error) {
        console.error(`[GET_AUTOPILOT_CONFIG] Erro ao buscar configs para o usuário ${userId} no workspace ${workspaceId}:`, error);
        return {
            config: null,
            rules: null,
            agents: null,
            workspace: null,
            workspaceDefaultAiModel: null,
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

        if (formData.has('geminiApiKey')) {
            setClauses.push(`gemini_api_key = $${valueIndex++}`);
            values.push(formData.get('geminiApiKey') || null);
        }
        if (formData.has('aiModel')) {
            const requestedModel = formData.get('aiModel')?.toString() || '';
            if (!(await isAllowedAutopilotModel(requestedModel))) {
                return { success: false, error: 'Modelo de IA nao esta habilitado no catalogo global.' };
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
                return !previous || previous.name !== doc.name || previous.content !== doc.content;
            });

            await Promise.all(
                removedDocs.map((doc) =>
                    VectorStore.deleteDocumentEmbeddings(doc.id).catch((ragError) => {
                        console.error('[RAG] Failed to remove document embeddings:', ragError);
                    })
                )
            );

            for (const doc of changedDocs) {
                const content = (doc.content || '').trim();
                if (!content) {
                    await VectorStore.deleteDocumentEmbeddings(doc.id).catch((ragError) => {
                        console.error('[RAG] Failed to clear empty document embeddings:', ragError);
                    });
                    continue;
                }

                try {
                    await VectorStore.deleteDocumentEmbeddings(doc.id);
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

        const configRes = await db.query(
            'SELECT workspace_id FROM autopilot_configs WHERE id = $1 LIMIT 1',
            [configId]
        );
        if (configRes.rowCount === 0) {
            return { success: false, error: 'Agente nao encontrado.' };
        }

        const workspaceId = configRes.rows[0].workspace_id;
        if (!await isWorkspaceMember(user.id, workspaceId)) {
            return { success: false, error: 'Acesso nao autorizado.' };
        }

        await db.query('DELETE FROM autopilot_config_drafts WHERE config_id = $1', [configId]);

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
        if (snapshot.ai_model && !(await isAllowedAutopilotModel(snapshot.ai_model))) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Modelo de IA nao esta habilitado no catalogo global.' };
        }

        previousDocs = fallback.knowledge_base_documents;
        nextDocs = snapshot.knowledge_base_documents;

        const nextVersionRes = await client.query(
            'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM autopilot_config_versions WHERE config_id = $1',
            [configId]
        );
        versionNumber = Number(nextVersionRes.rows[0]?.next_version || 1);

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
                enabled_tool_names = $15,
                flow_graph = $16,
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
                JSON.stringify(snapshot.enabled_tool_names),
                snapshot.flow_graph ? JSON.stringify(snapshot.flow_graph) : null,
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

        await client.query('DELETE FROM autopilot_config_drafts WHERE config_id = $1', [configId]);
        await client.query('COMMIT');

        await reindexChangedKnowledgeDocuments({
            workspaceId: currentWorkspaceId,
            configId,
            previousDocs,
            nextDocs,
        });

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${configId}`);
        return { success: true, versionNumber };
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
        if (snapshot.ai_model && !(await isAllowedAutopilotModel(snapshot.ai_model))) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Modelo de IA desta versao nao esta habilitado no catalogo global.' };
        }

        previousDocs = fallback.knowledge_base_documents;
        nextDocs = snapshot.knowledge_base_documents;

        const nextVersionRes = await client.query(
            'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM autopilot_config_versions WHERE config_id = $1',
            [configId]
        );
        versionNumber = Number(nextVersionRes.rows[0]?.next_version || 1);

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
                enabled_tool_names = $15,
                flow_graph = $16,
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
                JSON.stringify(snapshot.enabled_tool_names),
                snapshot.flow_graph ? JSON.stringify(snapshot.flow_graph) : null,
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

        await client.query('DELETE FROM autopilot_config_drafts WHERE config_id = $1', [configId]);
        await client.query('COMMIT');

        await reindexChangedKnowledgeDocuments({
            workspaceId: currentWorkspaceId,
            configId,
            previousDocs,
            nextDocs,
        });

        revalidatePath('/autopilot');
        revalidatePath(`/autopilot/${configId}`);
        return { success: true, versionNumber };
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
        const normalizedName = name?.trim() || `Agente ${existingCount + 1}`;
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

        const actionJson = JSON.stringify(rule.action);

        let savedRuleRes;
        if (rule.id) {
            // Update existing rule
            console.log(`[SAVE_AUTOPILOT_RULE] Atualizando regra ID: ${rule.id}`);
            savedRuleRes = await db.query(
                `UPDATE autopilot_rules SET name = $1, trigger = $2, action = $3 WHERE id = $4 AND config_id = $5 RETURNING id, name, trigger, action, enabled`,
                [rule.name, rule.trigger, actionJson, rule.id, configId]
            );
        } else {
            // Create new rule - o ID será gerado pelo banco de dados (gen_random_uuid())
            console.log(`[SAVE_AUTOPILOT_RULE] Criando nova regra para config ID: ${configId}`);
            savedRuleRes = await db.query(
                `INSERT INTO autopilot_rules (config_id, name, trigger, action) VALUES ($1, $2, $3, $4) RETURNING id, name, trigger, action, enabled`,
                [configId, rule.name, rule.trigger, actionJson]
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
