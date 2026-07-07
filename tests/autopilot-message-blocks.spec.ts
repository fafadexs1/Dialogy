import { describe, expect, it } from 'vitest';

import { shouldPrependPrimaryResponseToMessageBlocks } from '@/services/autopilot/message-blocks';

describe('autopilot message block reconciliation', () => {
  it('does not duplicate a commercial summary already covered by the blocks', () => {
    expect(shouldPrependPrimaryResponseToMessageBlocks(
      'Ja finalizei o seu pre-cadastro. O setor comercial entrara em contato no proximo dia util para continuar a contratacao do plano de 1000 MEGA.',
      [
        'Informacoes do pre-cadastro: plano de 1000 MEGA.',
        'Proximos passos: o setor comercial entrara em contato no proximo dia util para continuar a contratacao.',
      ],
    )).toBe(false);
  });

  it('preserves a distinct safety instruction before informational blocks', () => {
    expect(shouldPrependPrimaryResponseToMessageBlocks(
      'Leve a crianca agora ao pronto-socorro mais proximo.',
      [
        'Horario solicitado: hoje as 19h00.',
        'A equipe confirmara a disponibilidade da consulta.',
      ],
    )).toBe(true);
  });
});
