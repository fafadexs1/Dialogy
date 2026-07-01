import { describe, expect, it, vi } from 'vitest';

import {
  isProviderAcceptedMessageState,
  isUncertainProviderDeliveryError,
  isUncertainProviderFailureMetadata,
  waitForAutomatedProviderAcceptance,
} from '@/services/autopilot/runtime/provider-delivery';

describe('autopilot provider delivery acknowledgement', () => {
  it('does not treat a persisted pending message as provider accepted', () => {
    expect(isProviderAcceptedMessageState({
      status: 'PENDING',
      externalMessageId: null,
    })).toBe(false);
    expect(isProviderAcceptedMessageState({
      status: 'SENT',
      externalMessageId: null,
    })).toBe(true);
  });

  it('waits until the asynchronous sender records provider acceptance', async () => {
    const states: Array<{
      api_message_status: string;
      message_id_from_api: string | null;
    }> = [
      { api_message_status: 'PENDING', message_id_from_api: null },
      { api_message_status: 'SENDING', message_id_from_api: null },
      { api_message_status: 'SENT', message_id_from_api: 'provider-message-1' },
    ];
    const database = {
      query: vi.fn(async () => ({
        rows: states.length > 0 ? [states.shift()!] : [],
        rowCount: 1,
      })),
    };

    await waitForAutomatedProviderAcceptance({
      result: {
        success: true,
        message: { id: 'message-1' },
      },
      chatId: 'chat-1',
      database,
      timeoutMs: 1_000,
      pollIntervalMs: 1,
      sleep: async () => undefined,
    });

    expect(database.query).toHaveBeenCalledTimes(3);
  });

  it('fails the delivery when the provider rejects the persisted message', async () => {
    const database = {
      query: vi.fn(async () => ({
        rows: [{ api_message_status: 'FAILED', message_id_from_api: null }],
        rowCount: 1,
      })),
    };

    await expect(waitForAutomatedProviderAcceptance({
      result: {
        success: true,
        message: { id: 'message-1' },
      },
      chatId: 'chat-1',
      database,
      timeoutMs: 1_000,
    })).rejects.toThrow('Provedor rejeitou');
  });

  it('accepts synchronous channels only when they explicitly confirm provider acceptance', async () => {
    await expect(waitForAutomatedProviderAcceptance({
      result: { success: true, providerAccepted: true },
      chatId: 'chat-1',
      database: {
        query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      },
    })).resolves.toBeUndefined();

    await expect(waitForAutomatedProviderAcceptance({
      result: { success: true },
      chatId: 'chat-1',
      database: {
        query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      },
    })).rejects.toThrow('nao informou aceite do provedor');
  });

  it('classifies network ambiguity separately from an explicit provider rejection', async () => {
    expect(isUncertainProviderFailureMetadata({
      send_error_details: {
        reason: 'This operation was aborted',
      },
    })).toBe(true);
    expect(isUncertainProviderFailureMetadata({
      send_error_details: {
        reason: 'Evolution API Error: 503 Service Unavailable',
      },
    })).toBe(false);

    const database = {
      query: vi.fn(async () => ({
        rows: [{
          api_message_status: 'FAILED',
          message_id_from_api: null,
          metadata: {
            send_error_details: {
              reason: 'fetch failed: socket closed',
            },
          },
        }],
        rowCount: 1,
      })),
    };
    let thrown: unknown;
    try {
      await waitForAutomatedProviderAcceptance({
        result: {
          success: true,
          message: { id: 'message-1' },
        },
        chatId: 'chat-1',
        database,
      });
    } catch (error) {
      thrown = error;
    }
    expect(isUncertainProviderDeliveryError(thrown)).toBe(true);
  });
});
