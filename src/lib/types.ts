export type User = {
  id: string;
  name: string;
  avatar: string;
  online?: boolean;
  email?: string;
  phone?: string;
  lastSeen?: string;
  customerInfo?: CustomerInfo;
};

export type CustomerInfo = {
  contracts: Contract[];
  openInvoices: Invoice[];
  technicalTickets: Ticket[];
};

export type Contract = {
  contractId: string;
  address: string;
  connectionStatus: 'Online' | 'Offline' | 'Instável' | 'Desconhecido';
  currentPlan: string;
  dataUsage: {
    used: number;
    total: number;
    unit: 'GB' | 'MB';
  };
};

export type Invoice = {
    id: string;
    dueDate: string;
    amount: string;
    status: 'Paga' | 'Vencida' | 'Pendente';
    url: string;
};

export type Ticket = {
    id: string;
    date: string;
    subject: string;
    status: 'Resolvido' | 'Aberto' | 'Em análise';
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
