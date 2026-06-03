import { describe, expect, it } from 'vitest';

import { prependIntelligentAttendantSignature } from '@/lib/message-signature';

describe('intelligent attendant message signature', () => {
  it('adds the virtual agent marker before the outbound message', () => {
    expect(prependIntelligentAttendantSignature('Como posso ajudar?', 'Suporte IA')).toBe(
      '*SUPORTE IA (Agente Virtual)*:\n\nComo posso ajudar?'
    );
  });

  it('does not duplicate the signature when a message is retried', () => {
    const signed = '*SUPORTE IA (Agente Virtual)*:\n\nComo posso ajudar?';
    expect(prependIntelligentAttendantSignature(signed, 'Suporte IA')).toBe(signed);
  });
});
