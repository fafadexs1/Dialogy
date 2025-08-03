export type User = {
  id: string;
  name: string;
  avatar: string;
  online?: boolean;
  email?: string;
  phone?: string;
  lastSeen?: string;
  businessProfile?: BusinessProfile;
};

export type BusinessProfile = {
  companyName: string;
  website?: string;
  industry?: string;
  employees?: number;
  deals: Deal[];
  tasks: Task[];
  tags: string[];
};

export type Deal = {
  id: string;
  name: string;
  value: string;
  stage: 'Qualificação' | 'Proposta Apresentada' | 'Negociação' | 'Fechado';
  closeDate: string;
};

export type Task = {
  id: string;
  description: string;
  dueDate: string;
  completed: boolean;
};

export type Message = {
  id: string;
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