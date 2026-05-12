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
import { buildAutopilotPlaygroundTrace, type AutopilotPlaygroundTrace } from '@/services/autopilot/playground-trace';
import { compileAllProcedures } from '@/services/autopilot/procedure-compiler';
import { matchProcedure } from '@/services/autopilot/procedure-matcher';
import { advanceProcedure } from '@/services/autopilot/procedure-executor';
import {
  createProcedureExecution,
  getActiveProcedureExecution,
} from '@/services/autopilot/procedure-store';
import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { retrieveHybridSupportContext } from '@/services/rag/hybrid-retrieval';

type PreviewPayload = {
  workspaceId: string;
  message: string;
  agentId?: string;
  procedureChatId?: string;
  contactId?: string;
  contactPhone?: string;
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

function onlyDigits(value?: string | null): string {
  return String(value || '').replace(/\D/g, '');
}

async function loadPreviewContact(input: {
  workspaceId: string;
  contactId?: string;
  contactPhone?: string;
  contactName?: string;
  contactEmail?: string;
}) {
  const phoneDigits = onlyDigits(input.contactPhone);
  const values: unknown[] = [input.workspaceId];
  let selector = '';

  if (input.contactId) {
    values.push(input.contactId);
    selector = `AND c.id = $${values.length}`;
  } else if (phoneDigits.length >= 6) {
    values.push(`%${phoneDigits}%`);
    selector = `AND regexp_replace(COALESCE(c.phone_number_jid, c.phone, ''), '[^0-9]', '', 'g') LIKE $${values.length}`;
  }

  if (!selector) {
    return {
      id: `preview-contact-${Date.now()}`,
      workspace_id: input.workspaceId,
      name: input.contactName || input.contactPhone || 'Cliente em teste',
      email: input.contactEmail || '',
      phone: input.contactPhone || '',
      phone_number_jid: input.contactPhone || '',
      crm: { source: 'manual', matched: false },
    };
  }

  let row: any = null;
  try {
    const res = await db.query(
      `
      SELECT
        c.*,
        u.full_name AS owner_name,
        COALESCE(
          (
            SELECT json_agg(json_build_object('id', t.id, 'label', t.label, 'value', t.value, 'color', t.color))
            FROM contact_tags ct
            JOIN tags t ON t.id = ct.tag_id
            WHERE ct.contact_id = c.id
          ),
          '[]'::json
        ) AS tags,
        COALESCE(
          (
            SELECT json_object_agg(COALESCE(NULLIF(cfd.label, ''), ccfv.field_id::text), ccfv.value)
            FROM contact_custom_field_values ccfv
            LEFT JOIN custom_field_definitions cfd ON cfd.id = ccfv.field_id AND cfd.workspace_id = c.workspace_id
            WHERE ccfv.contact_id = c.id
          ),
          '{}'::json
        ) AS custom_fields,
        COALESCE(
          (
            SELECT json_agg(json_build_object('type', a.type, 'notes', a.notes, 'date', a.date) ORDER BY a.date DESC)
            FROM (
              SELECT type, notes, date
              FROM activities
              WHERE contact_id = c.id
              ORDER BY date DESC
              LIMIT 5
            ) a
          ),
          '[]'::json
        ) AS recent_activities,
        COALESCE(
          (
            SELECT json_agg(json_build_object('title', d.title, 'value', d.value, 'stage', d.stage, 'expected_close_date', d.expected_close_date) ORDER BY d.updated_at DESC)
            FROM (
              SELECT title, value, stage, expected_close_date, updated_at
              FROM deals
              WHERE contact_id = c.id
              ORDER BY updated_at DESC
              LIMIT 5
            ) d
          ),
          '[]'::json
        ) AS deals
      FROM contacts c
      LEFT JOIN users u ON u.id = c.owner_id
      WHERE c.workspace_id = $1
        ${selector}
      ORDER BY c.created_at DESC
      LIMIT 1
      `,
      values,
    );
    row = res.rows[0];
  } catch (error) {
    console.warn('[AUTOPILOT_TEST_API] Failed to load rich CRM contact context:', error);
    const fallbackRes = await db.query(
      `
      SELECT c.*
      FROM contacts c
      WHERE c.workspace_id = $1
        ${selector}
      ORDER BY c.created_at DESC
      LIMIT 1
      `,
      values,
    );
    row = fallbackRes.rows[0];
  }

  if (!row) {
    return {
      id: `preview-contact-${Date.now()}`,
      workspace_id: input.workspaceId,
      name: input.contactName || input.contactPhone || 'Cliente em teste',
      email: input.contactEmail || '',
      phone: input.contactPhone || '',
      phone_number_jid: input.contactPhone || '',
      crm: { source: 'manual', matched: false, searchedPhone: input.contactPhone || null },
    };
  }

  return {
    ...row,
    owner: row.owner_id ? { id: row.owner_id, name: row.owner_name } : undefined,
    crm: {
      source: 'crm',
      matched: true,
      recent_activities: row.recent_activities || [],
      deals: row.deals || [],
    },
  };
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
    const {
      workspaceId,
      message,
      contactId,
      contactPhone,
      contactName,
      contactEmail,
      chatHistory,
      agentId,
      procedureChatId,
      draftSnapshot,
    } = payload;

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
    const contact = await loadPreviewContact({
      workspaceId,
      contactId,
      contactPhone,
      contactName,
      contactEmail,
    });
    const previewIntent = resolveAutopilotIntent({
      customerMessage: message,
      chatHistory: chatHistory || '',
      knowledgeDocuments: config.knowledge_base_documents || [],
    });
    const ragContext = await retrieveHybridSupportContext({
      workspaceId,
      autopilotConfigId: config.id,
      query: message,
      staticDocuments: config.knowledge_base_documents || [],
      intent: previewIntent,
    }).catch((error) => {
      console.warn('[AUTOPILOT_TEST_API] RAG diagnostics failed; using static documents:', error);
      return null;
    });
    const vectorKnowledgeDocuments = ragContext?.knowledgeBaseDocuments.filter((doc) => doc.source === 'vector' || doc.source === 'keyword') || [];
    const staticKnowledgeDocuments = config.knowledge_base_documents || [];

    const baseTrace = buildAutopilotPlaygroundTrace({
      customerMessage: message,
      chatHistory: chatHistory ?? '',
      knowledgeDocuments: config.knowledge_base_documents || [],
      vectorKnowledgeDocuments,
      staticKnowledgeDocuments,
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

    const compiledProcedures = compileAllProcedures({
      documents: config.knowledge_base_documents || [],
      tools: toolCatalog,
      enabledToolNames,
    });
    const validProcedureChatId =
      typeof procedureChatId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(procedureChatId)
        ? procedureChatId
        : null;

    if (validProcedureChatId && compiledProcedures.length > 0) {
      try {
        let activeProcedure = await getActiveProcedureExecution(validProcedureChatId);
        let activeGraph = activeProcedure
          ? compiledProcedures.find((graph) => graph.id === activeProcedure?.procedureId) || null
          : null;
        let procedureMatchReason: string | null = activeProcedure ? 'procedimento ativo no chat de teste' : null;
        let procedureMatchScore: number | null = activeProcedure ? 999 : null;

        if (!activeProcedure) {
          const procedureMatch = matchProcedure({
            intent: previewIntent.intent,
            customerMessage: message,
            compiledProcedures,
          });

          if (procedureMatch) {
            activeGraph = procedureMatch.graph;
            procedureMatchReason = procedureMatch.matchReason;
            procedureMatchScore = procedureMatch.score;
            activeProcedure = await createProcedureExecution({
              chatId: validProcedureChatId,
              workspaceId,
              systemAgentId: config.id,
              procedureId: procedureMatch.graph.id,
              procedureName: procedureMatch.graph.documentName,
              currentStepId: procedureMatch.graph.steps[0]?.id || 'step_1',
              status: 'running',
            });
          }
        }

        if (activeProcedure && activeGraph) {
          const procedureResult = await advanceProcedure({
            graph: activeGraph,
            context: activeProcedure,
            customerMessage: message,
            availableTeams,
          });

          if (procedureResult.handled && (procedureResult.response || procedureResult.actions.length > 0)) {
            result = {
              response: procedureResult.response || config.default_fallback_reply || 'Procedimento executado.',
              messageBlocks: null,
              triggeredRule: `PRE: ${activeGraph.documentName}`,
              actions: procedureResult.actions as AgentToolAction[],
            };

            const procedureTrace = buildAutopilotPlaygroundTrace({
              customerMessage: message,
              chatHistory: chatHistory ?? '',
              knowledgeDocuments: config.knowledge_base_documents || [],
              vectorKnowledgeDocuments,
              staticKnowledgeDocuments,
              fallbackReply: config.default_fallback_reply || '',
              modelResponse: result.response || null,
              modelActions: (result.actions || []) as AgentToolAction[],
              contact,
              enabledToolNames,
              toolCatalog,
              availableTeams,
            }) as AutopilotPlaygroundTrace;

            procedureTrace.procedure = {
              enabled: true,
              compiledCount: compiledProcedures.length,
              active: true,
              procedureId: activeGraph.id,
              procedureName: activeGraph.documentName,
              status: procedureResult.status,
              matchScore: procedureMatchScore,
              matchReason: procedureMatchReason,
              executedSteps: procedureResult.executedSteps,
              actions: procedureResult.actions.map((action) => action.type),
              completionReason: procedureResult.completionReason || null,
            };
            (procedureTrace as any).ragDiagnostics = ragContext?.diagnostics || null;

            return NextResponse.json({
              success: true,
              result: {
                ...result,
                response: procedureTrace.finalResponse,
              },
              trace: procedureTrace,
              runtime: {
                model: resolvedModel.model,
                requestedModel: resolvedModel.requestedModel || null,
                modelFallbackUsed: resolvedModel.fallbackUsed,
                hasWorkspaceGeminiKey: Boolean(workspaceGeminiRuntime.apiKey),
                hasAgentGeminiKey: Boolean(config.gemini_api_key?.trim()),
                procedureRuntime: true,
              },
            });
          }
        }
      } catch (procedureError) {
        console.warn('[AUTOPILOT_TEST_API] Procedure runtime preview failed; falling back to LLM:', procedureError);
      }
    }

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
        knowledgeBaseDocuments: ragContext?.knowledgeBaseDocuments || config.knowledge_base_documents || [],
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
          phone: contact.phone || '',
          phone_number_jid: contact.phone_number_jid || '',
          address: contact.address || '',
          tags: contact.tags || [],
          custom_fields: contact.custom_fields || {},
          lead_score: contact.lead_score ?? null,
          owner: contact.owner || null,
          crm: contact.crm || null,
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
      vectorKnowledgeDocuments,
      staticKnowledgeDocuments,
      fallbackReply: config.default_fallback_reply || '',
      modelResponse: result.response || null,
      modelActions: (result.actions || []) as AgentToolAction[],
      contact,
      enabledToolNames,
      toolCatalog,
      availableTeams,
    });
    trace.procedure = {
      enabled: compiledProcedures.length > 0,
      compiledCount: compiledProcedures.length,
      active: false,
      procedureId: null,
      procedureName: null,
      status: null,
      matchScore: null,
      matchReason: compiledProcedures.length > 0 ? 'Nenhum procedimento PRE assumiu esta mensagem.' : null,
      executedSteps: [],
      actions: [],
      completionReason: null,
    };
    (trace as any).ragDiagnostics = ragContext?.diagnostics || null;

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
