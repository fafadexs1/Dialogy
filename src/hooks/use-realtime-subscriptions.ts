'use client';

import { createClient } from '@/lib/supabase/client';
import {
    buildChatMessageChannelName,
    buildWorkspaceChatChannelName,
    buildWorkspaceContactChannelName,
    buildWorkspaceMessageChannelName,
    subscribeToChatMessages,
    subscribeToWorkspaceContacts,
    subscribeToWorkspaceChatUpdates,
    subscribeToWorkspaceMessages,
    teardownChannel,
} from '@/lib/realtime/chat-subscriptions';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { getWorkspaceMessageDisposition } from '@/lib/realtime/realtime-reconciler';
import {
    applyRealtimeChannelStatus,
    hasHealthyMessageCoverage,
    INITIAL_REALTIME_CHANNEL_HEALTH,
    type RealtimeChannelKind,
} from '@/lib/realtime/channel-health';

function csvToSet(csv?: string): Set<string> | null {
    if (typeof csv !== 'string') return null;
    const normalized = csv
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    return new Set(normalized);
}

// Singleton state for Realtime channels (shared across all components)
const globalChannels: {
    chats: RealtimeChannel | null;
    messages: RealtimeChannel | null;
    messagesList: RealtimeChannel | null;
    contacts: RealtimeChannel | null;
    chatsWorkspaceId: string | null;
    messagesChatId: string | null;
    messagesListWorkspaceId: string | null;
    contactsWorkspaceId: string | null;
    chatsSubscribers: number;
    messagesSubscribers: number;
    messagesListSubscribers: number;
    contactsSubscribers: number;
} = {
    chats: null,
    messages: null,
    messagesList: null,
    contacts: null,
    chatsWorkspaceId: null,
    messagesChatId: null,
    messagesListWorkspaceId: null,
    contactsWorkspaceId: null,
    chatsSubscribers: 0,
    messagesSubscribers: 0,
    messagesListSubscribers: 0,
    contactsSubscribers: 0,
};

// Global event handlers that components can subscribe to
const chatHandlers = new Set<(payload: RealtimePostgresChangesPayload<any>) => void>();
const messageThreadHandlers = new Set<(payload: RealtimePostgresChangesPayload<any>) => void>();
const messageListHandlers = new Set<(payload: RealtimePostgresChangesPayload<any>) => void>();
const contactHandlers = new Set<(payload: RealtimePostgresChangesPayload<any>) => void>();
const statusHandlers = new Set<(status: string, type: 'chats' | 'messages') => void>();
const healthHandlers = new Set<() => void>();
let globalChannelHealth = INITIAL_REALTIME_CHANNEL_HEALTH;

function updateGlobalChannelHealth(channel: RealtimeChannelKind, status: string) {
    const next = applyRealtimeChannelStatus(globalChannelHealth, channel, status);
    if (next === globalChannelHealth) return;
    globalChannelHealth = next;
    healthHandlers.forEach((handler) => handler());
}

export function useRealtimeSubscriptions(options: {
    workspaceId: string | null | undefined;
    selectedChatId: string | null | undefined;
    chatUpdatesChatIdsCsv?: string;
    messagesListChatIdsCsv?: string;
    onChatUpdate?: (payload: RealtimePostgresChangesPayload<any>) => void;
    onMessageUpdate?: (payload: RealtimePostgresChangesPayload<any>) => void;
    onMessageOutsideList?: (payload: RealtimePostgresChangesPayload<any>) => void;
    onContactUpdate?: (payload: RealtimePostgresChangesPayload<any>) => void;
    onStatusChange?: (status: string, type: 'chats' | 'messages') => void;
}) {
    const { workspaceId, selectedChatId, messagesListChatIdsCsv, onChatUpdate, onMessageUpdate, onMessageOutsideList, onContactUpdate, onStatusChange } = options;
    const { session, isLoading } = useAuth();
    const accessToken = session?.access_token ?? null;

    const onChatUpdateRef = useRef(onChatUpdate);
    const onMessageUpdateRef = useRef(onMessageUpdate);
    const onMessageOutsideListRef = useRef(onMessageOutsideList);
    const onContactUpdateRef = useRef(onContactUpdate);
    const onStatusChangeRef = useRef(onStatusChange);
    const selectedChatIdRef = useRef<string | null>(selectedChatId ?? null);
    const messagesListChatIdsRef = useRef<Set<string> | null>(csvToSet(messagesListChatIdsCsv));
    const [, setHealthRevision] = useState(0);

    useEffect(() => {
        const handleHealthChange = () => setHealthRevision((revision) => revision + 1);
        healthHandlers.add(handleHealthChange);
        return () => {
            healthHandlers.delete(handleHealthChange);
        };
    }, []);

    // Keep refs up to date
    useEffect(() => {
        onChatUpdateRef.current = onChatUpdate;
        onMessageUpdateRef.current = onMessageUpdate;
        onMessageOutsideListRef.current = onMessageOutsideList;
        onContactUpdateRef.current = onContactUpdate;
        onStatusChangeRef.current = onStatusChange;
    }, [onChatUpdate, onMessageUpdate, onMessageOutsideList, onContactUpdate, onStatusChange]);

    useEffect(() => {
        selectedChatIdRef.current = selectedChatId ?? null;
    }, [selectedChatId]);

    useEffect(() => {
        messagesListChatIdsRef.current = csvToSet(messagesListChatIdsCsv);
    }, [messagesListChatIdsCsv]);

    // Wrapper handlers
    const chatHandler = useCallback((payload: RealtimePostgresChangesPayload<any>) => {
        onChatUpdateRef.current?.(payload);
    }, []);

    const messageThreadHandler = useCallback((payload: RealtimePostgresChangesPayload<any>) => {
        onMessageUpdateRef.current?.(payload);
    }, []);

    const messageListHandler = useCallback((payload: RealtimePostgresChangesPayload<any>) => {
        const disposition = getWorkspaceMessageDisposition(
            payload,
            messagesListChatIdsRef.current,
            selectedChatIdRef.current,
        );

        if (disposition === 'ignore-selected') {
            return;
        }

        if (disposition === 'reconcile-list') {
            onMessageOutsideListRef.current?.(payload);
            return;
        }

        onMessageUpdateRef.current?.(payload);
    }, []);

    const contactHandler = useCallback((payload: RealtimePostgresChangesPayload<any>) => {
        onContactUpdateRef.current?.(payload);
    }, []);

    const statusHandler = useCallback((status: string, type: 'chats' | 'messages') => {
        onStatusChangeRef.current?.(status, type);
    }, []);

    // Subscribe to chats channel
    useEffect(() => {
        if (!workspaceId || isLoading || !accessToken) return;

        const supabase = createClient();
        supabase.realtime.setAuth(accessToken);

        // Register this component's handler
        if (onChatUpdateRef.current) {
            chatHandlers.add(chatHandler);
        }
        if (onStatusChangeRef.current) {
            statusHandlers.add(statusHandler);
        }

        const handleChatStatusChange = (status: string) => {
            console.info(`[REALTIME-GLOBAL] Chats channel status: ${status}`);
            updateGlobalChannelHealth('chats', status);
            statusHandlers.forEach((handler) => handler(status, 'chats'));
        };

        if (globalChannels.chatsWorkspaceId !== workspaceId || !globalChannels.chats) {
            if (globalChannels.chats) {
                console.info('[REALTIME-GLOBAL] Switching chats workspace, cleaning up old channel');
                teardownChannel(supabase, globalChannels.chats);
            }

            const channelName = buildWorkspaceChatChannelName(workspaceId);
            console.info(`[REALTIME-GLOBAL] Creating chats channel ${channelName}`);
            updateGlobalChannelHealth('chats', 'CONNECTING');

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
                updateGlobalChannelHealth('chats', 'CLOSED');
            }
        };
    }, [workspaceId, isLoading, accessToken, chatHandler, statusHandler]);

    // Subscribe to contacts channel
    useEffect(() => {
        if (!workspaceId || isLoading || !accessToken) return;

        const supabase = createClient();
        supabase.realtime.setAuth(accessToken);

        if (onContactUpdateRef.current) {
            contactHandlers.add(contactHandler);
        }

        const handleContactStatusChange = (status: string) => {
            console.info(`[REALTIME-GLOBAL] Contacts channel status: ${status}`);
        };

        if (globalChannels.contactsWorkspaceId !== workspaceId || !globalChannels.contacts) {
            if (globalChannels.contacts) {
                console.info('[REALTIME-GLOBAL] Switching workspace, cleaning up old contacts channel');
                teardownChannel(supabase, globalChannels.contacts);
            }

            const channelName = buildWorkspaceContactChannelName(workspaceId);
            console.info(`[REALTIME-GLOBAL] Creating contacts channel ${channelName}`);

            globalChannels.contacts = subscribeToWorkspaceContacts({
                client: supabase,
                workspaceId,
                onContactUpdate: (payload) => {
                    contactHandlers.forEach((handler) => handler(payload));
                },
                onStatusChange: handleContactStatusChange,
            });

            globalChannels.contactsWorkspaceId = workspaceId;
        }

        globalChannels.contactsSubscribers++;
        console.info(`[REALTIME-GLOBAL] Contacts channel subscribers: ${globalChannels.contactsSubscribers}`);

        return () => {
            contactHandlers.delete(contactHandler);
            globalChannels.contactsSubscribers--;
            console.info(`[REALTIME-GLOBAL] Contacts channel subscribers after cleanup: ${globalChannels.contactsSubscribers}`);

            if (globalChannels.contactsSubscribers <= 0 && globalChannels.contacts) {
                console.info('[REALTIME-GLOBAL] No more contacts subscribers, tearing down channel');
                teardownChannel(supabase, globalChannels.contacts);
                globalChannels.contacts = null;
                globalChannels.contactsWorkspaceId = null;
                globalChannels.contactsSubscribers = 0;
            }
        };
    }, [workspaceId, isLoading, accessToken, contactHandler]);

    // Subscribe to messages channel (Global for workspace)
    useEffect(() => {
        if (!workspaceId || isLoading || !accessToken) return;

        const supabase = createClient();
        supabase.realtime.setAuth(accessToken);

        // Register this component's handler
        if (onMessageUpdateRef.current) {
            messageThreadHandlers.add(messageThreadHandler);
        }

        const handleMessageStatusChange = (status: string) => {
            console.info(`[REALTIME-GLOBAL] Messages channel status: ${status}`);
            updateGlobalChannelHealth('messages', status);
            statusHandlers.forEach((handler) => handler(status, 'messages'));
        };

        const targetFilter = selectedChatId;

        // Check if we need to switch channels (Initial load OR Filter changed)
        // We use messagesChatId to store the current filter (chatId)
        if (targetFilter && (globalChannels.messagesChatId !== targetFilter || !globalChannels.messages)) {

            // Cleanup old channel if it exists
            if (globalChannels.messages) {
                console.info(`[REALTIME-GLOBAL] Switching messages channel from ${globalChannels.messagesChatId} to ${targetFilter}`);
                teardownChannel(supabase, globalChannels.messages);
                globalChannels.messages = null;
            }

            const channelName = targetFilter === 'all'
                ? buildWorkspaceMessageChannelName(workspaceId)
                : buildChatMessageChannelName(workspaceId, targetFilter);
            console.info(`[REALTIME-GLOBAL] Creating messages channel ${channelName} (Filter: ${targetFilter})`);
            updateGlobalChannelHealth('messages', 'CONNECTING');

            globalChannels.messages = subscribeToChatMessages({
                client: supabase,
                workspaceId,
                chatId: targetFilter,
                onMessage: (payload) => {
                    // console.log('[REALTIME-GLOBAL] Message received:', payload);
                    messageThreadHandlers.forEach((handler) => handler(payload));
                },
                onStatusChange: handleMessageStatusChange,
            });

            globalChannels.messagesChatId = targetFilter;
        } else if (!targetFilter && globalChannels.messages) {
            // If no chat selected but we have a channel, tear it down (e.g. went back to list)
            console.info('[REALTIME-GLOBAL] No chat selected, tearing down active messages channel');
            teardownChannel(supabase, globalChannels.messages);
            globalChannels.messages = null;
            globalChannels.messagesChatId = null;
            updateGlobalChannelHealth('messages', 'CLOSED');
        }

        globalChannels.messagesSubscribers++;
        console.info(`[REALTIME-GLOBAL] Messages channel subscribers: ${globalChannels.messagesSubscribers}`);

        return () => {
            messageThreadHandlers.delete(messageThreadHandler);
            globalChannels.messagesSubscribers--;
            console.info(`[REALTIME-GLOBAL] Messages channel subscribers after cleanup: ${globalChannels.messagesSubscribers}`);

            // Only teardown channel if no more subscribers
            if (globalChannels.messagesSubscribers <= 0 && globalChannels.messages) {
                console.info('[REALTIME-GLOBAL] No more messages subscribers, tearing down channel');
                teardownChannel(supabase, globalChannels.messages);
                globalChannels.messages = null;
                globalChannels.messagesChatId = null;
                globalChannels.messagesSubscribers = 0;
                updateGlobalChannelHealth('messages', 'CLOSED');
            }
        };
    }, [workspaceId, isLoading, accessToken, selectedChatId, messageThreadHandler]);

    // Subscribe to messages channel for list updates (other chats)
    useEffect(() => {
        if (!workspaceId || isLoading || !accessToken) return;

        const supabase = createClient();
        supabase.realtime.setAuth(accessToken);

        if (onMessageUpdateRef.current) {
            messageListHandlers.add(messageListHandler);
        }

        const handleListMessageStatusChange = (status: string) => {
            console.info(`[REALTIME-GLOBAL] Messages list channel status: ${status}`);
            updateGlobalChannelHealth('messagesList', status);
            statusHandlers.forEach((handler) => handler(status, 'messages'));
        };

        if (globalChannels.messagesListWorkspaceId !== workspaceId || !globalChannels.messagesList) {
            if (globalChannels.messagesList) {
                console.info('[REALTIME-GLOBAL] Switching messages list workspace, cleaning up old channel');
                teardownChannel(supabase, globalChannels.messagesList);
            }

            const channelName = buildWorkspaceMessageChannelName(workspaceId);
            console.info(`[REALTIME-GLOBAL] Creating messages list channel ${channelName}`);
            updateGlobalChannelHealth('messagesList', 'CONNECTING');

            globalChannels.messagesList = subscribeToWorkspaceMessages({
                client: supabase,
                workspaceId,
                onMessage: (payload) => {
                    messageListHandlers.forEach((handler) => handler(payload));
                },
                onStatusChange: handleListMessageStatusChange,
            });

            globalChannels.messagesListWorkspaceId = workspaceId;
        }

        globalChannels.messagesListSubscribers++;
        console.info(`[REALTIME-GLOBAL] Messages list channel subscribers: ${globalChannels.messagesListSubscribers}`);

        return () => {
            messageListHandlers.delete(messageListHandler);
            globalChannels.messagesListSubscribers--;
            console.info(`[REALTIME-GLOBAL] Messages list channel subscribers after cleanup: ${globalChannels.messagesListSubscribers}`);

            if (globalChannels.messagesListSubscribers <= 0 && globalChannels.messagesList) {
                console.info('[REALTIME-GLOBAL] No more messages list subscribers, tearing down channel');
                teardownChannel(supabase, globalChannels.messagesList);
                globalChannels.messagesList = null;
                globalChannels.messagesListWorkspaceId = null;
                globalChannels.messagesListSubscribers = 0;
                updateGlobalChannelHealth('messagesList', 'CLOSED');
            }
        };
    }, [workspaceId, isLoading, accessToken, messageListHandler]);

    return {
        isChatsConnected: globalChannelHealth.chats,
        isMessagesConnected: hasHealthyMessageCoverage(globalChannelHealth, Boolean(selectedChatId)),
    };
}
