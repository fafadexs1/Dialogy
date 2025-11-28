'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useInboxStore } from '@/hooks/use-inbox-store';
import { Chat, Contact, Message } from '@/lib/types';
import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { format as formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';

const SOUND_SOURCES = {
  queue: '/sounds/new-message.mp3',
  attending: '/sounds/message-incoming-02-199577.mp3',
} as const;

const FALLBACK_TIMEZONE = 'America/Sao_Paulo';

interface RealtimeProviderProps {
  workspaceId: string;
  userId: string;
  workspaceTimezone: string;
}

export function RealtimeProvider({ workspaceId, userId, workspaceTimezone }: RealtimeProviderProps) {
  const supabase = useMemo(() => createClient(), []);
  const appendMessagesToChat = useInboxStore((state) => state.appendMessagesToChat);
  const upsertChats = useInboxStore((state) => state.upsertChats);
  const updateChatContact = useInboxStore((state) => state.updateChatContact);
  const incrementUnread = useInboxStore((state) => state.incrementUnread);
  const setMessagesForChat = useInboxStore((state) => state.setMessagesForChat);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioRefs = useRef<{ queue: HTMLAudioElement | null; attending: HTMLAudioElement | null }>({ queue: null, attending: null });
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const audioUnlockRequestedRef = useRef(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [lastStatus, setLastStatus] = useState<string | null>(null);

  const parseMetadata = useCallback((metadata: any) => {
    if (!metadata) return undefined;
    if (typeof metadata === 'object') return metadata;
    try {
      return JSON.parse(metadata);
    } catch {
      return undefined;
    }
  }, []);

  const formatMessageDate = useCallback((date: Date, timezone: string) => {
    const zonedDate = toZonedTime(date, timezone);
    if (isToday(zonedDate)) return 'Hoje';
    if (isYesterday(zonedDate)) return 'Ontem';
    return formatDate(zonedDate, 'dd/MM/yyyy', { locale: ptBR });
  }, []);

  const normalizeMessage = useCallback((row: any, contact?: Contact, agent?: { id?: string; name?: string; avatar?: string | undefined; avatar_url?: string | undefined; }): Message => {
    const timezone = workspaceTimezone || FALLBACK_TIMEZONE;
    const createdAtIso = row.created_at || row.createdAt || new Date().toISOString();
    const createdAt = new Date(createdAtIso);
    const zonedDate = toZonedTime(createdAt, timezone);
    const metadata = parseMetadata(row.metadata);
    const fromMe = Boolean(row.from_me ?? row.fromMe);
    const sender = fromMe
      ? agent
        ? { id: agent.id, name: agent.name, avatar: agent.avatar || agent.avatar_url, type: 'user' as const }
        : undefined
      : contact
        ? { id: contact.id, name: contact.name, avatar: contact.avatar_url, type: 'contact' as const }
        : undefined;

    return {
      id: row.id,
      chat_id: row.chat_id,
      workspace_id: row.workspace_id,
      content: row.content ?? '',
      type: (row.type || 'text') as Message['type'],
      status: row.content === 'Mensagem apagada' || row.status === 'deleted' ? 'deleted' : 'default',
      metadata,
      transcription: row.transcription ?? null,
      timestamp: formatInTimeZone(zonedDate, 'HH:mm', { locale: ptBR, timeZone: timezone }),
      createdAt: createdAt.toISOString(),
      updatedAt: (row.updated_at ? new Date(row.updated_at).toISOString() : createdAt.toISOString()),
      formattedDate: formatMessageDate(createdAt, timezone),
      sender,
      instance_name: row.instance_name ?? undefined,
      source_from_api: row.source_from_api ?? undefined,
      message_id_from_api: row.message_id_from_api ?? undefined,
      api_message_status: row.api_message_status ?? undefined,
      from_me: fromMe,
      is_read: typeof row.is_read === 'boolean' ? row.is_read : undefined,
      sentByTab: row.sent_by_tab ?? row.sentByTab ?? undefined,
      platform: row.platform ?? undefined,
      direction: row.direction ?? undefined,
      externalMessageId: row.external_message_id ?? undefined,
      externalSenderId: row.external_sender_id ?? undefined,
      externalChannelId: row.external_channel_id ?? undefined,
      mediaUrl: row.media_url ?? metadata?.mediaUrl,
      optimistic: false,
    };
  }, [formatMessageDate, parseMetadata, workspaceTimezone]);

  const hydrateChat = useCallback(async (chatId: string): Promise<Chat | null> => {
    if (!chatId) return null;
    try {
      const { data: chatRow, error: chatError } = await supabase
        .from('chats')
        .select('id, status, workspace_id, contact_id, agent_id, assigned_at, tag, color')
        .eq('id', chatId)
        .maybeSingle();

      if (chatError || !chatRow) {
        console.warn('[Realtime] Failed to fetch chat for hydration', chatId, chatError);
        return null;
      }

      const [contactRes, agentRes, messagesRes] = await Promise.all([
        chatRow.contact_id
          ? supabase.from('contacts')
              .select('id, workspace_id, name, avatar_url, email, phone_number_jid, address')
              .eq('id', chatRow.contact_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        chatRow.agent_id
          ? supabase.from('users')
              .select('id, full_name, avatar_url')
              .eq('id', chatRow.agent_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('messages')
          .select('id, chat_id, workspace_id, content, type, metadata, transcription, created_at, updated_at, from_me, sender_user_id, sender_system_agent_id, instance_name, source_from_api, message_id_from_api, api_message_status, is_read, sent_by_tab, platform, direction, external_message_id, external_sender_id, external_channel_id, media_url')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      const contact = contactRes.data
        ? {
            id: contactRes.data.id,
            workspace_id: contactRes.data.workspace_id,
            name: contactRes.data.name || 'Contato',
            avatar_url: contactRes.data.avatar_url || undefined,
            email: contactRes.data.email || undefined,
            phone_number_jid: contactRes.data.phone_number_jid || undefined,
            address: contactRes.data.address || undefined,
          }
        : undefined;

      const agent = agentRes.data
        ? {
            id: agentRes.data.id,
            name: agentRes.data.full_name,
            avatar: agentRes.data.avatar_url || undefined,
            avatar_url: agentRes.data.avatar_url || undefined,
          }
        : undefined;

      const lastMessageRow = messagesRes.data?.[0];
      const lastMessage = lastMessageRow ? normalizeMessage(lastMessageRow, contact, agent) : undefined;

      const chat: Chat = {
        id: chatRow.id,
        status: chatRow.status,
        workspace_id: chatRow.workspace_id,
        contact: contact || {
          id: chatRow.contact_id || 'unknown-contact',
          workspace_id: chatRow.workspace_id,
          name: 'Contato',
        },
        agent: agent as any,
        messages: lastMessage ? [lastMessage] : [],
        updatedAt: lastMessage?.createdAt || chatRow.assigned_at || undefined,
        tag: chatRow.tag || undefined,
        color: chatRow.color || undefined,
      };

      return chat;
    } catch (error) {
      console.error('[Realtime] Failed to hydrate chat', chatId, error);
      return null;
    }
  }, [normalizeMessage, supabase]);

  const ensureChatInStore = useCallback(async (chatId: string): Promise<Chat | null> => {
    const existing = useInboxStore.getState().chats.find((c) => c.id === chatId);
    if (existing) return existing;
    const hydrated = await hydrateChat(chatId);
    if (hydrated) {
      upsertChats([hydrated]);
      if (hydrated.messages?.length) {
        setMessagesForChat(chatId, hydrated.messages);
      }
    }
    return hydrated;
  }, [hydrateChat, setMessagesForChat, upsertChats]);

  const unlockAudio = useCallback(async () => {
    const refs = [audioRefs.current.queue, audioRefs.current.attending];
    let unlocked = false;
    for (const audio of refs) {
      if (!audio) continue;
      try {
        audio.muted = true;
        audio.currentTime = 0;
        await audio.play();
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        unlocked = true;
      } catch (err) {
        console.warn('[REALTIME] Audio unlock failed', err);
      }
    }
    setNeedsAudioUnlock(!unlocked);
    if (unlocked) {
      console.log('[REALTIME] Audio unlocked');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleGesture = () => unlockAudio();
    window.addEventListener('pointerdown', handleGesture, { once: true });
    window.addEventListener('keydown', handleGesture, { once: true });
    window.addEventListener('touchstart', handleGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('keydown', handleGesture);
      window.removeEventListener('touchstart', handleGesture);
    };
  }, [unlockAudio]);

  const playNotificationSound = useCallback((kind: keyof typeof SOUND_SOURCES = 'queue') => {
    const readFlag = (key: string, fallback = true): boolean => {
      if (typeof localStorage === 'undefined') return fallback;
      const stored = localStorage.getItem(key);
      if (stored === null) return fallback;
      try { return JSON.parse(stored); } catch { return fallback; }
    };

    const isGlobalEnabled = readFlag('notificationSoundEnabled', true);
    const isQueueEnabled = readFlag('notificationSoundQueueEnabled', true);
    const isAttendingEnabled = readFlag('notificationSoundAttendingEnabled', true);
    const isSoundEnabled = isGlobalEnabled && (kind === 'queue' ? isQueueEnabled : isAttendingEnabled);

    if (!isSoundEnabled) return;

    const audio = audioRefs.current[kind];
    if (!audio) return;

    const tryPlay = async () => {
      audio.muted = false;
      audio.volume = 1;
      audio.currentTime = 0;
      await audio.play();
    };

    tryPlay().catch(async (e) => {
      console.error('[REALTIME] Error playing sound:', e);
      if (e?.name === 'NotAllowedError' && !audioUnlockRequestedRef.current) {
        setNeedsAudioUnlock(true);
        audioUnlockRequestedRef.current = true;
      }
    });
  }, []);

  const handleIncomingMessage = useCallback((row: any) => {
    void (async () => {
      const chat = await ensureChatInStore(row.chat_id);
      const normalizedMessage = normalizeMessage(row, chat?.contact, chat?.agent);

      appendMessagesToChat(normalizedMessage.chat_id, [normalizedMessage]);

      const { selectedChatId } = useInboxStore.getState();
      if (!normalizedMessage.from_me) {
        const isQueue = chat?.status === 'gerais' || !chat;
        const isAttending = chat?.status === 'atendimentos';
        const isOwn = isAttending && chat?.agent?.id === userId;

        if (selectedChatId !== normalizedMessage.chat_id) {
          incrementUnread(normalizedMessage.chat_id);
        }

        if (typeof document !== 'undefined' && (document.visibilityState !== 'visible' || selectedChatId !== normalizedMessage.chat_id)) {
          if (isQueue) playNotificationSound('queue');
          else if (isOwn) playNotificationSound('attending');
        }
      }
    })();
  }, [appendMessagesToChat, ensureChatInStore, incrementUnread, normalizeMessage, playNotificationSound, userId]);

  const handleUpdatedMessage = useCallback((row: any) => {
    void (async () => {
      const chat = await ensureChatInStore(row.chat_id);
      const normalized = normalizeMessage(row, chat?.contact, chat?.agent);
      appendMessagesToChat(normalized.chat_id, [normalized]);
    })();
  }, [appendMessagesToChat, ensureChatInStore, normalizeMessage]);

  // Wait for auth session before subscribing (RLS requirement)
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setSessionReady(Boolean(data.session));
      })
      .catch((err) => console.error('[Realtime] Failed to get session', err));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setSessionReady(Boolean(session));
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  // Realtime subscription
  useEffect(() => {
    if (!workspaceId || !sessionReady) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    console.log('[Realtime] Initializing subscription for workspace:', workspaceId);

    const channel = supabase.channel(`workspace_realtime:${workspaceId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages', filter: `workspace_id=eq.${workspaceId}`,
      }, (payload: RealtimePostgresChangesPayload<Message>) => {
        const row = payload.new as any;
        console.log('[Realtime] Nova mensagem recebida:', { id: row.id, chatId: row.chat_id, fromMe: row.from_me });
        handleIncomingMessage(row);
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chats', filter: `workspace_id=eq.${workspaceId}`,
      }, (payload: RealtimePostgresChangesPayload<Chat>) => {
        const insertedChat = payload.new as any;
        console.log('[Realtime] Novo chat criado:', insertedChat.id);
        void ensureChatInStore(insertedChat.id);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages', filter: `workspace_id=eq.${workspaceId}`,
      }, (payload: RealtimePostgresChangesPayload<Message>) => {
        const row = payload.new as any;
        console.log('[Realtime] Mensagem atualizada:', row.id, row.status);
        handleUpdatedMessage(row);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'chats', filter: `workspace_id=eq.${workspaceId}`,
      }, (payload: RealtimePostgresChangesPayload<Chat>) => {
        const updatedChat = payload.new as any;
        console.log('[Realtime] Chat atualizado:', updatedChat.id);
        const existing = useInboxStore.getState().chats.find((c) => c.id === updatedChat.id);
        if (!existing) {
          void ensureChatInStore(updatedChat.id);
          return;
        }
        upsertChats([{ ...existing, status: updatedChat.status ?? existing.status, updatedAt: updatedChat.assigned_at ?? existing.updatedAt, tag: updatedChat.tag ?? existing.tag, color: updatedChat.color ?? existing.color, agent: updatedChat.agent_id ? { ...(existing.agent || {}), id: updatedChat.agent_id } as any : existing.agent }]);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'contacts', filter: `workspace_id=eq.${workspaceId}`,
      }, (payload: RealtimePostgresChangesPayload<Contact>) => {
        const updatedContact = payload.new as Contact;
        console.log('[Realtime] Contato atualizado:', updatedContact.id);
        updateChatContact(updatedContact);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'message_status', filter: `workspace_id=eq.${workspaceId}`,
      }, (payload) => {
        const newStatus = payload.new as any;
        if (newStatus.message_id && newStatus.status) {
          useInboxStore.getState().updateMessageStatus(newStatus.message_id, newStatus.status);
        }
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chat_assignments', filter: `workspace_id=eq.${workspaceId}`,
      }, (payload) => {
        const assignment = payload.new as any;
        if (assignment.chat_id) {
          useInboxStore.getState().updateChatAssignment(assignment.chat_id, assignment.agent_id, assignment.status);
          if (assignment.agent_id === userId) {
            playNotificationSound('attending');
          }
        }
      })
      .subscribe((status, err) => {
        console.log(`[Realtime] Status da conexão: ${status}`, err);
        setLastStatus(status);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          retryTimeoutRef.current = setTimeout(() => setLastStatus('RETRY'), 1500);
        }
      });

    channelRef.current = channel;

    return () => {
      console.log('[Realtime] Cleaning up subscription...');
      supabase.removeChannel(channel);
      channelRef.current = null;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [workspaceId, sessionReady, ensureChatInStore, handleIncomingMessage, handleUpdatedMessage, playNotificationSound, supabase, updateChatContact, upsertChats, userId]);

  // Retry logic after errors/timeouts
  useEffect(() => {
    if (lastStatus === 'RETRY' && sessionReady) {
      console.log('[Realtime] Retrying subscription after failure...');
      setLastStatus(null);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    }
  }, [lastStatus, sessionReady, supabase]);

  return (
    <>
      {needsAudioUnlock && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-md">
          <span>Habilite o som</span>
          <button
            className="bg-white/10 hover:bg-white/20 px-2 py-1 rounded"
            onClick={unlockAudio}
          >
            Habilitar
          </button>
        </div>
      )}
      <audio ref={(el) => { audioRefs.current.queue = el; }} src={SOUND_SOURCES.queue} preload="auto" />
      <audio ref={(el) => { audioRefs.current.attending = el; }} src={SOUND_SOURCES.attending} preload="auto" />
    </>
  );
}
