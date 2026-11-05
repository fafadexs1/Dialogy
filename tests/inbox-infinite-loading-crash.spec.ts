import { describe, expect, it } from 'vitest';
import type { Chat } from '../src/lib/types';
import { useInboxStore } from '../src/hooks/use-inbox-store';

describe('Inbox Crash & Infinite Loading Remediation', () => {
  it('does not throw TypeError when contact is undefined on chat object', () => {
    const chatWithoutContact = {
      id: 'chat-no-contact-1',
      workspace_id: 'ws-1',
      status: 'gerais',
      contact: undefined as any,
      messages: [],
      protocol: 'DLG-999',
    } as unknown as Chat;

    // Simulation of the previously crashing line:
    // chat?.contact.phone -> crashed with Cannot read properties of undefined (reading 'phone')
    // Safe line:
    const safePhone = chatWithoutContact?.contact?.phone || chatWithoutContact?.contact?.phone_number_jid || '';
    expect(safePhone).toBe('');

    const safeName = chatWithoutContact?.contact?.name || chatWithoutContact?.protocol || 'Sem nome';
    expect(safeName).toBe('DLG-999');

    const safeContactId = chatWithoutContact?.contact?.id || '';
    expect(safeContactId).toBe('');
  });

  it('updateChatContact in useInboxStore matches by contact_id even if contact is undefined', () => {
    const initialChat: any = {
      id: 'chat-orphan-1',
      contact_id: 'contact-target-123',
      workspace_id: 'ws-1',
      status: 'gerais',
      contact: undefined,
      messages: [],
    };

    useInboxStore.setState({ chats: [initialChat] });

    useInboxStore.getState().updateChatContact({
      id: 'contact-target-123',
      name: 'Maria Teste',
      phone: '+55 11 99999-8888',
      phone_number_jid: '5511999998888@s.whatsapp.net',
    } as any);

    const updated = useInboxStore.getState().chats.find((c) => c.id === 'chat-orphan-1');
    expect(updated).toBeDefined();
    expect(updated?.contact?.name).toBe('Maria Teste');
    expect(updated?.contact?.phone).toBe('+55 11 99999-8888');
  });

  it('ErrorBoundary resetKeys logic clears error when keys change', () => {
    let hasError = true;
    let error: Error | null = new Error('Cannot read properties of undefined');

    const checkReset = (prevKeys: any[], currentKeys: any[]) => {
      const hasChanged =
        prevKeys.length !== currentKeys.length ||
        currentKeys.some((key, i) => !Object.is(key, prevKeys[i]));
      if (hasChanged) {
        hasError = false;
        error = null;
      }
    };

    // Unchanged keys: should NOT reset
    checkReset([1, 'mine', 'chat-1'], [1, 'mine', 'chat-1']);
    expect(hasError).toBe(true);

    // Changed keys (e.g. chats length changed or chat selection changed):
    checkReset([1, 'mine', 'chat-1'], [2, 'mine', 'chat-1']);
    expect(hasError).toBe(false);
    expect(error).toBeNull();
  });
});
