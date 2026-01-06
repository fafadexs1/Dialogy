'use client';

import { createClient } from '@/lib/supabase/client';
import {
    buildChatMessageChannelName,
    buildWorkspaceChatChannelName,
    subscribeToChatMessages,
    subscribeToWorkspaceChatUpdates,
    teardownChannel,
} from '@/lib/realtime/chat-subscriptions';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef } from 'react';

// Singleton state for Realtime channels (shared across all components)
const globalChannels: {
    chats: RealtimeChannel | null;
    messages: RealtimeChannel | null;
    chatsWorkspaceId: string | null;
    messagesChatId: string | null;
    chatsSubscribers: number;
    messagesSubscribers: number;
} = {
    chats: null,
    messages: null,
    chatsWorkspaceId: null,
    messagesChatId: null,
    chatsSubscribers: 0,
    messagesSubscribers: 0,
};

// Global event handlers that components can subscribe to
const chatHandlers = new Set<(payload: RealtimePostgresChangesPayload<any>) => void>();
const messageHandlers = new Set<(payload: RealtimePostgresChangesPayload<any>) => void>();
const statusHandlers = new Set<(status: string, type: 'chats' | 'messages') => void>();

export function useRealtimeSubscriptions(options: {
    workspaceId: string | null | undefined;
    selectedChatId: string | null | undefined;
    onChatUpdate?: (payload: RealtimePostgresChangesPayload<any>) => void;
    onMessageUpdate?: (payload: RealtimePostgresChangesPayload<any>) => void;
    onStatusChange?: (status: string, type: 'chats' | 'messages') => void;
}) {
    const { workspaceId, selectedChatId, onChatUpdate, onMessageUpdate, onStatusChange } = options;

    const onChatUpdateRef = useRef(onChatUpdate);
    const onMessageUpdateRef = useRef(onMessageUpdate);
    const onStatusChangeRef = useRef(onStatusChange);

    // Keep refs up to date
    useEffect(() => {
        onChatUpdateRef.current = onChatUpdate;
        onMessageUpdateRef.current = onMessageUpdate;
        onStatusChangeRef.current = onStatusChange;
    }, [onChatUpdate, onMessageUpdate, onStatusChange]);

    // Wrapper handlers
    const chatHandler = useCallback((payload: RealtimePostgresChangesPayload<any>) => {
        onChatUpdateRef.current?.(payload);
    }, []);

    const messageHandler = useCallback((payload: RealtimePostgresChangesPayload<any>) => {
        onMessageUpdateRef.current?.(payload);
    }, []);

    const statusHandler = useCallback((status: string, type: 'chats' | 'messages') => {
        onStatusChangeRef.current?.(status, type);
    }, []);

    // Subscribe to chats channel
    useEffect(() => {
        if (!workspaceId) return;

        const supabase = createClient();

        // Register this component's handler
        if (onChatUpdateRef.current) {
            chatHandlers.add(chatHandler);
        }
        if (onStatusChangeRef.current) {
            statusHandlers.add(statusHandler);
        }

        const handleChatStatusChange = (status: string) => {
            console.info(`[REALTIME-GLOBAL] Chats channel status: ${status}`);
            statusHandlers.forEach((handler) => handler(status, 'chats'));
        };

        // Only create channel if it doesn't exist or workspace changed
        if (globalChannels.chatsWorkspaceId !== workspaceId || !globalChannels.chats) {
            // Cleanup old channel if workspace changed
            if (globalChannels.chats) {
                console.info('[REALTIME-GLOBAL] Switching workspace, cleaning up old chats channel');
                teardownChannel(supabase, globalChannels.chats);
            }

            const channelName = buildWorkspaceChatChannelName(workspaceId);
            console.info(`[REALTIME-GLOBAL] Creating chats channel ${channelName}`);

            globalChannels.chats = subscribeToWorkspaceChatUpdates({
                client: supabase,
                workspaceId,
                onChatUpdate: (payload) => {
                    console.log('[REALTIME-GLOBAL] Chat update received:', payload);
                    chatHandlers.forEach((handler) => handler(payload));
                },
                onStatusChange: handleChatStatusChange,
            });

            globalChannels.chatsWorkspaceId = workspaceId;
        }

        globalChannels.chatsSubscribers++;
        console.info(`[REALTIME-GLOBAL] Chats channel subscribers: ${globalChannels.chatsSubscribers}`);

        return () => {
            chatHandlers.delete(chatHandler);
            statusHandlers.delete(statusHandler);
            globalChannels.chatsSubscribers--;
            console.info(`[REALTIME-GLOBAL] Chats channel subscribers after cleanup: ${globalChannels.chatsSubscribers}`);

            // Only teardown channel if no more subscribers
            if (globalChannels.chatsSubscribers <= 0 && globalChannels.chats) {
                console.info('[REALTIME-GLOBAL] No more chats subscribers, tearing down channel');
                teardownChannel(supabase, globalChannels.chats);
                globalChannels.chats = null;
                globalChannels.chatsWorkspaceId = null;
                globalChannels.chatsSubscribers = 0;
            }
        };
    }, [workspaceId, chatHandler, statusHandler]);

    // Subscribe to messages channel (Global for workspace)
    useEffect(() => {
        if (!workspaceId) return;

        const supabase = createClient();

        // Register this component's handler
        if (onMessageUpdateRef.current) {
            messageHandlers.add(messageHandler);
        }

        const handleMessageStatusChange = (status: string) => {
            console.info(`[REALTIME-GLOBAL] Messages channel status: ${status}`);
            statusHandlers.forEach((handler) => handler(status, 'messages'));
        };

        const targetFilter = selectedChatId || 'all';

        // Check if we need to switch channels (Initial load OR Filter changed)
        // We use messagesChatId to store the current filter (chatId or 'all')
        if (globalChannels.messagesChatId !== targetFilter || !globalChannels.messages) {

            // Cleanup old channel if it exists
            if (globalChannels.messages) {
                console.info(`[REALTIME-GLOBAL] Switching messages channel from ${globalChannels.messagesChatId} to ${targetFilter}`);
                teardownChannel(supabase, globalChannels.messages);
                globalChannels.messages = null;
            }

            const channelName = buildChatMessageChannelName(workspaceId, targetFilter);
            console.info(`[REALTIME-GLOBAL] Creating messages channel ${channelName} (Filter: ${targetFilter})`);

            globalChannels.messages = subscribeToChatMessages({
                client: supabase,
                workspaceId,
                chatId: targetFilter,
                onMessage: (payload) => {
                    // console.log('[REALTIME-GLOBAL] Message received:', payload);
                    messageHandlers.forEach((handler) => handler(payload));
                },
                onStatusChange: handleMessageStatusChange,
            });

            globalChannels.messagesChatId = targetFilter;
        }

        globalChannels.messagesSubscribers++;
        console.info(`[REALTIME-GLOBAL] Messages channel subscribers: ${globalChannels.messagesSubscribers}`);

        return () => {
            messageHandlers.delete(messageHandler);
            globalChannels.messagesSubscribers--;
            console.info(`[REALTIME-GLOBAL] Messages channel subscribers after cleanup: ${globalChannels.messagesSubscribers}`);

            // Only teardown channel if no more subscribers
            if (globalChannels.messagesSubscribers <= 0 && globalChannels.messages) {
                console.info('[REALTIME-GLOBAL] No more messages subscribers, tearing down channel');
                teardownChannel(supabase, globalChannels.messages);
                globalChannels.messages = null;
                globalChannels.messagesChatId = null;
                globalChannels.messagesSubscribers = 0;
            }
        };
    }, [workspaceId, selectedChatId, messageHandler]);

    return {
        isChatsConnected: globalChannels.chats !== null,
        isMessagesConnected: globalChannels.messages !== null,
    };
}
