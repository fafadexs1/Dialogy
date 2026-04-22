import { describe, expect, it } from 'vitest';

import {
  extractEvolutionInteractiveResponseText,
  mapEvolutionInboundMessageTypeToDbType,
  resolveEvolutionInboundMessageType,
} from '@/lib/whatsapp/evolution-inbound-message';

describe('evolution inbound message helpers', () => {
  it('treats buttonMessage payloads as text messages', () => {
    const effectiveType = resolveEvolutionInboundMessageType({
      messageType: 'buttonMessage',
      rawMessage: {
        conversation: 'Estou indo atender',
      },
    });

    expect(effectiveType).toBe('buttonMessage');
    expect(mapEvolutionInboundMessageTypeToDbType(effectiveType)).toBe('text');
  });

  it('extracts selected display text from buttons responses', () => {
    expect(
      extractEvolutionInteractiveResponseText({
        buttonsResponseMessage: {
          selectedDisplayText: 'Confirmar visita',
          selectedButtonId: 'btn-confirm',
        },
      })
    ).toBe('Confirmar visita');
  });

  it('infers buttonsResponseMessage as text when messageType is absent', () => {
    const effectiveType = resolveEvolutionInboundMessageType({
      rawMessage: {
        buttonsResponseMessage: {
          selectedDisplayText: 'Confirmar visita',
        },
      },
    });

    expect(effectiveType).toBe('buttonsResponseMessage');
    expect(mapEvolutionInboundMessageTypeToDbType(effectiveType)).toBe('text');
  });

  it('extracts list selections when the list response has no title', () => {
    expect(
      extractEvolutionInteractiveResponseText({
        listResponseMessage: {
          singleSelectReply: {
            selectedRowId: 'row-atendimento',
          },
        },
      })
    ).toBe('row-atendimento');
  });

  it('extracts native flow interactive payload text', () => {
    expect(
      extractEvolutionInteractiveResponseText({
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({
              title: 'Atendimento presencial',
              id: 'presence',
            }),
          },
        },
      })
    ).toBe('Atendimento presencial');
  });
});
