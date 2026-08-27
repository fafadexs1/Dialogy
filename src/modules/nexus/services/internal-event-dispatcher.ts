import { db } from '@/lib/db';
import {
  WorkflowDefinitionSchema,
  hashValue,
  type WorkflowDefinition,
  type WorkflowExecution,
} from '@/services/workflow-runtime';

import {
  loadPublishedNexusWorkflow,
  startPublishedNexusWorkflow,
  type NexusRuntimeAdapters,
} from './runtime';

function parseJson(value: unknown) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function normalizedNexusInternalEventName(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

export function nexusInternalEventTriggerMatches(config: Record<string, unknown>, eventName: string) {
  const configured = normalizedNexusInternalEventName(config.eventName);
  return Boolean(configured) && configured === normalizedNexusInternalEventName(eventName);
}

function internalEventTrigger(definition: WorkflowDefinition) {
  return definition.nodes.find((node) => node.type === 'trigger.internal_event');
}

/**
 * Dispatches a trusted Dialogy event to every matching published Nexus flow in
 * the same workspace. Callers provide a stable eventId so retries reuse the
 * same deterministic workflow execution instead of duplicating side effects.
 */
export async function dispatchPublishedNexusInternalEvent(input: {
  workspaceId: string;
  eventName: string;
  eventId: string;
  payload?: Record<string, unknown>;
  context?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  sessionId?: string;
  conversationId?: string;
  adapters?: NexusRuntimeAdapters | (() => Promise<NexusRuntimeAdapters>);
}): Promise<{ handled: boolean; executions: WorkflowExecution[] }> {
  const eventName = normalizedNexusInternalEventName(input.eventName);
  const eventId = input.eventId.trim();
  if (!eventName) throw new Error('O nome do evento interno é obrigatório.');
  if (!eventId) throw new Error('O identificador idempotente do evento interno é obrigatório.');

  let resolvedAdapters: NexusRuntimeAdapters | undefined = typeof input.adapters === 'function'
    ? undefined
    : input.adapters;
  const adapters = async () => {
    if (!resolvedAdapters && typeof input.adapters === 'function') resolvedAdapters = await input.adapters();
    return resolvedAdapters;
  };
  const candidates = await db.query(
    `SELECT nw.id, wd.definition
     FROM public.nexus_workflows nw
     JOIN public.workflow_definitions wd
       ON wd.workflow_id = nw.published_workflow_id
      AND wd.workflow_version = nw.published_workflow_version
     WHERE nw.workspace_id = $1
       AND nw.status = 'published'
       AND wd.definition @> '{"nodes":[{"type":"trigger.internal_event"}]}'::jsonb
     ORDER BY nw.updated_at
     LIMIT 200`,
    [input.workspaceId],
  );

  const executions: WorkflowExecution[] = [];
  for (const row of candidates.rows as Array<Record<string, unknown>>) {
    const definition = WorkflowDefinitionSchema.parse(parseJson(row.definition));
    const trigger = internalEventTrigger(definition);
    if (!trigger || !nexusInternalEventTriggerMatches(trigger.config, eventName)) continue;
    const published = await loadPublishedNexusWorkflow({
      nexusWorkflowId: String(row.id),
      workspaceId: input.workspaceId,
    });
    if (!published) continue;
    const executionId = `nexus_internal_${hashValue({ workflowId: row.id, eventName, eventId })}`;
    const payload = { ...(input.payload || {}), eventName, eventId };
    const result = await startPublishedNexusWorkflow({
      published,
      triggerType: 'trigger.internal_event',
      payload,
      context: {
        source: 'internal_event',
        eventName,
        eventId,
        ...(input.context || {}),
      },
      variables: {
        event: payload,
        eventName,
        eventId,
        ...(input.variables || {}),
      },
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      executionId,
      workerId: `nexus_internal_${eventName.replace(/[^a-z0-9]+/g, '_')}`,
      adapters: await adapters(),
    });
    executions.push(result.execution);
  }

  return { handled: executions.length > 0, executions };
}
