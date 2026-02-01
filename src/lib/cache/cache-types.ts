import type { Chat, Message, Contact } from '@/lib/types';

// Re-export database types
export type { CachedChat, CachedMessage, CachedContact, CachedDraft, CacheMeta } from './cache-db';

export type CacheMetaKey =
    | `lastSyncChats:${string}`
    | `lastSyncMessages:${string}`
    | `cacheVersion`;

export type CacheOperationResult<T> = {
    success: boolean;
    data?: T;
    error?: string;
};

// Type guards for cache data parsing
export function parseCachedChat(data: string): Chat | null {
    try {
        return JSON.parse(data) as Chat;
    } catch {
        return null;
    }
}

export function parseCachedMessage(data: string): Message | null {
    try {
        return JSON.parse(data) as Message;
    } catch {
        return null;
    }
}

export function parseCachedContact(data: string): Contact | null {
    try {
        return JSON.parse(data) as Contact;
    } catch {
        return null;
    }
}
