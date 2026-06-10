export type Channel = "whatsapp" | "messenger" | "telegram" | "instagram";

export type User = {
  id: string;
  name: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  initials?: string;
  workspaces?: Array<{ id: string; name: string }>;
};

export type ChatStatus = "robo" | "gerais" | "atendimentos" | "encerrados";

export type Contact = {
  id: string;
  name: string;
  initials: string;
  channel: Channel;
  phone?: string;
  avatarUrl?: string;
};

export type Chat = {
  id: string;
  contact: Contact;
  status: ChatStatus;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  tags: string[];
  assignedTo?: string;
  assignedToId?: string;
  assignedAvatarUrl?: string;
  teamName?: string;
  attendantType?: "agent" | "ai" | "queue";
  isAiActive?: boolean;
};

export type Message = {
  id: string;
  chatId: string;
  content: string;
  createdAt: string;
  fromMe: boolean;
  channel: Channel;
  status?: "sent" | "delivered" | "read" | "pending" | "error";
  isSystem?: boolean;
};

export type InboxBootstrap = {
  user: User;
  chats: Chat[];
  messagesByChatId: Record<string, Message[]>;
};

export type ChatMessagesPage = {
  messages: Message[];
  hasMore: boolean;
  oldestCursor: {
    createdAt: string;
    id: string;
  } | null;
};

export type SendMessageInput = {
  chatId: string;
  content: string;
};

export type LoginInput = {
  email: string;
  password: string;
};
