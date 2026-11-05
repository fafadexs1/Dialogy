import 'server-only';

import {
  enqueueNexusInternalEvent,
  shouldEnqueueJob,
} from '@/lib/queue';
import type { NexusInternalEventPayload } from '@/lib/queue/types';

import {
  dispatchPublishedNexusInternalEvent,
  normalizedNexusInternalEventName,
} from './internal-event-dispatcher';

export const MAX_NEXUS_INTERNAL_EVENT_DEPTH = 12;

export type DialogyNexusInternalEventInput = NexusInternalEventPayload;

export type PreparedDialogyNexusInternalEvent = {
  event: NexusInternalEventPayload | null;
  suppressed?: 'cycle' | 'depth_limit';
};

function normalizedEventChain(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizedNexusInternalEventName)
    .filter(Boolean)
    .slice(-MAX_NEXUS_INTERNAL_EVENT_DEPTH);
}

export function prepareDialogyNexusInternalEvent(
  input: DialogyNexusInternalEventInput,
): PreparedDialogyNexusInternalEvent {
  const eventName = normalizedNexusInternalEventName(input.eventName);
  const eventId = String(input.eventId || '').trim();
  const workspaceId = String(input.workspaceId || '').trim();
  if (!workspaceId) throw new Error('O workspace do evento interno é obrigatório.');
  if (!eventName || !/^[a-z0-9][a-z0-9._:-]*$/.test(eventName)) {
    throw new Error('O nome do evento interno é inválido.');
  }
  if (!eventId) throw new Error('O identificador idempotente do evento interno é obrigatório.');

  const previousChain = normalizedEventChain(input.eventChain);
  if (previousChain.includes(eventName)) return { event: null, suppressed: 'cycle' };
  if (previousChain.length >= MAX_NEXUS_INTERNAL_EVENT_DEPTH) {
    return { event: null, suppressed: 'depth_limit' };
  }
  const eventChain = [...previousChain, eventName];
  return {
    event: {
      ...input,
      workspaceId,
      eventName,
      eventId,
      eventChain,
      context: {
        ...(input.context || {}),
        nexusInternalEventChain: eventChain,
        nexusInternalEventDepth: eventChain.length,
      },
    },
  };
}

async function executePreparedDialogyNexusInternalEvent(input: NexusInternalEventPayload) {
  const adapters = input.chatId
    ? async () => {
        const { createNexusChatAdapters } = await import('./chat-adapters');
        return createNexusChatAdapters({
          workspaceId: input.workspaceId,
          chatId: input.chatId!,
          instanceName: input.instanceName,
        });
      }
    : undefined;

  return dispatchPublishedNexusInternalEvent({
    workspaceId: input.workspaceId,
    eventName: input.eventName,
    eventId: input.eventId,
    payload: input.payload,
    context: input.context,
    variables: input.variables,
    sessionId: input.sessionId || input.chatId,
    conversationId: input.conversationId || input.chatId,
    adapters,
  });
}

export async function dispatchDialogyNexusInternalEvent(input: DialogyNexusInternalEventInput) {
  const prepared = prepareDialogyNexusInternalEvent(input);
  if (!prepared.event) {
    return { handled: false, queued: false, suppressed: prepared.suppressed, executions: [] };
  }
  if (shouldEnqueueJob('nexus_internal_event')) {
    const job = await enqueueNexusInternalEvent(prepared.event);
    return { handled: true, queued: true, jobId: job.id, executions: [] };
  }
  const result = await executePreparedDialogyNexusInternalEvent(prepared.event);
  return { ...result, queued: false };
}

/** Called only by the queue handler; the payload was normalized before enqueue. */
export async function executeQueuedDialogyNexusInternalEvent(input: NexusInternalEventPayload) {
  return executePreparedDialogyNexusInternalEvent(input);
}
