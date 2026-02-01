import Dexie, { type Table } from 'dexie';

export interface CachedChat {
    id: string;
    workspaceId: string;
    updatedAt: string;
    data: string; // JSON stringified Chat
}

export interface CachedMessage {
    id: string;
    chatId: string;
    workspaceId: string;
    createdAt: string;
    data: string; // JSON stringified Message
}

export interface CachedContact {
    id: string;
    workspaceId: string;
    data: string; // JSON stringified Contact
}

export interface CachedDraft {
    chatId: string;
    content: string;
    updatedAt: string;
}

export interface CacheMeta {
    key: string; // e.g. 'lastSyncChats:workspace-123'
    value: string;
}

class CacheDatabase extends Dexie {
    chats!: Table<CachedChat, string>;
    messages!: Table<CachedMessage, string>;
    contacts!: Table<CachedContact, string>;
    drafts!: Table<CachedDraft, string>;
    meta!: Table<CacheMeta, string>;

    constructor() {
        super('dialogy-cache');

        this.version(1).stores({
            chats: 'id, workspaceId, updatedAt, [workspaceId+updatedAt]',
            messages: 'id, chatId, workspaceId, createdAt, [workspaceId+chatId], [workspaceId+createdAt]',
            contacts: 'id, workspaceId',
            drafts: 'chatId, updatedAt',
            meta: 'key',
        });
    }
}

// Singleton instance
export const cacheDb = new CacheDatabase();
