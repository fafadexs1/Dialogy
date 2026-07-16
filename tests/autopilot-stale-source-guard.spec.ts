import { describe, expect, it } from 'vitest';

import {
  assertAutopilotSourceMessageCurrent,
  AutopilotSourceSupersededError,
  isAutopilotSourceMessageStillCurrent,
} from '@/services/autopilot/runtime/stale-source-guard';

function fakeDatabase(state: {
  sourceExists?: boolean;
  hasNewerCustomerMessage?: boolean;
  error?: Error;
}) {
  return {
    async query() {
      if (state.error) throw state.error;
      return {
        rows: [{
          source_exists: state.sourceExists ?? true,
          has_newer_customer_message: state.hasNewerCustomerMessage ?? false,
        }],
        rowCount: 1,
      };
    },
  };
}

describe('autopilot stale source guard', () => {
  it('ignores internal system-agent events when deciding whether the customer source is stale', async () => {
    let queryText = '';
    await isAutopilotSourceMessageStillCurrent({
      chatId: 'chat-1',
      sourceMessageId: 'message-1',
      database: {
        async query(query) {
          queryText = query;
          return { rows: [{ source_exists: true, has_newer_customer_message: false }] };
        },
      },
    });

    expect(queryText).toContain('m.sender_system_agent_id IS NULL');
    expect(queryText).toContain("COALESCE(m.type, '') <> 'system'");
  });

  it('accepts the latest existing customer message', async () => {
    await expect(isAutopilotSourceMessageStillCurrent({
      chatId: 'chat-1',
      sourceMessageId: 'message-1',
      database: fakeDatabase({}),
    })).resolves.toBe(true);
  });

  it('rejects a source message after a newer customer message arrives', async () => {
    const input = {
      chatId: 'chat-1',
      sourceMessageId: 'message-old',
      database: fakeDatabase({ hasNewerCustomerMessage: true }),
    };

    await expect(isAutopilotSourceMessageStillCurrent(input)).resolves.toBe(false);
    await expect(assertAutopilotSourceMessageCurrent(input)).rejects.toBeInstanceOf(
      AutopilotSourceSupersededError,
    );
  });

  it('fails closed when the source disappeared or freshness cannot be verified', async () => {
    await expect(isAutopilotSourceMessageStillCurrent({
      chatId: 'chat-1',
      sourceMessageId: 'missing',
      database: fakeDatabase({ sourceExists: false }),
    })).resolves.toBe(false);

    await expect(isAutopilotSourceMessageStillCurrent({
      chatId: 'chat-1',
      sourceMessageId: 'message-1',
      database: fakeDatabase({ error: new Error('database unavailable') }),
    })).resolves.toBe(false);
  });
});
