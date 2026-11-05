import { describe, expect, it } from 'vitest';
import { extractGmailText } from '@/modules/nexus/services/gmail-message';

describe('Gmail message extraction', () => {
  it('decodes inline text from nested MIME parts without including attachments', () => {
    const encode = (value: string) => Buffer.from(value).toString('base64url');
    const message = { payload: { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', body: { data: encode('Olá, reunião amanhã.') } },
      { mimeType: 'text/html', body: { data: encode('<p>ignorar</p>') } },
      { mimeType: 'text/plain', filename: 'anexo.txt', body: { data: encode('anexo') } },
    ] } };
    expect(extractGmailText(message)).toBe('Olá, reunião amanhã.');
  });
  it('bounds and ignores invalid encoded content', () => {
    expect(extractGmailText({ payload: { mimeType: 'text/plain', body: { data: '??' } } })).toBe('');
    expect(extractGmailText({ payload: { mimeType: 'text/plain', body: { data: Buffer.from('a'.repeat(21000)).toString('base64url') } } })).toHaveLength(20000);
  });
});
