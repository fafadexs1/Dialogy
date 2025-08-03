import { HTMLInputTypeAttribute } from "react";

export type Workspace = {
    id: string;
    name: string;
    avatar: string;
}

export type User = {
  id: string;
  firstName: string;
  lastName:string;
  name: string; // Will be generated from firstName + lastName
  avatar: string;
  online?: boolean;
  email?: string;
  phone?: string;
  lastSeen?: string;
  businessProfile?: BusinessProfile;
  workspaces?: Workspace[];
  activeWorkspaceId?: string;
};

export type BusinessProfile = {
  companyName: string;
  website?: string;
  industry?: string;
  employees?: number;
  deals: Deal[];
  tasks: Task[];
  tags: Tag[];
  customFields?: { [key: string]: any };
  dialogPriorityScore?: number;
  financialRiskScore?: number;
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
  id:string;
  sender: User;
  content: string;
  timestamp: string;
  channelId: string;
};

export type CustomFieldDefinition = {
    id: string;
    label: string;
    type: HTMLInputTypeAttribute;
    placeholder?: string;
};

export interface SelectableOption {
    id: string;
    value: string;
    label: string;
    color: string;
}

export interface Tag extends SelectableOption {}
