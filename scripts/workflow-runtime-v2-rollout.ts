import 'dotenv/config';

import { db } from '../src/lib/db';
import {
  getWorkflowRuntimeV2WorkspaceRolloutStatus,
  promoteWorkflowRuntimeV2Workspace,
  runAutopilotWorkflowRuntimeV2Shadow,
  validateWorkflowDefinition,
  verifyWorkflowRuntimeV2Rollback,
  type WorkflowRuntimeV2WorkspaceStage,
} from '../src/services/workflow-runtime';

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string) {
  const value = argument(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

async function verifyShadowCompile(workspaceId: string) {
  const result = await db.query(
    `SELECT ac.id, wd.definition
     FROM public.autopilot_configs ac
     LEFT JOIN public.workflow_definitions wd
       ON wd.workflow_id = ac.active_workflow_id
      AND wd.workflow_version = ac.active_workflow_version
     WHERE ac.workspace_id = $1 AND ac.workflow_builder_mode = 'native_v2'`,
    [workspaceId],
  );
  const reports = result.rows.map((row) => {
    const validation = row.definition ? validateWorkflowDefinition(row.definition) : null;
    return {
      configId: row.id,
      valid: validation?.valid === true,
      errors: validation?.errors || [{ code: 'definition_missing', message: 'Active definition missing.' }],
    };
  });
  return {
    workspaceId,
    checked: reports.length,
    valid: reports.every((report) => report.valid),
    writes: 0,
    externalSideEffects: 0,
    reports,
  };
}

async function verifyShadowExecution(workspaceId: string, configId?: string) {
  const result = await db.query(
    `SELECT ac.*, wd.definition AS workflow_definition
     FROM public.autopilot_configs ac
     LEFT JOIN public.workflow_definitions wd
       ON wd.workflow_id = ac.active_workflow_id
      AND wd.workflow_version = ac.active_workflow_version
     WHERE ac.workspace_id = $1
       AND ac.workflow_builder_mode = 'native_v2'
       AND ($2::uuid IS NULL OR ac.id = $2::uuid)
     ORDER BY ac.updated_at DESC LIMIT 1`,
    [workspaceId, configId || null],
  );
  const config = result.rows[0];
  if (!config) throw new Error('No native automation found for shadow execution.');
  // Force only the local simulation gate. The shadow handler never resolves a
  // production model/tool/sender/handoff implementation.
  config.workflow_runtime_v2_mode = 'shadow';
  const execution = await runAutopilotWorkflowRuntimeV2Shadow({
    config,
    customerMessage: argument('message') || 'Teste operacional shadow sem efeitos colaterais.',
    chatId: `rollout-shadow-${workspaceId}`,
    sourceMessageId: `rollout-shadow-${Date.now()}`,
    metadata: { operationalVerification: true },
  });
  if (execution.externalSideEffects !== 0) throw new Error('Shadow execution attempted an external side effect.');
  return execution;
}

async function main() {
  const command = process.argv[2];
  if (command === 'list') {
    const result = await db.query(
      `SELECT w.id, w.name, count(ac.id)::int AS automations,
              count(ac.id) FILTER (WHERE ac.workflow_builder_mode = 'legacy')::int AS legacy,
              count(ac.id) FILTER (WHERE ac.workflow_builder_mode = 'native_v2')::int AS native
       FROM public.workspaces w
       LEFT JOIN public.autopilot_configs ac ON ac.workspace_id = w.id
       GROUP BY w.id, w.name ORDER BY automations DESC, w.name`,
    );
    return result.rows;
  }
  const workspaceId = required('workspace');
  if (command === 'status') {
    return getWorkflowRuntimeV2WorkspaceRolloutStatus(workspaceId);
  }
  if (command === 'promote') {
    const stage = required('stage') as WorkflowRuntimeV2WorkspaceStage;
    if (!['off', 'shadow_compile', 'shadow_execution', 'canary', 'beta', 'primary'].includes(stage)) {
      throw new Error(`Invalid stage ${stage}.`);
    }
    return promoteWorkflowRuntimeV2Workspace({
      workspaceId,
      stage,
      actor: argument('actor'),
      dryRun: !process.argv.includes('--apply'),
    });
  }
  if (command === 'shadow-compile') return verifyShadowCompile(workspaceId);
  if (command === 'shadow-execute') return verifyShadowExecution(workspaceId, argument('config'));
  if (command === 'rollback-check') return verifyWorkflowRuntimeV2Rollback({ workspaceId });
  throw new Error('Command must be list, status, promote, shadow-compile, shadow-execute, or rollback-check.');
}

main()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    return db.end();
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await db.end();
    process.exitCode = 1;
  });
