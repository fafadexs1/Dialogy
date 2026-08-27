'use server';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { db } from '@/lib/db';
import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import type { AutopilotConfig } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';
import { resolveWorkspaceAiExecutionContext } from '@/services/ai/runtime';
import { listMcpToolsForWorkspace } from '@/services/mcp/store';
import { classifyMcpToolSafety } from '@/services/mcp/tool-safety';
import { generateProcedureAiProposal } from '@/services/procedures/ai-builder';
import {
  listProcedureStudioRecords,
  type ProcedureStudioRecord,
} from '@/services/procedures/repository';
import {
  ProcedureStudioDocumentSchema,
  ProcedureStudioGenerateInputSchema,
  ProcedureStudioPublishInputSchema,
  ProcedureStudioSaveInputSchema,
  type ProcedureToolOption,
} from '@/services/procedures/schemas';
import { materializeProcedureGraph, simulateProcedureSuite } from '@/services/procedures/studio';
import { validateProcedureStudioDocument } from '@/services/procedures/validator';
import {
  createWorkflowNode,
  modelChainForNode,
  type ModelConfiguration,
} from '@/services/workflow-runtime';
import { revalidatePath } from 'next/cache';

type ProcedureActionResult<T = undefined> = {
  success: boolean;
  error?: string;
  data?: T;
};

const ConfigIdSchema = z.string().uuid();
const ProcedureMutationSchema = z.object({
  configId: z.string().uuid(),
  procedureId: z.string().regex(/^proc_[a-zA-Z0-9_-]+$/),
  expectedRevision: z.number().int().min(1).optional(),
}).strict();
const RestoreVersionSchema = ProcedureMutationSchema.extend({
  version: z.number().int().min(1),
}).strict();

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function requireProcedureContext(configIdInput: unknown) {
  const configId = ConfigIdSchema.parse(configIdInput);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado.');
  const result = await db.query(
    `SELECT * FROM public.autopilot_configs WHERE id = $1 LIMIT 1`,
    [configId],
  );
  const config = result.rows[0];
  if (!config) throw new Error('Agente não encontrado.');
  const workspaceId = String(config.workspace_id);
  if (!await hasWorkspacePermission(user.id, workspaceId, 'automations:manage')) {
    throw new Error('Você não tem permissão para gerenciar procedimentos neste workspace.');
  }
  return { user, workspaceId, configId, config };
}

async function listProcedureTools(input: {
  workspaceId: string;
  config: Record<string, unknown>;
}): Promise<ProcedureToolOption[]> {
  const enabledNames = new Set(parseStringArray(input.config.enabled_tool_names));
  const builtIn = listAgentToolCatalogItems().map((tool) => ({
    name: tool.name,
    displayName: tool.displayName,
    description: tool.description,
    riskLevel: tool.riskLevel,
    sideEffect: tool.sideEffect,
    requiresHumanApproval: tool.requiresHumanApproval,
    enabled: tool.enabledByDefault || enabledNames.has(tool.name),
    requiredSlots: tool.requiredSlots,
    inputSchema: tool.inputSchema || null,
  } satisfies ProcedureToolOption));
  const mcpTools = await listMcpToolsForWorkspace(input.workspaceId).catch((error) => {
    console.error('[PROCEDURE_STUDIO] Falha ao listar ferramentas MCP:', error);
    return [];
  });
  const mcp = mcpTools.map((tool) => {
    const safety = classifyMcpToolSafety(tool.qualifiedName, tool);
    return {
      name: tool.qualifiedName,
      displayName: tool.title || tool.name,
      description: tool.description || `Ferramenta MCP ${tool.name}.`,
      riskLevel: safety.riskLevel,
      sideEffect: safety.sideEffect,
      requiresHumanApproval: safety.requiresHumanApproval,
      enabled: enabledNames.has(tool.qualifiedName),
      requiredSlots: [],
      inputSchema: tool.inputSchema || null,
    } satisfies ProcedureToolOption;
  });
  return [...builtIn, ...mcp];
}

function modelConfiguration(modelInput: unknown): ModelConfiguration {
  const model = typeof modelInput === 'string' && modelInput.trim()
    ? modelInput.trim()
    : process.env.DEFAULT_AUTOPILOT_MODEL || 'gemini-2.0-flash';
  return {
    provider: getAiModelRuntimeProvider(model),
    model,
    temperature: 0.15,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    timeoutMs: 90_000,
    maxRetries: 2,
  };
}

async function refreshedRecord(workspaceId: string, configId: string, procedureId: string) {
  const records = await listProcedureStudioRecords({ workspaceId, configId });
  return records.find((record) => record.id === procedureId) || null;
}

export async function listProcedureStudioAction(configIdInput: unknown): Promise<ProcedureActionResult<{
  procedures: ProcedureStudioRecord[];
}>> {
  try {
    const context = await requireProcedureContext(configIdInput);
    const procedures = await listProcedureStudioRecords(context);
    return { success: true, data: { procedures } };
  } catch (error) {
    console.error('[PROCEDURE_STUDIO] Falha ao listar procedimentos:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao carregar procedimentos.' };
  }
}

export async function saveProcedureDraftAction(inputValue: unknown): Promise<ProcedureActionResult<{
  procedure: ProcedureStudioRecord;
}>> {
  const parsed = ProcedureStudioSaveInputSchema.safeParse(inputValue);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || 'Rascunho inválido.' };
  try {
    const context = await requireProcedureContext(parsed.data.configId);
    const procedure = ProcedureStudioDocumentSchema.parse({
      ...parsed.data.procedure,
      configId: context.configId,
      metadata: { ...parsed.data.procedure.metadata, source: 'procedure_studio' },
    });
    const tools = await listProcedureTools(context);
    const validation = validateProcedureStudioDocument({ procedure, tools });
    const simulation = simulateProcedureSuite({ procedure, tools });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const existingResult = await client.query(
        `SELECT id, autopilot_config_id, source, status, draft_revision, published_version
           FROM public.agent_procedure_definitions
          WHERE workspace_id = $1 AND id = $2
          FOR UPDATE`,
        [context.workspaceId, procedure.id],
      );
      const existing = existingResult.rows[0];
      if (existing && (String(existing.autopilot_config_id || '') !== context.configId || existing.source !== 'procedure_studio')) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Este identificador de procedimento já pertence a outro recurso.' };
      }
      const currentRevision = existing ? Number(existing.draft_revision || 0) : 0;
      if (existing && parsed.data.expectedRevision != null && parsed.data.expectedRevision !== currentRevision) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Este procedimento foi alterado em outra sessão. Recarregue antes de salvar novamente.' };
      }
      if (!existing) {
        const countResult = await client.query(
          `SELECT COUNT(*)::integer AS total
             FROM public.agent_procedure_definitions
            WHERE workspace_id = $1 AND autopilot_config_id = $2 AND source = 'procedure_studio'`,
          [context.workspaceId, context.configId],
        );
        if (Number(countResult.rows[0]?.total || 0) >= 100) {
          await client.query('ROLLBACK');
          return { success: false, error: 'O agente atingiu o limite de 100 procedimentos.' };
        }
      }
      const nextRevision = currentRevision + 1;
      const fallbackGraph = materializeProcedureGraph(procedure, Number(existing?.published_version || 1));
      const agentResult = await client.query(
        `SELECT id FROM public.system_agents
          WHERE workspace_id = $1 AND autopilot_config_id = $2
          ORDER BY is_active DESC, created_at ASC LIMIT 1`,
        [context.workspaceId, context.configId],
      );
      if (existing) {
        await client.query(
          `UPDATE public.agent_procedure_definitions
              SET name = $3,
                  description = $4,
                  goal = $5,
                  priority = $6,
                  draft_json = $7::jsonb,
                  draft_revision = $8,
                  validation_json = $9::jsonb,
                  simulation_json = $10::jsonb,
                  last_tested_at = clock_timestamp(),
                  updated_by = $11,
                  updated_at = clock_timestamp()
            WHERE workspace_id = $1 AND id = $2`,
          [context.workspaceId, procedure.id, procedure.name, procedure.description, procedure.goal,
            procedure.priority, JSON.stringify(procedure), nextRevision, JSON.stringify(validation),
            JSON.stringify(simulation), context.user.id],
        );
      } else {
        await client.query(
          `INSERT INTO public.agent_procedure_definitions (
             workspace_id, id, agent_id, autopilot_config_id, name, description, goal,
             definition_json, draft_json, version, status, source, priority,
             draft_revision, published_revision, validation_json, simulation_json,
             last_tested_at, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 1,
                     'draft', 'procedure_studio', $10, 1, 0, $11::jsonb, $12::jsonb,
                     clock_timestamp(), $13, $13)`,
          [context.workspaceId, procedure.id, agentResult.rows[0]?.id || null, context.configId,
            procedure.name, procedure.description, procedure.goal, JSON.stringify(fallbackGraph),
            JSON.stringify(procedure), procedure.priority, JSON.stringify(validation),
            JSON.stringify(simulation), context.user.id],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    revalidatePath(`/autopilot/${context.configId}`);
    const saved = await refreshedRecord(context.workspaceId, context.configId, procedure.id);
    if (!saved) throw new Error('O rascunho foi salvo, mas não pôde ser recarregado.');
    return { success: true, data: { procedure: saved } };
  } catch (error) {
    console.error('[PROCEDURE_STUDIO] Falha ao salvar rascunho:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao salvar procedimento.' };
  }
}

export async function simulateProcedureAction(inputValue: unknown): Promise<ProcedureActionResult<{
  report: ReturnType<typeof simulateProcedureSuite>;
}>> {
  const parsed = z.object({ configId: z.string().uuid(), procedure: ProcedureStudioDocumentSchema }).strict().safeParse(inputValue);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || 'Procedimento inválido.' };
  try {
    const context = await requireProcedureContext(parsed.data.configId);
    const procedure = ProcedureStudioDocumentSchema.parse({ ...parsed.data.procedure, configId: context.configId });
    const tools = await listProcedureTools(context);
    return { success: true, data: { report: simulateProcedureSuite({ procedure, tools }) } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao simular procedimento.' };
  }
}

export async function publishProcedureAction(inputValue: unknown): Promise<ProcedureActionResult<{
  procedure: ProcedureStudioRecord;
}>> {
  const parsed = ProcedureStudioPublishInputSchema.safeParse(inputValue);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || 'Publicação inválida.' };
  try {
    const context = await requireProcedureContext(parsed.data.configId);
    const currentResult = await db.query(
      `SELECT draft_json, draft_revision, published_version
         FROM public.agent_procedure_definitions
        WHERE workspace_id = $1 AND id = $2 AND autopilot_config_id = $3 AND source = 'procedure_studio'
        LIMIT 1`,
      [context.workspaceId, parsed.data.procedureId, context.configId],
    );
    if (!currentResult.rows[0]) return { success: false, error: 'Procedimento não encontrado.' };
    const procedure = ProcedureStudioDocumentSchema.parse(currentResult.rows[0].draft_json);
    const tools = await listProcedureTools(context);
    const validation = validateProcedureStudioDocument({ procedure, tools });
    const simulation = simulateProcedureSuite({ procedure, tools });
    if (!validation.valid) return { success: false, error: validation.errors.map((issue) => issue.message).join(' ') };
    if (!simulation.passed) return { success: false, error: simulation.cases.filter((item) => !item.passed).map((item) => `${item.name}: ${item.error}`).join(' ') };

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const lockedResult = await client.query(
        `SELECT draft_json, draft_revision, published_version
           FROM public.agent_procedure_definitions
          WHERE workspace_id = $1 AND id = $2 AND autopilot_config_id = $3 AND source = 'procedure_studio'
          FOR UPDATE`,
        [context.workspaceId, parsed.data.procedureId, context.configId],
      );
      const locked = lockedResult.rows[0];
      if (!locked || Number(locked.draft_revision) !== parsed.data.expectedRevision) {
        await client.query('ROLLBACK');
        return { success: false, error: 'O rascunho mudou durante a publicação. Recarregue e tente novamente.' };
      }
      const nextVersion = Number(locked.published_version || 0) + 1;
      const graph = materializeProcedureGraph(procedure, nextVersion);
      await client.query(
        `UPDATE public.agent_procedure_definitions
            SET name = $4,
                description = $5,
                goal = $6,
                priority = $7,
                definition_json = $8::jsonb,
                version = $9,
                status = 'active',
                published_version = $9,
                published_revision = draft_revision,
                validation_json = $10::jsonb,
                simulation_json = $11::jsonb,
                last_tested_at = clock_timestamp(),
                published_at = clock_timestamp(),
                updated_by = $12,
                updated_at = clock_timestamp()
          WHERE workspace_id = $1 AND id = $2 AND autopilot_config_id = $3`,
        [context.workspaceId, procedure.id, context.configId, procedure.name, procedure.description,
          procedure.goal, procedure.priority, JSON.stringify(graph), nextVersion, JSON.stringify(validation),
          JSON.stringify(simulation), context.user.id],
      );
      await client.query(
        `INSERT INTO public.agent_procedure_versions (
           workspace_id, procedure_id, version, autopilot_config_id, snapshot_json,
           definition_json, validation_json, simulation_json, created_by, published_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, clock_timestamp())`,
        [context.workspaceId, procedure.id, nextVersion, context.configId, JSON.stringify(procedure),
          JSON.stringify(graph), JSON.stringify(validation), JSON.stringify(simulation), context.user.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    revalidatePath(`/autopilot/${context.configId}`);
    const published = await refreshedRecord(context.workspaceId, context.configId, procedure.id);
    if (!published) throw new Error('O procedimento foi publicado, mas não pôde ser recarregado.');
    return { success: true, data: { procedure: published } };
  } catch (error) {
    console.error('[PROCEDURE_STUDIO] Falha ao publicar:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao publicar procedimento.' };
  }
}

export async function archiveProcedureAction(inputValue: unknown): Promise<ProcedureActionResult> {
  const parsed = ProcedureMutationSchema.safeParse(inputValue);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || 'Solicitação inválida.' };
  try {
    const context = await requireProcedureContext(parsed.data.configId);
    const result = await db.query(
      `UPDATE public.agent_procedure_definitions
          SET status = 'archived', updated_by = $4, updated_at = clock_timestamp()
        WHERE workspace_id = $1 AND id = $2 AND autopilot_config_id = $3 AND source = 'procedure_studio'`,
      [context.workspaceId, parsed.data.procedureId, context.configId, context.user.id],
    );
    if ((result.rowCount || 0) === 0) return { success: false, error: 'Procedimento não encontrado.' };
    revalidatePath(`/autopilot/${context.configId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao arquivar procedimento.' };
  }
}

export async function restoreProcedureVersionAction(inputValue: unknown): Promise<ProcedureActionResult<{
  procedure: ProcedureStudioRecord;
}>> {
  const parsed = RestoreVersionSchema.safeParse(inputValue);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || 'Versão inválida.' };
  try {
    const context = await requireProcedureContext(parsed.data.configId);
    const result = await db.query(
      `UPDATE public.agent_procedure_definitions d
          SET draft_json = v.snapshot_json,
              name = v.snapshot_json->>'name',
              description = COALESCE(v.snapshot_json->>'description', ''),
              goal = v.snapshot_json->>'goal',
              priority = COALESCE((v.snapshot_json->>'priority')::integer, d.priority),
              validation_json = v.validation_json,
              simulation_json = v.simulation_json,
              last_tested_at = v.published_at,
              draft_revision = d.draft_revision + 1,
              updated_by = $5,
              updated_at = clock_timestamp()
         FROM public.agent_procedure_versions v
        WHERE d.workspace_id = $1
          AND d.id = $2
          AND d.autopilot_config_id = $3
          AND v.workspace_id = d.workspace_id
          AND v.procedure_id = d.id
          AND v.version = $4
        RETURNING d.id`,
      [context.workspaceId, parsed.data.procedureId, context.configId, parsed.data.version, context.user.id],
    );
    if (!result.rows[0]) return { success: false, error: 'Versão não encontrada.' };
    const restored = await refreshedRecord(context.workspaceId, context.configId, parsed.data.procedureId);
    if (!restored) throw new Error('A versão foi restaurada, mas não pôde ser recarregada.');
    return { success: true, data: { procedure: restored } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao restaurar versão.' };
  }
}

export async function generateProcedureWithAiAction(inputValue: unknown): Promise<ProcedureActionResult<{
  proposal: Awaited<ReturnType<typeof generateProcedureAiProposal>>;
}>> {
  const parsed = ProcedureStudioGenerateInputSchema.safeParse(inputValue);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || 'Descrição inválida.' };
  try {
    const context = await requireProcedureContext(parsed.data.configId);
    if (parsed.data.currentProcedure) {
      const ownership = await db.query(
        `SELECT 1 FROM public.agent_procedure_definitions
          WHERE workspace_id = $1 AND id = $2 AND autopilot_config_id = $3 AND source = 'procedure_studio'`,
        [context.workspaceId, parsed.data.currentProcedure.id, context.configId],
      );
      if ((ownership.rowCount || 0) === 0) return { success: false, error: 'O procedimento atual não pertence a este agente.' };
    }
    const tools = await listProcedureTools(context);
    const runtime = await resolveWorkspaceAiExecutionContext(context.workspaceId, context.configId);
    const autopilotConfig = runtime.autopilotConfig as AutopilotConfig | null;
    if (!autopilotConfig) throw new Error('Não foi possível carregar a configuração de IA do agente.');
    const model = modelConfiguration(runtime.model || context.config.ai_model);
    const modelNode = createWorkflowNode('ai.model', {
      id: 'procedure_studio_model',
      name: 'Modelo do construtor de procedimentos',
      position: { x: 0, y: 0 },
      config: model,
    });
    const modelChain = await modelChainForNode({ workspaceId: context.workspaceId, config: autopilotConfig, modelNode });
    const procedureId = parsed.data.currentProcedure?.id || `proc_${randomUUID().replace(/-/g, '')}`;
    const proposal = await generateProcedureAiProposal({
      configId: context.configId,
      procedureId,
      description: parsed.data.description,
      currentProcedure: parsed.data.currentProcedure || null,
      tools,
      modelChain,
    });
    return { success: true, data: { proposal } };
  } catch (error) {
    console.error('[PROCEDURE_STUDIO] Falha na geração com IA:', error);
    return { success: false, error: error instanceof Error ? error.message : 'A IA não conseguiu gerar um procedimento válido.' };
  }
}
