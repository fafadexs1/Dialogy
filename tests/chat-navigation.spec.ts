import { afterEach, describe, expect, it, vi } from 'vitest';

import { replaceChatPath, resolveHydratedChatSelection } from '@/lib/chat-navigation';

const originalWindow = globalThis.window;

function mockWindow(pathname: string, search = '', hash = '') {
  const prototypeReplaceState = vi.fn();
  const history = Object.create({ replaceState: prototypeReplaceState });
  const integratedReplaceState = vi.fn();
  history.replaceState = integratedReplaceState;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { pathname, search, hash },
      history,
    },
  });

  return { integratedReplaceState, prototypeReplaceState };
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('replaceChatPath', () => {
  it('uses the history method integrated by Next.js instead of bypassing it', () => {
    const { integratedReplaceState, prototypeReplaceState } = mockWindow(
      '/inbox/chat-antigo',
      '?filtro=meus',
      '#mensagens',
    );

    replaceChatPath('chat-novo');

    expect(integratedReplaceState).toHaveBeenCalledWith(
      null,
      '',
      '/inbox/chat-novo?filtro=meus#mensagens',
    );
    expect(prototypeReplaceState).not.toHaveBeenCalled();
  });

  it('clears the chat id without touching query string or hash', () => {
    const { integratedReplaceState } = mockWindow(
      '/inbox/chat-antigo',
      '?filtro=todos',
      '#lista',
    );

    replaceChatPath(null);

    expect(integratedReplaceState).toHaveBeenCalledWith(
      null,
      '',
      '/inbox?filtro=todos#lista',
    );
  });

  it('does not write the same chat path twice', () => {
    const { integratedReplaceState } = mockWindow('/inbox/chat-atual');

    replaceChatPath('chat-atual');

    expect(integratedReplaceState).not.toHaveBeenCalled();
  });
});

describe('resolveHydratedChatSelection', () => {
  it('keeps a newer user selection when stale server data arrives', () => {
    expect(resolveHydratedChatSelection('chat-antigo', 'chat-novo', true))
      .toBe('chat-novo');
  });

  it('keeps an explicit user clear when stale server data still has a chat id', () => {
    expect(resolveHydratedChatSelection('chat-antigo', null, true)).toBeNull();
  });

  it('uses the server selection during the initial hydration', () => {
    expect(resolveHydratedChatSelection('chat-inicial', 'chat-em-cache', false))
      .toBe('chat-inicial');
  });
});
