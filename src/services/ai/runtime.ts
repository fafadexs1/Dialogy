import { db } from '@/lib/db';
import { DEFAULT_AUTOPILOT_MODEL, normalizeGoogleAiModelId } from '@/lib/ai-models';
import type { AutopilotConfig, KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import { resolveAutopilotModelFromCatalog } from '@/services/ai/model-selection';

function normalizeKnowledgeBaseDocuments(raw: unknown): KnowledgeBaseDocument[] {
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) as KnowledgeBaseDocument[];
        } catch {
            return [];
        }
    }

    return Array.isArray(raw) ? (raw as KnowledgeBaseDocument[]) : [];
}

function normalizeKnowledgeCollections(raw: unknown): KnowledgeCollection[] {
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) as KnowledgeCollection[];
        } catch {
            return [];
        }
    }

    return Array.isArray(raw) ? (raw as KnowledgeCollection[]) : [];
}

function mapAutopilotConfig(row: any): AutopilotConfig {
    return {
        ...row,
        knowledge_base_documents: normalizeKnowledgeBaseDocuments(row.knowledge_base_documents),
        knowledge_collections: normalizeKnowledgeCollections(row.knowledge_collections),
        is_active: Boolean(row.is_active),
        is_primary: Boolean(row.is_primary),
        is_private: Boolean(row.is_private),
        default_fallback_reply: row.default_fallback_reply || null,
        transcription_model: row.transcription_model || null,
    } as AutopilotConfig;
}

function normalizeWorkspaceIntegrationModel(provider: string, value: unknown): string | undefined {
    const model = typeof value === 'string' ? value.trim() : '';
    if (!model) return undefined;

    if (provider === 'gemini') {
        return normalizeGoogleAiModelId(model) || undefined;
    }

    if (provider === 'openai') {
        if (model.startsWith('openai/') || model.startsWith('codex/')) return model;
        if (model.includes('/')) return undefined;
        return `openai/${model}`;
    }

    if (provider === 'deepseek') {
        if (model.startsWith('deepseek/')) return model;
        if (model.includes('/')) return undefined;
        return `deepseek/${model}`;
    }

    return undefined;
}

export type WorkspaceAiExecutionContext = {
    autopilotConfig: AutopilotConfig | null;
    workspaceGeminiApiKey?: string;
    workspaceGeminiModel: string;
    model: string;
};

export async function resolveWorkspaceAiExecutionContext(
    workspaceId: string,
    autopilotConfigId?: string | null
): Promise<WorkspaceAiExecutionContext> {
    let autopilotConfig: AutopilotConfig | null = null;

    if (autopilotConfigId) {
        const specificRes = await db.query(
            `SELECT *
             FROM autopilot_configs
             WHERE workspace_id = $1
               AND id = $2
             LIMIT 1`,
            [workspaceId, autopilotConfigId]
        );

        if ((specificRes.rowCount ?? 0) > 0) {
            autopilotConfig = mapAutopilotConfig(specificRes.rows[0]);
        }
    }

    if (!autopilotConfig) {
        const configRes = await db.query(
            `SELECT *
             FROM autopilot_configs
             WHERE workspace_id = $1
             ORDER BY
                CASE WHEN is_active THEN 0 ELSE 1 END,
                CASE WHEN is_primary THEN 0 ELSE 1 END,
                created_at ASC
             LIMIT 1`,
            [workspaceId]
        );

        if ((configRes.rowCount ?? 0) > 0) {
            autopilotConfig = mapAutopilotConfig(configRes.rows[0]);
        }
    }

    const resolvedModel = await resolveAutopilotModelFromCatalog();
    return { autopilotConfig: autopilotConfig ? {...autopilotConfig,ai_model:resolvedModel.model,gemini_api_key:null} : null,
      workspaceGeminiApiKey: undefined,workspaceGeminiModel:resolvedModel.model,model:resolvedModel.model };
}
