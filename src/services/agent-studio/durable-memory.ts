import { z } from 'zod';

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(JsonValueSchema), z.record(JsonValueSchema),
]));

/** A revision of a customer choice or request, never an execution authorization. */
export const StudioMemoryEventSchema = z.object({
  version: z.literal(1),
  requestId: z.string().min(1).max(200),
  kind: z.enum(['choice', 'request']),
  key: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  value: JsonValueSchema,
  status: z.enum(['active', 'paused', 'unavailable', 'cancelled', 'resolved']),
  sensitive: z.boolean(),
  source: z.object({
    sessionId: z.string().min(1).max(200),
    releaseId: z.string().min(1).max(200),
    procedureId: z.string().max(200).nullable(),
    messageId: z.string().min(1).max(200),
    quote: z.string().max(4000),
    at: z.string().datetime(),
  }).strict(),
}).strict();

export type StudioMemoryEvent = z.infer<typeof StudioMemoryEventSchema>;
export type StudioMemoryScope = { workspaceId: string; agentId: string; chatId: string };
export type StudioMemoryRecord = { sequence: string; eventId: string; event: StudioMemoryEvent };
export type StudioMemoryPage = { records: StudioMemoryRecord[]; nextCursor: string | null };

/** Context is a projection. Omitting sensitive content here does not delete its stored revision. */
export function studioMemoryEventContext(event: StudioMemoryEvent) {
  return {
    requestId: event.requestId, kind: event.kind, key: event.key,
    label: event.label, value: event.value, status: event.status,
    sourceMessageId: event.source.messageId, sourceQuote: event.source.quote, selectedAt: event.source.at,
    sourceSessionId: event.source.sessionId,
    procedureId: event.source.procedureId, releaseId: event.source.releaseId,
  };
}

export function studioMemoryContext(records: StudioMemoryRecord[]) {
  return records.filter(({ event }) => !event.sensitive).map(({ eventId, event }) => ({
    reference: eventId, ...studioMemoryEventContext(event),
  }));
}
