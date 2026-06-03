import { describe, expect, it } from 'vitest';

import { guardRepeatedConfirmationPrompt } from '@/services/autopilot/runtime/repetition-guard';

const rebootPrompt = 'Posso reiniciar seu roteador agora? A conexao pode ficar indisponivel por alguns minutos enquanto o equipamento reinicia.';

describe('autopilot confirmation repetition guard', () => {
  it('sends the first confirmation prompt normally', () => {
    expect(guardRepeatedConfirmationPrompt({
      message: rebootPrompt,
      recentAutomatedMessages: [],
    })).toEqual({
      action: 'send',
      message: rebootPrompt,
    });
  });

  it('replaces a repeated confirmation prompt with a single recovery instruction', () => {
    const guarded = guardRepeatedConfirmationPrompt({
      message: rebootPrompt,
      recentAutomatedMessages: [`*TICKETMASTER (Agente Virtual)*:\n\n${rebootPrompt}`],
    });

    expect(guarded.action).toBe('replace');
    expect(guarded.message).toContain('pausei esta tentativa');
    expect(guarded.message).toContain('confirme explicitamente qual acao');
    expect(guarded.message).not.toContain('Posso reiniciar seu roteador agora?');
  });

  it('suppresses further repeats after the recovery instruction was already sent', () => {
    const recovery = guardRepeatedConfirmationPrompt({
      message: rebootPrompt,
      recentAutomatedMessages: [rebootPrompt],
    });
    const guarded = guardRepeatedConfirmationPrompt({
      message: rebootPrompt,
      recentAutomatedMessages: [rebootPrompt, recovery.message || ''],
    });

    expect(guarded).toEqual({
      action: 'suppress',
      message: null,
    });
  });

  it('replaces ordinary repeated responses with a generic recovery instruction', () => {
    const message = 'Aqui estao os dados do seu contrato.';
    const guarded = guardRepeatedConfirmationPrompt({
      message,
      recentAutomatedMessages: [`*RAQUEL (Agente Virtual)*:\n\n${message}`],
    });

    expect(guarded.action).toBe('replace');
    expect(guarded.message).toContain('pausei esta tentativa automatica');
    expect(guarded.message).not.toContain(message);
  });

  it('suppresses ordinary repeats after the generic recovery instruction was already sent', () => {
    const message = 'Estou com uma instabilidade para responder agora. Nossa equipe vai acompanhar por aqui.';
    const recovery = guardRepeatedConfirmationPrompt({
      message,
      recentAutomatedMessages: [message],
    });

    expect(guardRepeatedConfirmationPrompt({
      message,
      recentAutomatedMessages: [message, recovery.message || ''],
    })).toEqual({
      action: 'suppress',
      message: null,
    });
  });

  it('replaces long responses that only reformulate the same message', () => {
    const previousMessage = 'Estou com uma instabilidade para responder agora. Nossa equipe vai acompanhar por aqui enquanto verificamos o atendimento.';
    const reformulatedMessage = 'Estou com uma instabilidade para responder neste momento. Nossa equipe vai acompanhar por aqui enquanto verificamos o atendimento.';
    const guarded = guardRepeatedConfirmationPrompt({
      message: reformulatedMessage,
      recentAutomatedMessages: [previousMessage],
    });

    expect(guarded.action).toBe('replace');
    expect(guarded.message).toContain('pausei esta tentativa automatica');
  });

  it('sends a new ordinary response normally', () => {
    const message = 'Aqui estao os dados do seu contrato.';
    expect(guardRepeatedConfirmationPrompt({
      message,
      recentAutomatedMessages: ['Uma resposta anterior diferente.'],
    })).toEqual({
      action: 'send',
      message,
    });
  });
});
