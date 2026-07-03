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

  it('rephrases a repeated confirmation without pausing the conversation', () => {
    const guarded = guardRepeatedConfirmationPrompt({
      message: rebootPrompt,
      recentAutomatedMessages: [`*TICKETMASTER (Agente Virtual)*:\n\n${rebootPrompt}`],
    });

    expect(guarded.action).toBe('replace');
    expect(guarded.message).toContain('Ainda preciso da sua confirmacao explicita');
    expect(guarded.message).toContain('confirme qual acao');
    expect(guarded.message).not.toContain('Posso reiniciar seu roteador agora?');
  });

  it('keeps asking safely instead of suppressing the response or disabling the agent', () => {
    const recovery = guardRepeatedConfirmationPrompt({
      message: rebootPrompt,
      recentAutomatedMessages: [rebootPrompt],
    });
    const guarded = guardRepeatedConfirmationPrompt({
      message: rebootPrompt,
      recentAutomatedMessages: [rebootPrompt, recovery.message || ''],
    });

    expect(guarded.action).toBe('replace');
    expect(guarded.message).toContain('Ainda preciso da sua confirmacao explicita');
  });

  it('does not replace an ordinary repeated LLM response with a refusal message', () => {
    const message = 'Ja localizei os dados necessarios. Vou seguir com o atendimento usando as informacoes disponiveis e aviso antes de executar qualquer acao sensivel.';
    const guarded = guardRepeatedConfirmationPrompt({
      message,
      recentAutomatedMessages: [`*RAQUEL (Agente Virtual)*:\n\n${message}`],
    });

    expect(guarded).toEqual({
      action: 'send',
      message,
    });
  });

  it('lets the LLM continue even when a long answer resembles an earlier one', () => {
    const previousMessage = 'Estou com uma instabilidade para responder agora. Nossa equipe vai acompanhar por aqui enquanto verificamos o atendimento.';
    const reformulatedMessage = 'Estou com uma instabilidade para responder neste momento. Nossa equipe vai acompanhar por aqui enquanto verificamos o atendimento.';
    const guarded = guardRepeatedConfirmationPrompt({
      message: reformulatedMessage,
      recentAutomatedMessages: [previousMessage],
    });

    expect(guarded).toEqual({
      action: 'send',
      message: reformulatedMessage,
    });
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
