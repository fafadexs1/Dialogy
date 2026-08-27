import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const messagesSource = readFileSync(resolve(process.cwd(), 'src/actions/messages.ts'), 'utf8');
const webhookSource = readFileSync(
  resolve(process.cwd(), 'src/services/whatsapp/evolution-webhook-handler.ts'),
  'utf8',
);

describe('automated media delivery confirmation', () => {
  it('waits for a provider message id before reporting automated media success', () => {
    const automatedMedia = messagesSource.slice(
      messagesSource.indexOf('export async function sendAutomatedMediaAction'),
      messagesSource.indexOf('function parseCurrencyStringToCents'),
    );
    const internalMedia = messagesSource.slice(
      messagesSource.indexOf('async function internalSendMedia'),
      messagesSource.indexOf('export const sendAgentMessageAction'),
    );

    expect(automatedMedia).toContain('{ awaitProvider: true }');
    expect(internalMedia).toContain('const delivery = await deliverPendingMedia()');
    expect(internalMedia).toContain('if (!providerMessageId)');
    expect(internalMedia).toContain('let finalMediaUrl: string | null = originalDocumentUrl || permanentFromProvider');
  });

  it('does not infer READ for messages that were never accepted by the provider', () => {
    const readPropagationStart = webhookSource.indexOf('const olderMessagesRes');
    const readPropagation = webhookSource.slice(
      readPropagationStart,
      webhookSource.indexOf("await client.query('COMMIT')", readPropagationStart),
    );

    expect(readPropagation).toContain('message_id_from_api IS NOT NULL');
    expect(readPropagation).toContain("IN ('SENT', 'DELIVERED')");
  });
});
