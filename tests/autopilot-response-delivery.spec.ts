import { describe, expect, it } from 'vitest';

import {
  markAutopilotResponseBlockDelivered,
  markAutopilotResponseBlockSending,
  markAutopilotResponseDeliveryError,
  prepareAutopilotResponseDelivery,
} from '@/services/autopilot/runtime/response-delivery';

function fakeResponseDeliveryDatabase() {
  let delivery:
    | {
        id: string;
        blocks: string[];
        status: 'pending' | 'sending' | 'sent' | 'error';
        nextBlockIndex: number;
        lastError: string | null;
      }
    | undefined;
  const deliveredBlockIndexes = new Set<number>();

  return {
    state() {
      return {
        delivery,
        deliveredBlockIndexes: new Set(deliveredBlockIndexes),
      };
    },
    persistBlock(index: number) {
      deliveredBlockIndexes.add(index);
    },
    async query(query: string, params: unknown[] = []) {
      if (query.includes('INSERT INTO autopilot_response_deliveries')) {
        if (!delivery) {
          delivery = {
            id: 'delivery-1',
            blocks: JSON.parse(String(params[5])) as string[],
            status: 'pending',
            nextBlockIndex: 0,
            lastError: null,
          };
        }
        return {
          rows: [{
            id: delivery.id,
            blocks: delivery.blocks,
            status: delivery.status,
          }],
          rowCount: 1,
        };
      }
      if (
        query.includes(`metadata->>'autopilotResponseBlockIndex'`) &&
        query.includes('FROM messages')
      ) {
        return {
          rows: [...deliveredBlockIndexes].map((index) => ({
            block_index: String(index),
            message_status: 'SENT',
          })),
          rowCount: deliveredBlockIndexes.size,
        };
      }
      if (query.includes(`SET status = 'sending'`)) {
        if (!delivery) throw new Error('delivery missing');
        delivery.status = 'sending';
        delivery.nextBlockIndex = Math.max(delivery.nextBlockIndex, Number(params[1]));
        delivery.lastError = null;
        return { rows: [], rowCount: 1 };
      }
      if (query.includes(`SET status = CASE WHEN $3 THEN 'sent'`)) {
        if (!delivery) throw new Error('delivery missing');
        delivery.nextBlockIndex = Math.max(delivery.nextBlockIndex, Number(params[1]));
        delivery.status = params[2] ? 'sent' : 'sending';
        delivery.lastError = null;
        return { rows: [], rowCount: 1 };
      }
      if (query.includes(`SET status = 'sent'`)) {
        if (!delivery) throw new Error('delivery missing');
        delivery.status = 'sent';
        delivery.nextBlockIndex = Number(params[1]);
        delivery.lastError = null;
        return { rows: [], rowCount: 1 };
      }
      if (query.includes(`SET status = 'error'`)) {
        if (!delivery) throw new Error('delivery missing');
        delivery.status = 'error';
        delivery.lastError = String(params[1]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${query}`);
    },
  };
}

const trace = {
  workspaceId: 'workspace-1',
  sourceMessageId: 'message-1',
  orchestratorRunId: 'run-1',
};

describe('durable autopilot response delivery', () => {
  it('freezes the first planned response across retries', async () => {
    const database = fakeResponseDeliveryDatabase();
    const first = await prepareAutopilotResponseDelivery({
      trace,
      chatId: 'chat-1',
      blocks: ['Primeiro bloco', 'Segundo bloco'],
      database,
    });
    const retry = await prepareAutopilotResponseDelivery({
      trace: { ...trace, orchestratorRunId: 'run-2' },
      chatId: 'chat-1',
      blocks: ['Resposta regenerada que nao deve substituir a original'],
      database,
    });

    expect(first?.blocks).toEqual(['Primeiro bloco', 'Segundo bloco']);
    expect(retry?.blocks).toEqual(['Primeiro bloco', 'Segundo bloco']);
  });

  it('recognizes persisted blocks and marks a fully persisted delivery as sent', async () => {
    const database = fakeResponseDeliveryDatabase();
    await prepareAutopilotResponseDelivery({
      trace,
      chatId: 'chat-1',
      blocks: ['Bloco 1', 'Bloco 2'],
      database,
    });
    database.persistBlock(0);
    database.persistBlock(1);

    const resumed = await prepareAutopilotResponseDelivery({
      trace,
      chatId: 'chat-1',
      blocks: ['Bloco novo'],
      database,
    });

    expect([...resumed!.deliveredBlockIndexes]).toEqual([0, 1]);
    expect(resumed?.status).toBe('sent');
    expect(database.state().delivery?.nextBlockIndex).toBe(2);
  });

  it('keeps progress retryable after a provider error', async () => {
    const database = fakeResponseDeliveryDatabase();
    const prepared = await prepareAutopilotResponseDelivery({
      trace,
      chatId: 'chat-1',
      blocks: ['Bloco 1', 'Bloco 2'],
      database,
    });

    await markAutopilotResponseBlockSending({
      deliveryId: prepared!.id,
      blockIndex: 0,
      database,
    });
    await markAutopilotResponseDeliveryError({
      deliveryId: prepared!.id,
      error: new Error('provider timeout'),
      database,
    });

    expect(database.state().delivery).toMatchObject({
      status: 'error',
      nextBlockIndex: 0,
      lastError: 'provider timeout',
    });

    database.persistBlock(0);
    await markAutopilotResponseBlockDelivered({
      deliveryId: prepared!.id,
      blockIndex: 0,
      blockCount: 2,
      database,
    });
    expect(database.state().delivery).toMatchObject({
      status: 'sending',
      nextBlockIndex: 1,
      lastError: null,
    });
  });
});
