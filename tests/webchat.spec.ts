import { describe, expect, it } from 'vitest';

import { resolveChatPlatform, getChatPlatformLabel } from '@/lib/chat-platform';
import { isWebchatOriginAllowed, normalizeWebchatOrigin } from '@/services/webchat/origin';
import { createWebchatSessionToken, safeTokenHashEqual } from '@/services/webchat/session-token';

describe('webchat origin policy', () => {
  it('normalizes origins and accepts exact domains', () => {
    expect(normalizeWebchatOrigin('https://Example.com/path')).toBe('https://example.com');
    expect(isWebchatOriginAllowed('https://example.com', ['example.com'])).toBe(true);
    expect(isWebchatOriginAllowed('https://evil.example', ['example.com'])).toBe(false);
  });

  it('supports explicit wildcard subdomains', () => {
    expect(isWebchatOriginAllowed('https://loja.example.com', ['*.example.com'])).toBe(true);
    expect(isWebchatOriginAllowed('https://example.com', ['*.example.com'])).toBe(false);
  });
});

describe('webchat sessions', () => {
  it('uses opaque tokens that can be compared without storing the secret', () => {
    const session = createWebchatSessionToken();
    expect(session.token).not.toBe(session.hash);
    expect(safeTokenHashEqual(session.token, session.hash)).toBe(true);
    expect(safeTokenHashEqual(`${session.token}x`, session.hash)).toBe(false);
  });
});

describe('webchat inbox channel', () => {
  it('is resolved from normalized message source', () => {
    const platform = resolveChatPlatform({
      id: 'chat-1', workspace_id: 'workspace-1', status: 'gerais',
      contact: { id: 'contact-1', workspace_id: 'workspace-1', name: 'Visitante', email: 'visitante@example.com' } as any,
      messages: [{ id: 'message-1', workspace_id: 'workspace-1', chat_id: 'chat-1', content: 'Oi', type: 'text', status: 'default', transcription: null, timestamp: '', createdAt: '', formattedDate: '', source_from_api: 'webchat' }],
    });
    expect(platform).toBe('webchat');
    expect(getChatPlatformLabel(platform)).toBe('Chat do site');
  });
});
