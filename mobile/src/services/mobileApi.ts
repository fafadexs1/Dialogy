import { demoBootstrap } from "@/data/demo";
import { supabase } from "@/services/supabase";
import type { ChatMessagesPage, InboxBootstrap, Message, SendMessageInput } from "@/types";

const API_URL = process.env.EXPO_PUBLIC_DIALOGY_API_URL?.replace(/\/$/, "") ?? "";
const API_MODE = process.env.EXPO_PUBLIC_DIALOGY_MOBILE_API_MODE ?? "api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL || API_MODE === "demo") {
    throw new Error("Demo mode");
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Sessao ausente. Faca login novamente.");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function loadInboxBootstrap(workspaceId?: string): Promise<InboxBootstrap> {
  try {
    const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    return await request<InboxBootstrap>(`/api/mobile/inbox/bootstrap${query}`);
  } catch (error) {
    if (API_MODE === "demo") {
      return demoBootstrap;
    }
    throw error;
  }
}

export async function loadChatMessages(chatId: string, cursor?: { createdAt: string; id: string } | null): Promise<ChatMessagesPage> {
  try {
    const params = new URLSearchParams();
    if (cursor?.createdAt) {
      params.set("before", cursor.createdAt);
      params.set("beforeId", cursor.id);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return await request<ChatMessagesPage>(`/api/mobile/chats/${chatId}/messages${suffix}`);
  } catch (error) {
    if (API_MODE === "demo") {
      return {
        messages: demoBootstrap.messagesByChatId[chatId] ?? [],
        hasMore: false,
        oldestCursor: null
      };
    }
    throw error;
  }
}

export async function loadCurrentSessionBootstrap(): Promise<InboxBootstrap | null> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  return loadInboxBootstrap();
}

export async function signIn(email: string, password: string): Promise<InboxBootstrap> {
  if (API_MODE === "demo") {
    return demoBootstrap;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error("Credenciais invalidas. Verifique e-mail e senha.");
  }

  return loadInboxBootstrap();
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function sendMessage(input: SendMessageInput): Promise<Message> {
  try {
    return await request<Message>(`/api/mobile/chats/${input.chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: input.content,
        messageId: `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`
      })
    });
  } catch (error) {
    if (API_MODE !== "demo") {
      throw error;
    }
    return {
      id: `local-${Date.now()}`,
      chatId: input.chatId,
      content: input.content,
      createdAt: new Date().toISOString(),
      fromMe: true,
      channel: "whatsapp",
      status: "sent"
    };
  }
}
