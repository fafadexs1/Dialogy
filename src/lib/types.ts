export type User = {
  id: string;
  name: string;
  avatar: string;
  online?: boolean;
  email?: string;
  phone?: string;
  lastSeen?: string;
};

export type Message = {
  id:string;
  sender: User;
  content: string;
  timestamp: string;
};

export type Chat = {
  id: string;
  contact: User;
  messages: Message[];
  status: 'atendimentos' | 'gerais' | 'encerrados';
};

export type InternalChannel = {
  id: string;
  name: string;
  type: 'channel' | 'dm';
  members?: User[];
  recipient?: User;
  unreadCount?: number;
};

export type InternalMessage = {
  id: string;
  sender: User;
  content: string;
  timestamp: string;
  channelId: string;
};
