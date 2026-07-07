import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  storageRemove: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    query: mocks.dbQuery,
  },
}));

vi.mock('@/lib/observability/logger', () => ({
  logAction: mocks.logAction,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        remove: mocks.storageRemove,
      }),
    },
  }),
}));

vi.mock('@/services/chat/auto-close', () => ({
  executeMarketingAutoClose: vi.fn(),
  executeQueueAutoClose: vi.fn(),
}));

vi.mock('@/services/webhook-dispatcher', () => ({
  dispatchMessageToWebhooksById: vi.fn(),
}));

vi.mock('@/services/whatsapp/send-template-message', () => ({
  sendTemplateMessage: vi.fn(),
}));

vi.mock('@/services/whatsapp/send-text-message', () => ({
  sendTextMessage: vi.fn(),
}));

vi.mock('@/lib/whatsapp/evolution-config', () => ({
  getEvolutionApiConfig: vi.fn(),
}));

import { handleQueueJob, handleQueueJobFailure } from '@/lib/queue/handlers';
import type { QueueJobRecord } from '@/lib/queue/types';

describe('WhatsApp queue failure evidence', () => {
  beforeEach(() => {
    mocks.dbQuery.mockReset();
    mocks.storageRemove.mockReset();
    mocks.logAction.mockReset();
  });

  it('persists the original transport error while leaving accepted messages untouched', async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{
          api_message_status: 'SENDING',
          message_id_from_api: null,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const job: QueueJobRecord = {
      id: 'whatsapp-job-1',
      type: 'whatsapp_send',
      status: 'active',
      payload: {
        messageId: 'message-1',
        workspaceId: 'workspace-1',
        instanceName: 'instance-1',
        number: '5500000000000@s.whatsapp.net',
        content: 'Oi',
      },
      attempts: 1,
      max_attempts: 1,
      run_at: new Date(0).toISOString(),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handleQueueJobFailure(job, new TypeError('fetch failed: socket closed'));

    const updateCall = mocks.dbQuery.mock.calls[1];
    expect(updateCall[0]).toContain(`'{send_error_details}'`);
    expect(updateCall[0]).toContain('WHERE id = $4');
    expect(updateCall[1][0]).toBe('FAILED');
    expect(updateCall[1][1]).toContain('fetch failed');
    expect(JSON.parse(updateCall[1][2])).toMatchObject({
      source: 'dialogy_whatsapp_queue',
      status: 'FAILED',
      reason: 'fetch failed: socket closed',
    });
    expect(updateCall[1][3]).toBe('message-1');
    consoleError.mockRestore();
  });

  it('deletes retry-retained temp media through an ai_task job', async () => {
    mocks.storageRemove.mockResolvedValueOnce({ error: null });
    const job: QueueJobRecord = {
      id: 'temp-media-delete-1',
      type: 'ai_task',
      status: 'active',
      payload: {
        task: 'temp_media_delete',
        payload: {
          bucket: 'temp-media',
          path: 'audio/audio-1.ogg',
        },
      },
      attempts: 0,
      max_attempts: 3,
      run_at: new Date(0).toISOString(),
    };

    await handleQueueJob(job);

    expect(mocks.storageRemove).toHaveBeenCalledWith(['audio/audio-1.ogg']);
    expect(mocks.logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'temp_media_delete',
      payload: {
        bucket: 'temp-media',
        path: 'audio/audio-1.ogg',
      },
    }));
  });
});
