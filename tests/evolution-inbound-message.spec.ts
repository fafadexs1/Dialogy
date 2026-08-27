import { describe, expect, it } from 'vitest';

import {
  extractEvolutionInteractiveResponseId,
  extractEvolutionInteractiveResponseText,
  mapEvolutionInboundMessageTypeToDbType,
  resolveEvolutionInteractiveSelectionFromQuotedMessage,
  resolveEvolutionInboundMessageType,
  shouldAppendInboundToClosedWhatsappChat,
} from '@/lib/whatsapp/evolution-inbound-message';

describe('evolution inbound message helpers', () => {
  it('maps a standard conversation webhook payload to text', () => {
    const effectiveType = resolveEvolutionInboundMessageType({
      messageType: 'conversation',
      rawMessage: {
        conversation: 'Boa tarde',
      },
    });

    expect(effectiveType).toBe('conversation');
    expect(mapEvolutionInboundMessageTypeToDbType(effectiveType)).toBe('text');
  });

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

  it('keeps the exact list option id even when WhatsApp also returns a display title', () => {
    const response = {
      listResponseMessage: {
        title: 'Financeiro',
        singleSelectReply: { selectedRowId: 'finance' },
      },
    };

    expect(extractEvolutionInteractiveResponseText(response)).toBe('Financeiro');
    expect(extractEvolutionInteractiveResponseId(response)).toBe('finance');
  });

  it('treats Evolution interactiveMessage list clicks as inbound text', () => {
    const effectiveType = resolveEvolutionInboundMessageType({
      messageType: 'interactiveMessage',
      rawMessage: {
        contextInfo: { stanzaId: 'list-message-id' },
        conversation: 'contract-28174',
      },
    });

    expect(effectiveType).toBe('interactiveMessage');
    expect(mapEvolutionInboundMessageTypeToDbType(effectiveType)).toBe('text');
  });

  it('extracts a native flow selection nested in interactiveMessage', () => {
    expect(
      extractEvolutionInteractiveResponseText({
        interactiveMessage: {
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({ selectedRowId: 'invoice-123' }),
          },
        },
      })
    ).toBe('invoice-123');
  });

  it('recovers the original row id when Evolution returns only the truncated list title', () => {
    expect(
      resolveEvolutionInteractiveSelectionFromQuotedMessage('Fatura 898373 · vence 20', {
        interactivePayload: {
          kind: 'list',
          sections: [
            {
              rows: [
                {
                  rowId: '898373',
                  title: 'Fatura 898373 · vence 20',
                  description: 'Fatura 898373 · vence 20/08/2026 · R$ 54,95',
                },
                {
                  rowId: '898374',
                  title: 'Fatura 898374 · vence 20',
                  description: 'Fatura 898374 · vence 20/09/2026 · R$ 54,95',
                },
              ],
            },
          ],
        },
      })
    ).toBe('898373');
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
