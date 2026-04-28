import { db } from '@/lib/db';
import type { AutopilotConfig, KnowledgeBaseDocument } from '@/lib/types';
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

function mapAutopilotConfig(row: any): AutopilotConfig {
    return {
        ...row,
        knowledge_base_documents: normalizeKnowledgeBaseDocuments(row.knowledge_base_documents),
        is_active: Boolean(row.is_active),
        is_primary: Boolean(row.is_primary),
        is_private: Boolean(row.is_private),
        default_fallback_reply: row.default_fallback_reply || null,
        transcription_model: row.transcription_model || null,
    } as AutopilotConfig;
}

export type WorkspaceAiExecutionContext = {
    autopilotConfig: AutopilotConfig | null;
    workspaceGeminiApiKey?: string;
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

    let workspaceGeminiApiKey: string | undefined;
    let workspaceModel: string | undefined;

    try {
        const integrationRes = await db.query(
            `SELECT config
             FROM workspace_integrations
             WHERE workspace_id = $1
               AND provider = 'gemini'
               AND is_active = true
             LIMIT 1`,
            [workspaceId]
        );

        if ((integrationRes.rowCount ?? 0) > 0) {
            const config = integrationRes.rows[0].config || {};
            workspaceGeminiApiKey =
                typeof config.apiKey === 'string' && config.apiKey.trim().length > 0
                    ? config.apiKey.trim()
                    : undefined;
            workspaceModel =
                typeof config.aiModel === 'string' && config.aiModel.trim().length > 0
                    ? config.aiModel.trim()
                    : undefined;
        }
    } catch (error) {
        console.error('[AI_RUNTIME] Failed to resolve workspace Gemini integration:', error);
    }

    const configuredModel =
        autopilotConfig?.ai_model ||
        workspaceModel ||
        process.env.AI_DEFAULT_MODEL?.trim() ||
        null;
    const resolvedModel = await resolveAutopilotModelFromCatalog(configuredModel);

    if (resolvedModel.fallbackUsed) {
        console.warn(
            `[AI_RUNTIME] Model "${resolvedModel.requestedModel}" is not enabled in the global catalog. Falling back to "${resolvedModel.model}".`
        );
    }

    return {
        autopilotConfig,
        workspaceGeminiApiKey,
        model: resolvedModel.model,
    };
}
