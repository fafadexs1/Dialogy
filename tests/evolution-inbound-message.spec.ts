import { describe, expect, it } from 'vitest';

import {
  extractEvolutionInteractiveResponseText,
  mapEvolutionInboundMessageTypeToDbType,
  resolveEvolutionInboundMessageType,
  shouldAppendInboundToClosedWhatsappChat,
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

  it('appends only delayed messages to a closed WhatsApp chat', () => {
    const closedAt = new Date('2026-04-25T11:00:00.000Z');

    expect(
      shouldAppendInboundToClosedWhatsappChat({
        closedAt,
        messageCreatedAt: new Date('2026-04-25T10:59:59.000Z'),
      })
    ).toBe(true);

    expect(
      shouldAppendInboundToClosedWhatsappChat({
        closedAt,
        messageCreatedAt: new Date('2026-04-25T11:00:01.000Z'),
      })
    ).toBe(false);
  });
});
