'use client';

import { useEffect, useRef, useCallback } from 'react';
import { cacheService, scheduleCacheCleanupOnIdle } from '@/lib/cache';
import { useInboxStore } from './use-inbox-store';
import type { Chat, Message } from '@/lib/types';

interface UseCacheSyncOptions {
    workspaceId: string | undefined;
    enabled?: boolean;
}

/**
 * Hook that implements stale-while-revalidate pattern for inbox data.
 * 
 * Flow:
 * 1. On mount: Load cached data immediately (instant UI)
 * 2. In parallel: API fetches latest data
 * 3. On update: Persist to cache for next session
 */
export function useCacheSync({ workspaceId, enabled = true }: UseCacheSyncOptions) {
    const hasLoadedFromCacheRef = useRef(false);
    const currentWorkspaceRef = useRef<string | undefined>(workspaceId);

    // Load cached chats on initial mount
    const loadCachedChats = useCallback(async () => {
        if (!workspaceId || !enabled) return;

        try {
            const cachedChats = await cacheService.getChats(workspaceId);

            if (cachedChats.length > 0) {
                console.log(`[useCacheSync] Loaded ${cachedChats.length} cached chats`);

                // Only set if store is empty (don't override fresh data)
                const currentChats = useInboxStore.getState().chats;
                if (currentChats.length === 0) {
                    useInboxStore.getState().upsertChats(cachedChats);
                }
            }
        } catch (error) {
            console.error('[useCacheSync] Error loading cached chats:', error);
        }
    }, [workspaceId, enabled]);

    // Load cached messages for a specific chat
    const loadCachedMessages = useCallback(async (chatId: string): Promise<Message[]> => {
        if (!workspaceId || !enabled) return [];

        try {
            const cachedMessages = await cacheService.getMessages(chatId, workspaceId);

            if (cachedMessages.length > 0) {
                console.log(`[useCacheSync] Loaded ${cachedMessages.length} cached messages for chat ${chatId}`);
            }

            return cachedMessages;
        } catch (error) {
            console.error('[useCacheSync] Error loading cached messages:', error);
            return [];
        }
    }, [workspaceId, enabled]);

    // Persist chats to cache
    const persistChats = useCallback(async (chats: Chat[]) => {
        if (!workspaceId || !enabled || chats.length === 0) return;

        try {
            await cacheService.setChats(workspaceId, chats);
            await cacheService.setLastSyncTime(workspaceId, 'chats', new Date().toISOString());
        } catch (error) {
            console.error('[useCacheSync] Error persisting chats:', error);
        }
    }, [workspaceId, enabled]);

    // Persist messages to cache
    const persistMessages = useCallback(async (chatId: string, messages: Message[]) => {
        if (!workspaceId || !enabled || messages.length === 0) return;

        try {
            await cacheService.appendMessages(chatId, workspaceId, messages);
            await cacheService.setLastSyncTime(workspaceId, 'messages', new Date().toISOString());
        } catch (error) {
            console.error('[useCacheSync] Error persisting messages:', error);
        }
    }, [workspaceId, enabled]);

    // Get last sync time
    const getLastSyncTime = useCallback(async (type: 'chats' | 'messages'): Promise<string | null> => {
        if (!workspaceId) return null;
        return cacheService.getLastSyncTime(workspaceId, type);
    }, [workspaceId]);

    // Initial load from cache
    useEffect(() => {
        if (!workspaceId || !enabled || hasLoadedFromCacheRef.current) return;

        // Check if workspace changed
        if (currentWorkspaceRef.current !== workspaceId) {
            hasLoadedFromCacheRef.current = false;
            currentWorkspaceRef.current = workspaceId;
        }

        loadCachedChats();
        hasLoadedFromCacheRef.current = true;

        // Schedule cleanup during idle time
        scheduleCacheCleanupOnIdle();
    }, [workspaceId, enabled, loadCachedChats]);

    // Reset flag when workspace changes
    useEffect(() => {
        if (currentWorkspaceRef.current !== workspaceId) {
            hasLoadedFromCacheRef.current = false;
            currentWorkspaceRef.current = workspaceId;
        }
    }, [workspaceId]);

    return {
        loadCachedChats,
        loadCachedMessages,
        persistChats,
        persistMessages,
        getLastSyncTime,
    };
}
