import { describe, expect, it } from 'vitest';
import { createSystemAgentMessageAttribution } from '@/services/messages/sender-attribution';

describe('system-agent message attribution', () => {
  it('attributes automated media to system_agents instead of users', () => {
    expect(createSystemAgentMessageAttribution('system-agent-1', {
      sentBy: 'agent',
      isMarketing: true,
    })).toEqual({
      metadata: {
        sentBy: 'system_agent',
        isMarketing: true,
      },
      senderUserId: null,
      senderSystemAgentId: 'system-agent-1',
    });
  });
});
