import { describe, expect, it } from 'vitest';
import { nexusMessageTriggerMatches } from '@/modules/nexus/services/message-dispatcher';

const instancePlatforms = { zap1: 'whatsapp', zap2: 'whatsapp', bot1: 'telegram', bot2: 'telegram' };
const config = {
  matchMode: 'all', platforms: ['whatsapp', 'instagram', 'messenger', 'telegram', 'webchat'],
  instanceNames: ['zap1'], messageTypes: ['text'], startPolicy: 'unassigned_only',
};
const context = { instancePlatforms, messageType: 'text', chatStatus: 'gerais' };

describe('published multi-channel instance restrictions', () => {
  it.each(['instagram', 'messenger', 'webchat', 'telegram'])(
    'does not block %s with a WhatsApp instance restriction', platform => {
      expect(nexusMessageTriggerMatches(config, 'Olá', { ...context, platform, instanceName: 'other-channel' })).toBe(true);
    },
  );
  it('keeps the WhatsApp allowlist and rejects missing instance identity', () => {
    for (const [instanceName, expected] of [['ZAP1', true], ['zap2', false], ['', false]] as const) {
      expect(nexusMessageTriggerMatches(config, 'Olá', { ...context, platform: 'WhatsApp', instanceName })).toBe(expected);
    }
  });
  it('restricts each channel independently when WhatsApp and Telegram are selected', () => {
    const both = { ...config, instanceNames: ['zap1', 'bot1'] };
    for (const [platform, instanceName, expected] of [
      ['whatsapp', 'zap1', true], ['whatsapp', 'zap2', false],
      ['telegram', 'bot1', true], ['telegram', 'bot2', false], ['telegram', 'zap1', false],
    ] as const) {
      expect(nexusMessageTriggerMatches(both, 'Olá', { ...context, platform, instanceName })).toBe(expected);
    }
    expect(nexusMessageTriggerMatches({ ...config, instanceNames: ['bot1'] }, 'Olá', {
      ...context, platform: 'whatsapp', instanceName: 'zap2',
    })).toBe(true);
  });
  it('preserves channel, message type and assignment restrictions', () => {
    const meta = { ...context, platform: 'instagram' };
    for (const patch of [{ agentId: 'human' }, { assignedSystemAgentId: 'agent' },
      { chatStatus: 'atendimentos' }, { chatStatus: 'encerrados' }, { messageType: 'image' },
      { platform: 'unsupported' }]) {
      expect(nexusMessageTriggerMatches(config, 'Olá', { ...meta, ...patch })).toBe(false);
    }
    expect(nexusMessageTriggerMatches({ ...config, platforms: ['whatsapp'] }, 'Olá', meta)).toBe(false);
    expect(nexusMessageTriggerMatches({ ...config, platforms: [] }, 'Olá', meta)).toBe(true);
  });
  it('does not broaden restrictions when instance ownership or channel is unknown', () => {
    expect(nexusMessageTriggerMatches(config, 'Olá', {
      ...context, instancePlatforms: {}, platform: 'telegram', instanceName: 'bot1',
    })).toBe(false);
    expect(nexusMessageTriggerMatches(config, 'Olá', {
      ...context, platform: 'whatsapp', instanceName: 'zap2',
    })).toBe(false);
  });
});
