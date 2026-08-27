'use server';

import { createClient } from '@/lib/supabase/server';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { hashValue } from '@/services/workflow-runtime';

import { getNexusDeploymentInfo, rotateNexusWebhookToken } from '../services/deployment';
import {
  loadPublishedNexusWorkflow,
  resumePublishedNexusWorkflow,
  startPublishedNexusWorkflow,
  terminalNexusOutput,
} from '../services/runtime';

async function requireManager(workspaceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado.');
  if (!await hasWorkspacePermission(user.id, workspaceId, 'automations:manage')) throw new Error('Acesso não autorizado.');
  return user;
}

export async function getNexusDeploymentAction(input: { workspaceId: string; workflowId: string }) {
  try {
    await requireManager(input.workspaceId);
    return { success: true, deployment: await getNexusDeploymentInfo(input.workspaceId, input.workflowId) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao carregar a implantação.' };
  }
}

export async function rotateNexusWebhookTokenAction(input: { workspaceId: string; workflowId: string }) {
  try {
    await requireManager(input.workspaceId);
    const token = await rotateNexusWebhookToken(input.workspaceId, input.workflowId);
    return { success: true, token };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao gerar o token do webhook.' };
  }
}

export async function runPublishedNexusWorkflowAction(input: {
  workspaceId: string;
  workflowId: string;
  payload?: Record<string, unknown>;
}) {
  try {
    const user = await requireManager(input.workspaceId);
    const published = await loadPublishedNexusWorkflow({ nexusWorkflowId: input.workflowId, workspaceId: input.workspaceId });
    if (!published) return { success: false, error: 'Publique o fluxo antes de executá-lo.' };
    const result = await startPublishedNexusWorkflow({
      published,
      triggerType: 'trigger.manual',
      payload: input.payload || {},
      context: { source: 'manual', userId: user.id },
      executionId: `nexus_manual_${hashValue({ workflowId: input.workflowId, userId: user.id, at: Date.now() })}`,
      workerId: `nexus_manual_${user.id}`,
    });
    return {
      success: true,
      executionId: result.execution.executionId,
      status: result.execution.status,
      output: terminalNexusOutput(result.execution),
      deliveries: result.deliveries,
      error: result.execution.failure?.message,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao executar o fluxo.' };
  }
}

export async function resumeNexusWorkflowAction(input: {
  workspaceId: string;
  resumeToken: string;
  value?: unknown;
}) {
  try {
    const user = await requireManager(input.workspaceId);
    const result = await resumePublishedNexusWorkflow({
      workspaceId: input.workspaceId,
      resume: {
        resumeToken: input.resumeToken,
        input: { value: input.value },
        contextPatch: { resumedBy: user.id, resumedAt: new Date().toISOString() },
        workerId: `nexus_resume_${user.id}`,
      },
    });
    return {
      success: true,
      executionId: result.execution.executionId,
      status: result.execution.status,
      output: terminalNexusOutput(result.execution),
      deliveries: result.deliveries,
      error: result.execution.failure?.message,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao retomar o fluxo.' };
  }
}
