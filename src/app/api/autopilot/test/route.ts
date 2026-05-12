'use server';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { generateAgentResponse } from '@/ai/flows/auto-responder';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';
import { resolveAutopilotModelFromCatalog } from '@/services/ai/model-selection';
import type { AutopilotConfig, AutopilotConfigDraftSnapshot, KnowledgeBaseDocument, NexusFlowInstance } from '@/lib/types';
import { listAgentToolCatalogItems, type AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type { AgentToolAction } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import { listMcpToolsForWorkspace } from '@/services/mcp/store';
import { buildAutopilotPlaygroundTrace } from '@/services/autopilot/playground-trace';

type PreviewPayload = {
  workspaceId: string;
  message: string;
  agentId?: string;
  contactName?: string;
  contactEmail?: string;
  chatHistory?: string;
  draftSnapshot?: AutopilotConfigDraftSnapshot | null;
};

type WorkspaceGeminiRuntime = {
  apiKey?: string;
  model?: string;
};

async function ensureMembership(userId: string, workspaceId: string): Promise<boolean> {
  const res = await db.query(
    'SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2 LIMIT 1',
    [userId, workspaceId],
  );
  return (res.rowCount ?? 0) > 0;
}

async function loadPreviewTeams(workspaceId: string): Promise<ToolRouterTeam[]> {
  try {
    const res = await db.query(
      'SELECT id, name, routing_config FROM teams WHERE workspace_id = $1 ORDER BY name LIMIT 20',
      [workspaceId],
    );

    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      routingConfig: row.routing_config || { enabled: true, autoTransfer: true },
    }));
  } catch {
    return [];
  }
}

async function loadPreviewToolCatalog(workspaceId: string, enabledToolNames: string[]): Promise<AgentToolCatalogItem[]> {
  const enabledToolSet = new Set(enabledToolNames);
  const mcpTools = await listMcpToolsForWorkspace(workspaceId).catch(() => []);
  const mcpCatalogItems: AgentToolCatalogItem[] = mcpTools
    .filter((tool) => enabledToolSet.has(tool.qualifiedName))
    .map((tool) => ({
      name: tool.qualifiedName as any,
      version: 'mcp',
      description: tool.description || tool.title || `Ferramenta MCP ${tool.name} em ${tool.serverName}.`,
      class: tool.annotations?.readOnlyHint ? 'read_only' : 'retrieval',
      riskLevel: tool.annotations?.destructiveHint ? 'high' : 'medium',
      sideEffect: tool.annotations?.destructiveHint ? 'high' : tool.annotations?.readOnlyHint ? 'none' : 'medium',
      idempotent: Boolean(tool.annotations?.idempotentHint || tool.annotations?.readOnlyHint),
      timeoutMs: Number.parseInt(process.env.AI_ORCHESTRATOR_TOOL_TIMEOUT_MS || '', 10) || 8000,
      maxAttempts: 1,
      requiresHumanApproval: Boolean(tool.annotations?.destructiveHint),
      customerVisible: true,
      allowedIntents: [],
      requiredSlots: [],
      fallbackAction: 'handoff',
      source: 'mcp',
      enabledByDefault: false,
      serverId: tool.serverId,
      serverName: tool.serverName,
      inputSchema: tool.inputSchema || null,
      outputSchema: null,
    }));

  return [...listAgentToolCatalogItems(), ...mcpCatalogItems];
}

function normalizeWorkspaceGeminiModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const model = value.trim();
  if (!model) return undefined;
  if (model.startsWith('googleai/')) return model;
  if (model.startsWith('gemini-')) return `googleai/${model}`;
  return model;
}

async function loadWorkspaceGeminiRuntime(workspaceId: string): Promise<WorkspaceGeminiRuntime> {
  try {
    const res = await db.query(
      `SELECT config
       FROM workspace_integrations
       WHERE workspace_id = $1
         AND provider = 'gemini'
         AND is_active = true
       ORDER BY updated_at DESC
       LIMIT 1`,
      [workspaceId],
    );

    const config = res.rows[0]?.config || {};
    return {
      apiKey: typeof config.apiKey === 'string' && config.apiKey.trim().length > 0
        ? config.apiKey.trim()
        : undefined,
      model: normalizeWorkspaceGeminiModel(config.aiModel),
    };
  } catch (error) {
    console.error('[AUTOPILOT_TEST_API] Failed to load workspace Gemini integration:', error);
    return {};
  }
}

function getDefaultGeminiEnvKey(): string {
  return process.env.GOOGLE_GENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || '';
}

function hasRuntimeGeminiKey(config: AutopilotConfig, workspaceRuntime: WorkspaceGeminiRuntime): boolean {
  return Boolean(
    config.gemini_api_key?.trim() ||
    workspaceRuntime.apiKey ||
    (getDefaultGeminiEnvKey() && getDefaultGeminiEnvKey() !== 'no-key-configured')
  );
}

function buildIntentContext(trace: ReturnType<typeof buildAutopilotPlaygroundTrace>) {
  return [
    `intent=${trace.intent.intent}`,
    `confidence=${trace.intent.confidence.toFixed(2)}`,
    `workflowId=${trace.intent.workflowId}`,
    `workflowExecutionMode=${trace.workflow.executionMode}`,
    `workflowMissingSlots=${trace.workflow.missingSlots.join(',') || 'none'}`,
    `workflowPlannedTools=${trace.workflow.actions.join(',') || 'none'}`,
    `shouldRetrieveKnowledge=${trace.intent.shouldRetrieveKnowledge}`,
    `shouldUseTool=${trace.intent.shouldUseTool}`,
    `shouldTransfer=${trace.intent.shouldTransfer}`,
    `requiredSlots=${trace.intent.requiredSlots.join(',') || 'none'}`,
    `extractedSlots=${JSON.stringify(trace.intent.extractedSlots)}`,
    `ragStrategy=${trace.rag.strategy}`,
    `knowledgeCoverage=${trace.rag.knowledgeCoverage}`,
    `reason=${trace.intent.reason}`,
  ].join('\n');
}

function parseKnowledgeDocuments(raw: unknown): KnowledgeBaseDocument[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeToolNames(raw: unknown): string[] {
  if (!raw) return [];
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

function applyDraftSnapshot(config: AutopilotConfig, snapshot?: AutopilotConfigDraftSnapshot | null): AutopilotConfig {
  if (!snapshot) return config;

  return {
    ...config,
    name: typeof snapshot.name === 'string' && snapshot.name.trim().length > 0 ? snapshot.name : config.name,
    gemini_api_key: typeof snapshot.gemini_api_key === 'string' && snapshot.gemini_api_key.length > 0 ? snapshot.gemini_api_key : null,
    ai_model: typeof snapshot.ai_model === 'string' && snapshot.ai_model.length > 0 ? snapshot.ai_model : config.ai_model,
    transcription_model: typeof snapshot.transcription_model === 'string' && snapshot.transcription_model.length > 0 ? snapshot.transcription_model : config.transcription_model,
    knowledge_base: typeof snapshot.knowledge_base === 'string' && snapshot.knowledge_base.length > 0 ? snapshot.knowledge_base : null,
    knowledge_base_documents: Array.isArray(snapshot.knowledge_base_documents)
      ? snapshot.knowledge_base_documents
      : config.knowledge_base_documents,
    is_active: Boolean(snapshot.is_active),
    is_private: Boolean(snapshot.is_private),
    default_fallback_reply: typeof snapshot.default_fallback_reply === 'string' && snapshot.default_fallback_reply.length > 0 ? snapshot.default_fallback_reply : null,
    escalation_policy: typeof snapshot.escalation_policy === 'string' && snapshot.escalation_policy.length > 0 ? snapshot.escalation_policy : null,
    closing_policy: typeof snapshot.closing_policy === 'string' && snapshot.closing_policy.length > 0 ? snapshot.closing_policy : null,
    enabled_tool_names: normalizeToolNames(snapshot.enabled_tool_names),
  };
}

export async function POST(request: Request) {
  try {
    const payload: PreviewPayload = await request.json();
    const { workspaceId, message, contactName, contactEmail, chatHistory, agentId, draftSnapshot } = payload;

    if (!workspaceId || !message) {
      return NextResponse.json(
        { error: 'workspaceId e message são obrigatórios.' },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
    }

    if (!(await ensureMembership(user.id, workspaceId))) {
      return NextResponse.json({ error: 'Acesso não autorizado.' }, { status: 403 });
    }

    const configRes = await db.query(
      'SELECT * FROM autopilot_configs WHERE workspace_id = $1 ORDER BY created_at',
      [workspaceId],
    );

    if (configRes.rowCount === 0) {
      return NextResponse.json(
        { error: 'Nenhuma configuração do Autopilot encontrada.' },
        { status: 404 },
      );
    }

    const agents = configRes.rows.map((row: any) => {
      return {
        ...row,
        knowledge_base_documents: parseKnowledgeDocuments(row.knowledge_base_documents),
        enabled_tool_names: normalizeToolNames(row.enabled_tool_names),
        is_active: Boolean(row.is_active),
        is_primary: Boolean(row.is_primary),
        is_private: Boolean(row.is_private),
        default_fallback_reply: row.default_fallback_reply || null,
      } as AutopilotConfig;
    }).filter((agent) => !agent.is_private || agent.user_id === user.id);

    const publishedConfig =
      agents.find((a) => a.id === agentId) ||
      agents.find((a) => a.is_primary) ||
      agents[0];

    if (!publishedConfig) {
      return NextResponse.json(
        { error: 'Nenhuma configuracao do Autopilot encontrada.' },
        { status: 404 },
      );
    }

    const config = applyDraftSnapshot(publishedConfig, draftSnapshot);
    const workspaceGeminiRuntime = await loadWorkspaceGeminiRuntime(workspaceId);
    const resolvedModel = await resolveAutopilotModelFromCatalog(
      config.ai_model || workspaceGeminiRuntime.model || DEFAULT_AUTOPILOT_MODEL,
    );

    const rulesRes = await db.query(
      'SELECT * FROM autopilot_rules WHERE config_id = $1 ORDER BY name',
      [config.id],
    );

    const rules: NexusFlowInstance[] = rulesRes.rows.map((rule) => ({
      ...rule,
      action: typeof rule.action === 'string' ? JSON.parse(rule.action) : rule.action,
    }));
    const enabledToolNames = Array.isArray(config.enabled_tool_names)
      ? config.enabled_tool_names
      : listAgentToolCatalogItems().filter((tool) => tool.enabledByDefault).map((tool) => tool.name);
    const toolCatalog = await loadPreviewToolCatalog(workspaceId, enabledToolNames);
    const availableTeams = await loadPreviewTeams(workspaceId);
    const contact = {
      id: `preview-contact-${Date.now()}`,
      workspace_id: workspaceId,
      name: contactName || 'Cliente em teste',
      email: contactEmail || '',
    };
    const baseTrace = buildAutopilotPlaygroundTrace({
      customerMessage: message,
      chatHistory: chatHistory ?? '',
      knowledgeDocuments: config.knowledge_base_documents || [],
      fallbackReply: config.default_fallback_reply || '',
      contact,
      enabledToolNames,
      toolCatalog,
      availableTeams,
    });

    let result: {
      response?: string | null;
      messageBlocks?: string[] | null;
      triggeredRule?: string | null;
      actions?: AgentToolAction[] | null;
    } = {
      response: baseTrace.finalResponse,
      messageBlocks: null,
      triggeredRule: null,
      actions: [] as AgentToolAction[],
    };

    if (baseTrace.workflow.executionMode === 'continue_llm') {
      if (!hasRuntimeGeminiKey(config, workspaceGeminiRuntime)) {
        return NextResponse.json(
          {
            error: 'IA nao configurada para este teste. Configure uma chave em Integracoes > Gemini ou na chave personalizada do agente.',
            trace: baseTrace,
          },
          { status: 409 },
        );
      }

      const generated = await generateAgentResponse({
        chatId: `preview-${Date.now()}`,
        customerMessage: message,
        chatHistory: chatHistory ?? '',
        rules: rules.filter((rule) => rule.enabled),
        knowledgeBase: config.knowledge_base || '',
        knowledgeBaseDocuments: config.knowledge_base_documents || [],
        fallbackReply: config.default_fallback_reply || '',
        escalationPolicy: config.escalation_policy || '',
        closingPolicy: config.closing_policy || '',
        enabledAgentToolsDescription: enabledToolNames.join(', '),
        intentContext: buildIntentContext(baseTrace),
        model: resolvedModel.model,
        workspaceGeminiApiKey: workspaceGeminiRuntime.apiKey,
        contact: {
          id: contact.id,
          name: contact.name,
          email: contact.email,
        },
        config,
      });
      const generatedResponse =
        generated.response?.trim() ||
        (generated.messageBlocks || []).filter((block) => block.trim().length > 0).join('\n\n');

      if (!generatedResponse) {
        return NextResponse.json(
          {
            error: 'A IA foi chamada, mas nao gerou uma resposta aproveitavel. Verifique a chave Gemini, o modelo selecionado e os logs do servidor.',
            trace: baseTrace,
          },
          { status: 502 },
        );
      }

      result = {
        ...generated,
        response: generatedResponse,
        actions: (generated.actions || []) as AgentToolAction[],
      };
    }

    const trace = buildAutopilotPlaygroundTrace({
      customerMessage: message,
      chatHistory: chatHistory ?? '',
      knowledgeDocuments: config.knowledge_base_documents || [],
      fallbackReply: config.default_fallback_reply || '',
      modelResponse: result.response || null,
      modelActions: (result.actions || []) as AgentToolAction[],
      contact,
      enabledToolNames,
      toolCatalog,
      availableTeams,
    });

    return NextResponse.json({
      success: true,
      result: {
        ...result,
        response: trace.finalResponse,
      },
      trace,
      runtime: {
        model: resolvedModel.model,
        requestedModel: resolvedModel.requestedModel || null,
        modelFallbackUsed: resolvedModel.fallbackUsed,
        hasWorkspaceGeminiKey: Boolean(workspaceGeminiRuntime.apiKey),
        hasAgentGeminiKey: Boolean(config.gemini_api_key?.trim()),
      },
    });
  } catch (error) {
    console.error('[AUTOPILOT_TEST_API] Error running preview:', error);
    return NextResponse.json(
      { error: 'Falha ao executar o teste do agente.' },
      { status: 500 },
    );
  }
}
