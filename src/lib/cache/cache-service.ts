import { cacheDb } from './cache-db';
import type { Chat, Message, Contact } from '@/lib/types';
import { parseCachedChat, parseCachedMessage, parseCachedContact } from './cache-types';

class CacheService {
    // ================== CHATS ==================

    async getChats(workspaceId: string): Promise<Chat[]> {
        try {
            const cached = await cacheDb.chats
                .where('workspaceId')
                .equals(workspaceId)
                .sortBy('updatedAt');

            return cached
                .map((c) => parseCachedChat(c.data))
                .filter((c): c is Chat => c !== null)
                .reverse(); // Most recent first
        } catch (error) {
            console.error('[CacheService] getChats error:', error);
            return [];
        }
    }

    async setChats(workspaceId: string, chats: Chat[]): Promise<void> {
        try {
            const now = new Date().toISOString();
            const cachedChats = chats.map((chat) => ({
                id: chat.id,
                workspaceId,
                updatedAt: chat.updatedAt || now,
                data: JSON.stringify(chat),
            }));

            await cacheDb.chats.bulkPut(cachedChats);
        } catch (error) {
            console.error('[CacheService] setChats error:', error);
        }
    }

    async upsertChat(workspaceId: string, chat: Chat): Promise<void> {
        try {
            await cacheDb.chats.put({
                id: chat.id,
                workspaceId,
                updatedAt: chat.updatedAt || new Date().toISOString(),
                data: JSON.stringify(chat),
            });
        } catch (error) {
            console.error('[CacheService] upsertChat error:', error);
        }
    }

    // ================== MESSAGES ==================

    async getMessages(chatId: string, workspaceId: string): Promise<Message[]> {
        try {
            const cached = await cacheDb.messages
                .where('[workspaceId+chatId]')
                .equals([workspaceId, chatId])
                .sortBy('createdAt');

            return cached
                .map((m) => parseCachedMessage(m.data))
                .filter((m): m is Message => m !== null);
        } catch (error) {
            console.error('[CacheService] getMessages error:', error);
            return [];
        }
    }

    async setMessages(chatId: string, workspaceId: string, messages: Message[]): Promise<void> {
        try {
            const cachedMessages = messages.map((msg) => ({
                id: msg.id,
                chatId,
                workspaceId,
                createdAt: msg.createdAt,
                data: JSON.stringify(msg),
            }));

            await cacheDb.messages.bulkPut(cachedMessages);
        } catch (error) {
            console.error('[CacheService] setMessages error:', error);
        }
    }

    async appendMessages(chatId: string, workspaceId: string, messages: Message[]): Promise<void> {
        // Same as setMessages but semantically different
        await this.setMessages(chatId, workspaceId, messages);
    }

    // ================== CONTACTS ==================

    async getContacts(workspaceId: string): Promise<Contact[]> {
        try {
            const cached = await cacheDb.contacts
                .where('workspaceId')
                .equals(workspaceId)
                .toArray();

            return cached
                .map((c) => parseCachedContact(c.data))
                .filter((c): c is Contact => c !== null);
        } catch (error) {
            console.error('[CacheService] getContacts error:', error);
            return [];
        }
    }

    async setContacts(workspaceId: string, contacts: Contact[]): Promise<void> {
        try {
            const cachedContacts = contacts.map((contact) => ({
                id: contact.id,
                workspaceId,
                data: JSON.stringify(contact),
            }));

            await cacheDb.contacts.bulkPut(cachedContacts);
        } catch (error) {
            console.error('[CacheService] setContacts error:', error);
        }
    }

    async upsertContact(workspaceId: string, contact: Contact): Promise<void> {
        try {
            await cacheDb.contacts.put({
                id: contact.id,
                workspaceId,
                data: JSON.stringify(contact),
            });
        } catch (error) {
            console.error('[CacheService] upsertContact error:', error);
        }
    }

    // ================== DRAFTS ==================

    async getDraft(chatId: string): Promise<string | null> {
        try {
            const draft = await cacheDb.drafts.get(chatId);
            return draft?.content ?? null;
        } catch (error) {
            console.error('[CacheService] getDraft error:', error);
            return null;
        }
    }

    async setDraft(chatId: string, content: string): Promise<void> {
        try {
            await cacheDb.drafts.put({
                chatId,
                content,
                updatedAt: new Date().toISOString(),
            });
        } catch (error) {
            console.error('[CacheService] setDraft error:', error);
        }
    }

    async clearDraft(chatId: string): Promise<void> {
        try {
            await cacheDb.drafts.delete(chatId);
        } catch (error) {
            console.error('[CacheService] clearDraft error:', error);
        }
    }

    // ================== META (Per Workspace) ==================

    async getLastSyncTime(workspaceId: string, type: 'chats' | 'messages'): Promise<string | null> {
        try {
            const key = `lastSync${type.charAt(0).toUpperCase() + type.slice(1)}:${workspaceId}`;
            const meta = await cacheDb.meta.get(key);
            return meta?.value ?? null;
        } catch (error) {
            console.error('[CacheService] getLastSyncTime error:', error);
            return null;
        }
    }

    async setLastSyncTime(workspaceId: string, type: 'chats' | 'messages', timestamp: string): Promise<void> {
        try {
            const key = `lastSync${type.charAt(0).toUpperCase() + type.slice(1)}:${workspaceId}`;
            await cacheDb.meta.put({ key, value: timestamp });
        } catch (error) {
            console.error('[CacheService] setLastSyncTime error:', error);
        }
    }

    // ================== CLEANUP ==================

    async clearOldMessages(cutoffDate: Date): Promise<number> {
        try {
            const cutoffStr = cutoffDate.toISOString();
            const oldMessages = await cacheDb.messages
                .where('createdAt')
                .below(cutoffStr)
                .toArray();

            const idsToDelete = oldMessages.map((m) => m.id);
            await cacheDb.messages.bulkDelete(idsToDelete);

            console.log(`[CacheService] Cleared ${idsToDelete.length} old messages`);
            return idsToDelete.length;
        } catch (error) {
            console.error('[CacheService] clearOldMessages error:', error);
            return 0;
        }
    }

    /**
     * Remove chats antigos do cache. Sem isso a tabela `chats` só crescia: a
     * limpeza periódica cobria apenas mensagens, então o IndexedDB acumulava
     * todo chat já visto — e `getChats` reidratava tudo isso no boot.
     */
    async clearOldChats(cutoffDate: Date): Promise<number> {
        try {
            const cutoffStr = cutoffDate.toISOString();
            const staleChatIds = await cacheDb.chats
                .where('updatedAt')
                .below(cutoffStr)
                .primaryKeys();

            await cacheDb.chats.bulkDelete(staleChatIds);

            console.log(`[CacheService] Cleared ${staleChatIds.length} old chats`);
            return staleChatIds.length;
        } catch (error) {
            console.error('[CacheService] clearOldChats error:', error);
            return 0;
        }
    }

    async clearWorkspace(workspaceId: string): Promise<void> {
        try {
            // Clear all data for a specific workspace
            await Promise.all([
                cacheDb.chats.where('workspaceId').equals(workspaceId).delete(),
                cacheDb.messages.where('workspaceId').equals(workspaceId).delete(),
                cacheDb.contacts.where('workspaceId').equals(workspaceId).delete(),
                cacheDb.meta.where('key').startsWith(`lastSyncChats:${workspaceId}`).delete(),
                cacheDb.meta.where('key').startsWith(`lastSyncMessages:${workspaceId}`).delete(),
            ]);

            console.log(`[CacheService] Cleared workspace ${workspaceId}`);
        } catch (error) {
            console.error('[CacheService] clearWorkspace error:', error);
        }
    }

    async clearAll(): Promise<void> {
        try {
            await Promise.all([
                cacheDb.chats.clear(),
                cacheDb.messages.clear(),
                cacheDb.contacts.clear(),
                cacheDb.drafts.clear(),
                cacheDb.meta.clear(),
            ]);
            console.log('[CacheService] Cleared all cache');
        } catch (error) {
            console.error('[CacheService] clearAll error:', error);
        }
    }
}

// Singleton export
export const cacheService = new CacheService();
