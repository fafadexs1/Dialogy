import 'server-only';

import { after } from 'next/server';

import type { DialogyNexusInternalEventInput } from './dialogy-event-dispatcher';

async function safelyDispatchDialogyNexusInternalEvent(input: DialogyNexusInternalEventInput) {
  try {
    const { dispatchDialogyNexusInternalEvent } = await import('./dialogy-event-dispatcher');
    await dispatchDialogyNexusInternalEvent(input);
  } catch (error) {
    console.error('[NEXUS_INTERNAL_EVENT] Falha ao despachar evento da Dialogy:', {
      workspaceId: input.workspaceId,
      eventName: input.eventName,
      eventId: input.eventId,
      error,
    });
  }
}

/**
 * Keeps user-facing mutations fast while making Next keep the request alive
 * until the event is enqueued (or executed in inline queue mode).
 */
export function scheduleDialogyNexusInternalEvent(input: DialogyNexusInternalEventInput) {
  try {
    after(() => safelyDispatchDialogyNexusInternalEvent(input));
  } catch {
    // Worker/direct server invocations do not always have a Next request scope.
    // Those processes are long lived, so dispatch without blocking the mutation.
    void safelyDispatchDialogyNexusInternalEvent(input);
  }
}
