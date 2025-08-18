
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ChatList from '../chat/chat-list';
import ChatPanel from '../chat/chat-panel';
import ContactPanel from '../chat/contact-panel';
import { type Chat, Message, User, Tag, MessageSender, Contact } from '@/lib/types';
import { getTags } from '@/actions/crm';
import { toZonedTime, format as formatInTimeZone } from 'date-fns-tz';
import { format as formatDate, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { db } from '@/lib/db';

const timeZone = 'America/Sao_Paulo';

function formatMessageDate(date: Date): string {
    const zonedDate = toZonedTime(date, timeZone);
    if (isToday(zonedDate)) {
        return `Hoje`;
    }
    if (isYesterday(zonedDate)) {
        return `Ontem`;
    }
    return formatDate(zonedDate, "dd/MM/yyyy", { locale: ptBR });
}

// Helper function to fetch chats for the workspace
async function fetchDataForWorkspace(workspaceId: string, userId: string) {
    console.log(`--- [CHAT_LAYOUT] fetchDataForWorkspace: Buscando dados para o workspace ID: ${workspaceId} e Usuário ID: ${userId} ---`);
    if (!workspaceId) return { chats: [] };

    // 1. Fetch all possible senders (users, contacts, system agents) and create a map for quick lookup.
    const userRes = await db.query('SELECT id, full_name as name, avatar_url as avatar FROM users');
    const contactRes = await db.query('SELECT id, name, avatar_url as avatar, phone_number_jid FROM contacts WHERE workspace_id = $1', [workspaceId]);
    const systemAgentRes = await db.query('SELECT id, name, avatar_url as avatar FROM system_agents WHERE workspace_id = $1', [workspaceId]);

    const sendersMap = new Map<string, MessageSender>();
    userRes.rows.forEach(u => sendersMap.set(u.id, { ...u, type: 'user' }));
    contactRes.rows.forEach(c => sendersMap.set(c.id, { ...c, type: 'contact' }));
    systemAgentRes.rows.forEach(a => sendersMap.set(a.id, { ...a, type: 'system_agent' }));

    // Helper to find any sender by their ID
    const getSenderById = (id: string | null): MessageSender | undefined => {
        if (!id) return undefined;
        return sendersMap.get(id);
    };
    
    // 3. Fetch chats visible to the current user (Gerais, Atendimentos, and their own Encerrados)
    const chatRes = await db.query(`
        WITH LastMessage AS (
            SELECT
                chat_id,
                source_from_api,
                instance_name,
                created_at,
                ROW_NUMBER() OVER(PARTITION BY chat_id ORDER BY created_at DESC) as rn
            FROM messages
            WHERE type = 'text' OR type IS NULL
        )
        SELECT 
            c.id, 
            c.status, 
            c.workspace_id, 
            c.contact_id, 
            c.agent_id, 
            c.assigned_at,
            c.tag,
            c.color,
            t.name as team_name,
            MAX(m.created_at) as last_message_time,
            lm.source_from_api as source,
            lm.instance_name,
            COALESCE((SELECT COUNT(*) FROM messages msg WHERE msg.chat_id = c.id AND msg.is_read = FALSE AND msg.from_me = FALSE), 0) as unread_count
        FROM chats c
        LEFT JOIN messages m ON c.id = m.chat_id
        LEFT JOIN team_members tm ON c.agent_id = tm.user_id
        LEFT JOIN teams t ON tm.team_id = t.id
        LEFT JOIN LastMessage lm ON c.id = lm.chat_id AND lm.rn = 1
        WHERE c.workspace_id = $1 AND (
            c.status IN ('gerais', 'atendimentos') OR 
            (c.status = 'encerrados' AND c.agent_id = $2)
        )
        GROUP BY c.id, lm.source_from_api, lm.instance_name, t.name
        ORDER BY last_message_time DESC NULLS LAST
    `, [workspaceId, userId]);

    const chats: Chat[] = chatRes.rows.map(r => ({
        id: r.id,
        status: r.status,
        workspace_id: r.workspace_id,
        contact: sendersMap.get(r.contact_id) as Contact,
        agent: sendersMap.get(r.agent_id) as User | undefined,
        messages: [],
        source: r.source,
        instance_name: r.instance_name,
        assigned_at: r.assigned_at,
        unreadCount: parseInt(r.unread_count, 10),
        teamName: r.team_name,
        tag: r.tag,
        color: r.color,
    }));

    // 4. Fetch and combine messages if chats exist
    if (chats.length > 0) {
        // Fetch the complete message history for all contacts present in the visible chats.
        const contactIds = Array.from(new Set(chats.map(c => c.contact.id)));
        
        const messageRes = await db.query(`
            SELECT m.id, m.content, m.created_at, m.chat_id, m.sender_id, m.workspace_id, m.instance_name, m.source_from_api, m.type, m.status, m.metadata, m.api_message_status, m.message_id_from_api, m.from_me, c.contact_id, m.is_read
            FROM messages m
            JOIN chats c ON m.chat_id = c.id
            WHERE c.contact_id = ANY($1::uuid[]) AND c.workspace_id = $2
            ORDER BY m.created_at ASC
        `, [contactIds, workspaceId]);

        const messagesByContact: { [key: string]: Message[] } = {};
        messageRes.rows.forEach(m => {
            if (!messagesByContact[m.contact_id]) {
                messagesByContact[m.contact_id] = [];
            }
            const createdAtDate = new Date(m.created_at);
            const zonedDate = toZonedTime(createdAtDate, timeZone);
            
            messagesByContact[m.contact_id].push({
                id: m.id,
                chat_id: m.chat_id,
                workspace_id: m.workspace_id,
                content: m.content,
                type: m.type,
                status: m.status,
                metadata: m.metadata,
                timestamp: formatInTimeZone(zonedDate, 'HH:mm', { locale: ptBR }),
                createdAt: createdAtDate.toISOString(),
                formattedDate: formatMessageDate(createdAtDate),
                sender: getSenderById(m.sender_id), 
                instance_name: m.instance_name,
                source_from_api: m.source_from_api,
                api_message_status: m.api_message_status,
                message_id_from_api: m.message_id_from_api,
                from_me: m.from_me,
                is_read: m.is_read,
            });
        });

        // Assign the full history to each chat object for that contact
        chats.forEach(chat => {
          chat.messages = messagesByContact[chat.contact.id] || [];
        });
    }

    console.log(`[CHAT_LAYOUT] fetchDataForWorkspace: Dados de chats e mensagens combinados para o usuário ${userId}.`);
    return { chats };
}


export default async function CustomerChatLayout({ currentUser }: { currentUser: User }) {
  const { chats: initialChats } = await fetchDataForWorkspace(currentUser.activeWorkspaceId!, currentUser.id);
  const tagsResult = await getTags(currentUser.activeWorkspaceId!);
  const closeReasons = tagsResult.tags?.filter(t => t.is_close_reason) || [];
  
  // This component now fetches its own data.
  // The client part that used to be here is now inside a new component.
  return (
    <ClientCustomerChatLayout 
        initialChats={initialChats}
        currentUser={currentUser}
        initialCloseReasons={closeReasons}
    />
  );
}


function ClientCustomerChatLayout({ initialChats, currentUser, initialCloseReasons }: {initialChats: Chat[], currentUser: User, initialCloseReasons: Tag[]}) {
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [closeReasons, setCloseReasons] = useState<Tag[]>(initialCloseReasons);
  const [showFullHistory, setShowFullHistory] = useState(true);

  // Use a ref to hold the current selected chat ID to avoid stale closures in interval
  const selectedChatIdRef = useRef<string | null>(null);
  useEffect(() => {
      selectedChatIdRef.current = selectedChat?.id || null;
  }, [selectedChat]);


   const handleSetSelectedChat = async (chat: Chat) => {
    // Optimistic Update: Set the selected chat immediately for instant UI feedback.
    setSelectedChat(chat);
    setShowFullHistory(true);

    if (chat.unreadCount && chat.unreadCount > 0) {
      // Optimistically update the unread count in the UI
      setChats(prevChats => 
          prevChats.map(c => 
              c.id === chat.id ? { ...c, unreadCount: 0 } : c
          )
      );
      
      const unreadMessages = chat.messages.filter(m => !m.from_me && !m.is_read);
      const messageDbIdsToUpdate = unreadMessages.map(m => m.id);

      if (messageDbIdsToUpdate.length > 0) {
        const payload = {
            messageIds: messageDbIdsToUpdate,
            instanceName: chat.instance_name,
            messagesToMark: chat.instance_name ? unreadMessages
                .filter(m => m.message_id_from_api)
                .map(m => ({
                    remoteJid: chat.contact.phone_number_jid!,
                    fromMe: false,
                    id: m.message_id_from_api!,
                })) : undefined,
        };

        // Fire and forget the API call. The UI is already updated.
        // If it fails, the next poll will correct the unread count anyway.
        fetch('/api/chats/mark-as-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }).catch(err => {
            console.error("Failed to mark messages as read in the background:", err);
        });
      }
    }
  };
  
  const updateData = useCallback(async () => {
    if (!currentUser.activeWorkspaceId) return;

    // Use a function that is defined outside the component or doesn't depend on props/state
    const response = await fetch(`/api/chats/${currentUser.activeWorkspaceId}`, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const latestChats = data.chats as Chat[];

    setChats(latestChats);

    // After fetching, find the currently selected chat in the new list and update it
    const currentChatId = selectedChatIdRef.current;
    if (currentChatId) {
      const updatedSelectedChat = latestChats.find(c => c.id === currentChatId);
      if (updatedSelectedChat) {
        setSelectedChat(prevSelected => ({
          ...updatedSelectedChat,
          messages: updatedSelectedChat.messages.length > 0 ? updatedSelectedChat.messages : (prevSelected?.messages || [])
        }));
      } else {
        setSelectedChat(null);
      }
    }
}, [currentUser.activeWorkspaceId]);

  // Initial data load and polling setup
  useEffect(() => {
    let pollingInterval: NodeJS.Timeout | null = null;
    if (currentUser.activeWorkspaceId) {
        // Fetch immediately and then set up polling
        updateData();
        pollingInterval = setInterval(updateData, 5000); // Poll every 5 seconds
    }
    
    return () => {
        if (pollingInterval) {
            clearInterval(pollingInterval);
        }
    };
  }, [currentUser.activeWorkspaceId, updateData]);

  // Fetch close reasons
  useEffect(() => {
      if(currentUser.activeWorkspaceId){
          getTags(currentUser.activeWorkspaceId).then(tagsResult => {
              if (!tagsResult.error && tagsResult.tags) {
                  setCloseReasons(tagsResult.tags.filter(t => t.is_close_reason));
              }
          });
      }
  }, [currentUser.activeWorkspaceId]);

  return (
    <div className="h-full flex-1 w-full min-h-0 flex">
      <ChatList
        chats={chats}
        selectedChat={selectedChat}
        setSelectedChat={handleSetSelectedChat}
        currentUser={currentUser}
        onUpdate={updateData}
      />
      <ChatPanel 
        key={selectedChat?.id} 
        chat={selectedChat} 
        currentUser={currentUser} 
        onActionSuccess={updateData}
        closeReasons={closeReasons}
        showFullHistory={showFullHistory}
        setShowFullHistory={setShowFullHistory}
      />
      <ContactPanel 
        chat={selectedChat} 
        onTransferSuccess={updateData}
        onContactUpdate={updateData}
      />
    </div>
  );
}

