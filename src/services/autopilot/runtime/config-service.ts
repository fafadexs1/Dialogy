import { db } from '@/lib/db';
import type { AutopilotConfig, KnowledgeBaseDocument, NexusFlowInstance, Workspace } from '@/lib/types';
import { selectAutopilotConfigForRuntime } from '@/services/autopilot/config-selection';
import { sanitizeAutopilotRules } from '@/services/autopilot/automation-rules';

export async function getAutopilotConfigService(workspaceId: string, agentId?: string): Promise<{
  config: AutopilotConfig | null,
  rules: NexusFlowInstance[] | null,
  agents: AutopilotConfig[] | null,
  workspace: Workspace | null,
  error?: string,
  hasGlobalKey?: boolean
}> {
  try {
    const configRes = await db.query('SELECT * FROM autopilot_configs WHERE workspace_id = $1 ORDER BY created_at', [workspaceId]);
    const workspaceRes = await db.query('SELECT * FROM workspaces WHERE id = $1', [workspaceId]);
    const workspace = workspaceRes.rows[0] as Workspace || null;

    if (configRes.rowCount === 0) {
      return { config: null, rules: [], agents: [], workspace, hasGlobalKey: !!process.env.GOOGLE_GENAI_API_KEY };
    }

    const agents = configRes.rows.map((row: any) => {
      const documentsRaw = row.knowledge_base_documents;
      const normalizedDocs: KnowledgeBaseDocument[] =
        typeof documentsRaw === 'string'
          ? (() => {
            try {
              return JSON.parse(documentsRaw);
            } catch {
              return [];
            }
          })()
          : Array.isArray(documentsRaw)
            ? documentsRaw
            : [];
      return {
        ...row,
        knowledge_base_documents: normalizedDocs,
        knowledge_collections: Array.isArray(row.knowledge_collections)
          ? row.knowledge_collections
          : typeof row.knowledge_collections === 'string'
            ? JSON.parse(row.knowledge_collections || '[]')
            : [],
        is_active: Boolean(row.is_active),
        is_primary: Boolean(row.is_primary),
        is_private: Boolean(row.is_private),
        default_fallback_reply: row.default_fallback_reply || null,
      } as AutopilotConfig;
    });

    const selectedConfig = selectAutopilotConfigForRuntime(agents, agentId);

    if (!selectedConfig) {
      return { config: null, rules: [], agents, workspace, hasGlobalKey: !!process.env.GOOGLE_GENAI_API_KEY };
    }

    const rulesRes = await db.query('SELECT * FROM autopilot_rules WHERE config_id = $1 ORDER BY name', [selectedConfig.id]);
    const parsedRules = rulesRes.rows.map((row) => {
      let action = row.action;
      if (typeof action === 'string') {
        try {
          action = JSON.parse(action);
        } catch {
          action = null;
        }
      }
      return { ...row, action };
    });
    const sanitizedRules = sanitizeAutopilotRules(parsedRules);
    if (sanitizedRules.invalid.length > 0) {
      console.warn('[AUTOPILOT_RULES] Ignoring invalid automation rules for runtime:', sanitizedRules.invalid);
    }

    return { config: selectedConfig, rules: sanitizedRules.rules, agents, workspace, hasGlobalKey: !!process.env.GOOGLE_GENAI_API_KEY };
  } catch (error) {
    console.error(`[GET_AUTOPILOT_CONFIG_SERVICE] Erro no workspace ${workspaceId}:`, error);
    return { config: null, rules: null, agents: null, workspace: null, error: 'Falha ao buscar configuracoes do banco de dados.', hasGlobalKey: false };
  }
}
