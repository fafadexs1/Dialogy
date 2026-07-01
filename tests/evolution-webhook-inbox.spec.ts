import { describe, expect, it, vi } from 'vitest';

import {
  claimEvolutionWebhookEvent,
  deriveEvolutionWebhookDedupKey,
  markEvolutionWebhookEventFailed,
  persistEvolutionWebhookEvent,
} from '@/services/whatsapp/evolution-webhook-inbox';

describe('Evolution durable webhook inbox', () => {
  it('derives a stable message key without depending on JSON property order', () => {
    const first = deriveEvolutionWebhookDedupKey({
      eventName: 'messages.upsert',
      payload: { data: { message: { conversation: 'oi' }, key: { id: 'abc' } } },
    });
    const second = deriveEvolutionWebhookDedupKey({
      eventName: 'messages.upsert',
      payload: { data: { key: { id: 'abc' }, message: { conversation: 'alterado' } } },
    });

    expect(first).toBe('message:abc');
    expect(second).toBe(first);
  });

  it('keeps distinct delivery statuses for the same message update', () => {
    const sent = deriveEvolutionWebhookDedupKey({
      eventName: 'messages.update',
      payload: { data: { key: { id: 'abc' }, status: 'SENT' } },
    });
    const read = deriveEvolutionWebhookDedupKey({
      eventName: 'messages.update',
      payload: { data: { key: { id: 'abc' }, status: 'READ' } },
    });

    expect(sent).not.toBe(read);
  });

  it('persists the payload before returning an inbox event', async () => {
    const database = {
      query: vi.fn(async () => ({
        rows: [{
          id: 'event-1',
          workspace_id: 'workspace-1',
          instance_name: 'instance-1',
          event_name: 'messages.upsert',
          dedup_key: 'message:abc',
          payload: { event: 'messages.upsert' },
          status: 'pending',
          attempt_count: 0,
          max_attempts: 5,
        }],
        rowCount: 1,
      })),
    };

    const result = await persistEvolutionWebhookEvent({
      workspaceId: 'workspace-1',
      instanceName: 'instance-1',
      eventName: 'messages.upsert',
      payload: { event: 'messages.upsert', data: { key: { id: 'abc' } } },
      database,
    });

    expect(result).toMatchObject({ id: 'event-1', status: 'pending' });
    expect(database.query).toHaveBeenCalledOnce();
  });

  it('claims only an eligible event and transitions exhausted failures to dead letter', async () => {
    const claimDatabase = {
      query: vi.fn(async () => ({
        rows: [{
          id: 'event-1',
          workspace_id: 'workspace-1',
          instance_name: 'instance-1',
          event_name: 'messages.upsert',
          dedup_key: 'message:abc',
          payload: {},
          status: 'processing',
          attempt_count: 5,
          max_attempts: 5,
        }],
        rowCount: 1,
      })),
    };
    const event = await claimEvolutionWebhookEvent({
      eventId: 'event-1',
      workerId: 'worker-1',
      database: claimDatabase,
    });
    expect(event?.status).toBe('processing');

    const failureDatabase = {
      query: vi.fn(async () => ({
        rows: [{ status: 'dead_letter' }],
        rowCount: 1,
      })),
    };
    await expect(markEvolutionWebhookEventFailed({
      eventId: 'event-1',
      workerId: 'worker-1',
      error: new Error('boom'),
      database: failureDatabase,
    })).resolves.toBe('dead_letter');
  });
});
