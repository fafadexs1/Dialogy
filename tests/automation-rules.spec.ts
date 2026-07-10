import { describe, expect, it } from 'vitest';

import {
  isSafeAutopilotWebhookUrl,
  sanitizeAutopilotRules,
  toPromptSafeAutopilotRules,
} from '@/services/autopilot/automation-rules';

describe('autopilot automation rule sanitation', () => {
  it('keeps a valid rule when another persisted rule has an invalid action', () => {
    const result = sanitizeAutopilotRules([
      {
        id: 'reply-rule',
        name: 'Saudacao',
        trigger: 'Cliente diz oi',
        enabled: true,
        action: { type: 'reply', value: 'Ola! Como posso ajudar?' },
      },
      {
        id: 'broken-rule',
        name: 'Regra antiga quebrada',
        trigger: 'Cliente pede suporte',
        enabled: true,
        action: { type: 'reply', payload: {} },
      },
    ]);

    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({ id: 'reply-rule', action: { type: 'reply' } });
    expect(result.invalid).toEqual([
      expect.objectContaining({ id: 'broken-rule', reason: 'unsupported_or_invalid_action' }),
    ]);
  });

  it('repairs the legacy reply payload shape without accepting an invalid webhook URL', () => {
    const result = sanitizeAutopilotRules([
      {
        id: 'legacy-reply',
        name: 'Resposta legada',
        trigger: 'Cliente pede horario',
        action: { type: 'reply', payload: { message: 'Atendemos de segunda a sexta.' } },
      },
      {
        id: 'bad-webhook',
        name: 'Webhook invalido',
        trigger: 'Cliente pede retorno',
        action: { type: 'webhook', url: 'not-a-url' },
      },
    ]);

    expect(result.rules).toEqual([
      expect.objectContaining({
        id: 'legacy-reply',
        action: { type: 'reply', value: 'Atendemos de segunda a sexta.' },
      }),
    ]);
    expect(result.invalid).toEqual([
      expect.objectContaining({ id: 'bad-webhook' }),
    ]);
  });

  it('does not disclose webhook credentials or URL to the model prompt', () => {
    const { rules } = sanitizeAutopilotRules([{
      id: 'webhook-rule',
      name: 'Criar lead',
      trigger: 'Cliente pede proposta',
      action: {
        type: 'webhook',
        url: 'https://example.test/leads',
        method: 'POST',
        description: 'Cria um lead comercial.',
        auth: { type: 'bearer', token: 'secret-token' },
      },
    }]);

    expect(toPromptSafeAutopilotRules(rules)).toEqual([{
      name: 'Criar lead',
      trigger: 'Cliente pede proposta',
      action: {
        type: 'webhook',
        method: 'POST',
        description: 'Cria um lead comercial.',
      },
    }]);
  });

  it('accepts only public HTTPS webhook targets', () => {
    expect(isSafeAutopilotWebhookUrl('https://api.example.com/hooks/dialogy')).toBe(true);

    for (const unsafeUrl of [
      'http://api.example.com/hooks/dialogy',
      'https://127.0.0.1/hooks',
      'https://169.254.169.254/latest/meta-data',
      'https://192.168.1.10/hooks',
      'https://[::1]/hooks',
      'https://localhost/hooks',
      'https://user:password@api.example.com/hooks',
    ]) {
      expect(isSafeAutopilotWebhookUrl(unsafeUrl)).toBe(false);
    }

    const result = sanitizeAutopilotRules([{
      id: 'private-webhook',
      name: 'Endpoint privado',
      trigger: 'cliente pede dados',
      action: { type: 'webhook', url: 'http://127.0.0.1/internal', method: 'POST' },
    }]);
    expect(result.rules).toEqual([]);
    expect(result.invalid).toEqual([
      expect.objectContaining({ id: 'private-webhook', reason: 'unsupported_or_invalid_action' }),
    ]);
  });
});
