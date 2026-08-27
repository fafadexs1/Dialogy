'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import {
  archiveAgentDomainPack,
  compileAutopilotConfigToDomainPack,
  getAgentDomainPack,
  listAgentDomainPacks,
  publishAgentDomainPack,
  saveAgentDomainPack,
  type SaveAgentDomainPackInput,
} from '@/services/agent-runtime/domain-packs';
import {
  getAgentTaskExecution,
  listAgentTaskCheckpoints,
  listAgentTaskExecutions,
  listAgentTaskInterruptions,
  pushAgentTaskInterruption,
  resolveAgentTaskInterruption,
} from '@/services/agent-runtime/task-store';
import type { AgentTaskExecution } from '@/services/agent-runtime/types';
import {
  listAgentEvaluationRuns,
  recordAgentEvaluationRun,
} from '@/services/agent-runtime/evaluation-store';
import type { AgentEvaluationResult, JsonObject } from '@/services/agent-runtime/types';

async function authorizedWorkspace(workspaceId: string): Promise<{ userId: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !workspaceId) return null;
  if (!await hasWorkspacePermission(user.id, workspaceId, 'automations:manage')) return null;
  return { userId: user.id };
}

export async function listAgentDomainPacksAction(workspaceId: string) {
  if (!await authorizedWorkspace(workspaceId)) {
    return { packs: [], error: 'Acesso nao autorizado.' };
  }
  return { packs: await listAgentDomainPacks({ workspaceId }) };
}

export async function getAgentDomainPackAction(input: {
  workspaceId: string;
  packId?: string | null;
  slug?: string | null;
  version?: number | null;
  publishedOnly?: boolean;
}) {
  if (!await authorizedWorkspace(input.workspaceId)) {
    return { pack: null, error: 'Acesso nao autorizado.' };
  }
  return {
    pack: await getAgentDomainPack({
      workspaceId: input.workspaceId,
      id: input.packId,
      slug: input.slug,
      version: input.version,
      publishedOnly: input.publishedOnly,
    }),
  };
}

function slugifyDomainPack(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'agent-domain-pack';
}

/** Compiles the existing visual/legacy autopilot configuration into a draft. */
export async function compileAutopilotConfigDomainPackAction(input: {
  workspaceId: string;
  autopilotConfigId: string;
  slug?: string | null;
  businessName?: string | null;
  niche?: string | null;
  description?: string | null;
  language?: string | null;
  tone?: string | null;
  responseConstraints?: string[];
  version?: number;
}) {
  const auth = await authorizedWorkspace(input.workspaceId);
  if (!auth) return { success: false, pack: null, error: 'Acesso nao autorizado.' };
  try {
    const result = await db.query<{
      id: string;
      name: string;
      knowledge_base: string | null;
      knowledge_base_documents: unknown;
      enabled_tool_names: string[] | null;
      flow_graph: unknown;
      workflow_definition: unknown;
      escalation_policy: string | null;
      closing_policy: string | null;
    }>(
      `SELECT id, name, knowledge_base, knowledge_base_documents, enabled_tool_names, flow_graph, workflow_definition, escalation_policy, closing_policy
         FROM public.autopilot_configs
        WHERE id = $1 AND workspace_id = $2
        LIMIT 1`,
      [input.autopilotConfigId, input.workspaceId],
    );
    const config = result.rows[0];
    if (!config) return { success: false, pack: null, error: 'Configuracao de autopilot nao encontrada.' };
    const rulesResult = await db.query<{
      id: string;
      name: string;
      trigger: string;
      action: unknown;
    }>(
      `SELECT id, name, trigger, action
         FROM public.autopilot_rules
        WHERE config_id = $1
          AND enabled = true
        ORDER BY name`,
      [config.id],
    );
    const definition = compileAutopilotConfigToDomainPack({
      id: config.id,
      name: config.name,
      businessName: input.businessName,
      niche: input.niche,
      description: input.description,
      knowledgeBase: config.knowledge_base,
      knowledgeBaseDocuments: Array.isArray(config.knowledge_base_documents) ? config.knowledge_base_documents : [],
      enabledToolNames: config.enabled_tool_names || [],
      flowGraph: config.workflow_definition || config.flow_graph,
      rules: [
        ...rulesResult.rows.map((rule) => ({
          id: rule.id,
          rule: `${rule.name}: quando "${rule.trigger}", aplicar a acao configurada ${JSON.stringify(rule.action)}.`,
          severity: 'warning',
        })),
        ...(config.escalation_policy ? [{
          id: 'escalation_policy',
          rule: config.escalation_policy,
          severity: 'critical',
        }] : []),
        ...(config.closing_policy ? [{
          id: 'closing_policy',
          rule: config.closing_policy,
          severity: 'critical',
        }] : []),
      ],
      responseStyle: {
        language: input.language || 'pt-BR',
        tone: input.tone || 'humano, claro e objetivo',
        constraints: input.responseConstraints || [],
      },
    });
    const pack = await saveAgentDomainPack({
      workspaceId: input.workspaceId,
      slug: input.slug || slugifyDomainPack(config.name),
      name: config.name,
      version: input.version,
      definition,
      createdByUserId: auth.userId,
      status: 'draft',
    });
    return pack
      ? { success: true, pack }
      : { success: false, pack: null, error: 'Nao foi possivel compilar o pacote de dominio.' };
  } catch (error) {
    return {
      success: false,
      pack: null,
      error: error instanceof Error ? error.message : 'Falha ao compilar o pacote de dominio.',
    };
  }
}

export async function saveAgentDomainPackAction(input: Omit<SaveAgentDomainPackInput, 'createdByUserId'>) {
  const auth = await authorizedWorkspace(input.workspaceId);
  if (!auth) return { success: false, pack: null, error: 'Acesso nao autorizado.' };
  try {
    const pack = await saveAgentDomainPack({ ...input, createdByUserId: auth.userId });
    return pack
      ? { success: true, pack }
      : { success: false, pack: null, error: 'Nao foi possivel salvar o pacote de dominio.' };
  } catch (error) {
    return {
      success: false,
      pack: null,
      error: error instanceof Error ? error.message : 'Dados invalidos para o pacote de dominio.',
    };
  }
}

export async function publishAgentDomainPackAction(input: { workspaceId: string; packId: string }) {
  if (!await authorizedWorkspace(input.workspaceId)) {
    return { success: false, pack: null, error: 'Acesso nao autorizado.' };
  }
  const pack = await publishAgentDomainPack(input);
  return pack
    ? { success: true, pack }
    : { success: false, pack: null, error: 'Pacote de dominio nao encontrado.' };
}

export async function archiveAgentDomainPackAction(input: { workspaceId: string; packId: string }) {
  if (!await authorizedWorkspace(input.workspaceId)) {
    return { success: false, error: 'Acesso nao autorizado.' };
  }
  return { success: await archiveAgentDomainPack(input) };
}

export async function linkAgentDomainPackToAutopilotAction(input: {
  workspaceId: string;
  autopilotConfigId: string;
  domainPackId: string;
}) {
  if (!await authorizedWorkspace(input.workspaceId)) {
    return { success: false, error: 'Acesso nao autorizado.' };
  }
  const pack = await getAgentDomainPack({
    workspaceId: input.workspaceId,
    id: input.domainPackId,
    publishedOnly: true,
  });
  if (!pack) return { success: false, error: 'Somente um pacote publicado pode ser associado.' };
  try {
    const result = await db.query(
      `UPDATE public.autopilot_configs
          SET agent_domain_pack_id = $3,
              updated_at = timezone('utc', now())
        WHERE id = $1 AND workspace_id = $2
        RETURNING id`,
      [input.autopilotConfigId, input.workspaceId, pack.id],
    );
    return result.rows[0]
      ? { success: true, domainPackId: pack.id }
      : { success: false, error: 'Configuracao de autopilot nao encontrada.' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Falha ao associar o pacote de dominio.',
    };
  }
}

function taskSummary(task: AgentTaskExecution | null) {
  if (!task) return null;
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    chatId: task.chatId,
    domainPackId: task.domainPackId,
    goal: task.goal,
    goalKey: task.goalKey,
    procedureId: task.procedureId,
    procedureVersion: task.procedureVersion,
    currentStepId: task.currentStepId,
    status: task.status,
    version: task.version,
    activeInterruptionId: task.activeInterruptionId,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

export async function listAgentTaskExecutionsAction(input: {
  workspaceId: string;
  chatId?: string | null;
  status?: AgentTaskExecution['status'] | null;
  limit?: number;
}) {
  if (!await authorizedWorkspace(input.workspaceId)) {
    return { tasks: [], error: 'Acesso nao autorizado.' };
  }
  const tasks = await listAgentTaskExecutions(input);
  return { tasks: tasks.map(taskSummary) };
}

export async function getAgentTaskInspectionAction(input: {
  workspaceId: string;
  taskId: string;
}) {
  if (!await authorizedWorkspace(input.workspaceId)) {
    return { task: null, checkpoints: [], interruptions: [], error: 'Acesso nao autorizado.' };
  }
  const task = await getAgentTaskExecution(input);
  if (!task) return { task: null, checkpoints: [], interruptions: [] };
  const [checkpoints, interruptions] = await Promise.all([
    listAgentTaskCheckpoints({
      taskExecutionId: task.id,
      workspaceId: input.workspaceId,
      limit: 100,
    }),
    listAgentTaskInterruptions({
      taskExecutionId: task.id,
      workspaceId: input.workspaceId,
    }),
  ]);
  return {
    task: taskSummary(task),
    checkpoints,
    interruptions,
  };
}

export async function pushAgentTaskInterruptionAction(input: {
  workspaceId: string;
  taskExecutionId: string;
  kind: string;
  prompt: string;
  context?: JsonObject;
  parentInterruptionId?: string | null;
}) {
  if (!await authorizedWorkspace(input.workspaceId)) {
    return { success: false, interruption: null, error: 'Acesso nao autorizado.' };
  }
  const interruption = await pushAgentTaskInterruption(input);
  return interruption
    ? { success: true, interruption }
    : { success: false, interruption: null, error: 'Nao foi possivel abrir a interrupcao.' };
}

export async function resolveAgentTaskInterruptionAction(input: {
  workspaceId: string;
  taskExecutionId: string;
  interruptionId: string;
  status?: 'resolved' | 'cancelled';
}) {
  if (!await authorizedWorkspace(input.workspaceId)) {
    return { success: false, error: 'Acesso nao autorizado.' };
  }
  return {
    success: await resolveAgentTaskInterruption(input),
  };
}

export async function listAgentEvaluationRunsAction(input: {
  workspaceId: string;
  scenarioId?: string | null;
  limit?: number;
}) {
  if (!await authorizedWorkspace(input.workspaceId)) {
    return { runs: [], error: 'Acesso nao autorizado.' };
  }
  return { runs: await listAgentEvaluationRuns(input) };
}

export async function recordAgentEvaluationRunAction(input: {
  workspaceId: string;
  domainPackId?: string | null;
  scenarioId: string;
  scenarioInput?: JsonObject;
  observation?: JsonObject;
  result: AgentEvaluationResult;
  metrics?: JsonObject;
}) {
  if (!await authorizedWorkspace(input.workspaceId)) {
    return { success: false, run: null, error: 'Acesso nao autorizado.' };
  }
  const run = await recordAgentEvaluationRun(input);
  return run
    ? { success: true, run }
    : { success: false, run: null, error: 'Nao foi possivel registrar a avaliacao.' };
}
