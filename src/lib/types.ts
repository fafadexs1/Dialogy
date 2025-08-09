
import { HTMLInputTypeAttribute } from "react";

export type Workspace = {
    id: string;
    name: string;
    avatar: string;
}

export type Permission = {
    id: string;
    description: string;
    category: string;
}

export type Role = {
    id: string;
    name: string;
    description: string;
    workspace_id?: string;
    permissions: Permission[];
    is_default: boolean;
}

export type User = {
  id: string;
  name: string; 
  avatar: string;
  email?: string;
  workspaces?: Workspace[];
  activeWorkspaceId?: string;
  last_active_workspace_id?: string;
  firstName: string;
  lastName: string;
  businessProfile?: BusinessProfile;
  phone?: string;
  online?: boolean;
  memberSince?: string;
  geminiUsage?: number; // Old, to be removed
  autopilotUsage?: number;
  // RBAC properties
  role?: Role;
  permissions?: string[];
};

export type WorkspaceMember = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  online: boolean;
  role: string;
  team: string;
  memberSince: string;
  autopilotUsage: number;
}


export type Contact = {
  id: string;
  workspace_id: string;
  name: string;
  avatar: string;
  email?: string;
  phone?: string;
  phone_number_jid?: string;
  lastSeen?: string;
  businessProfile?: BusinessProfile;
  firstName: string;
  lastName: string;
}

export type OnlineAgent = {
  user: User;
  joined_at: string;
}

export type BusinessProfile = {
  workspaceId?: string;
  companyName?: string;
  website?: string;
  industry?: string;
  employees?: number;
  deals: Deal[];
  tasks: Task[];
  tags: Tag[];
  customFields?: { [key: "string"]: any };
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

export type MessageSender = User | Contact;

export type Message = {
  id: string;
  sender: MessageSender;
  content: string;
  timestamp: string;
  createdAt: string;
  formattedDate: string;
  chat_id: string;
  workspace_id: string;
  instance_name?: string;
  source_from_api?: string;
};

export type Chat = {
  id:string;
  contact: Contact;
  agent?: User;
  messages: Message[];
  status: 'atendimentos' | 'gerais' | 'encerrados';
  workspace_id: string;
  assigned_at?: string;
  source?: string;
  instance_name?: string;
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

export interface Tag extends SelectableOption {
    is_close_reason?: boolean;
}


export interface Team {
  id: string;
  name: string;
  color: string;
  roleId: string;
  businessHours: BusinessHour[];
  members: User[];
}

export interface BusinessHour {
  day: string;
  isEnabled: boolean;
  startTime: string;
  endTime: string;
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  tag: string;
  tagType: 'default' | 'primary' | 'secondary' | 'beta';
  status?: 'active' | 'coming_soon';
  additionalInfo?: string;
  href?: string;
}

export interface NexusFlowInstance {
  id: string;
  name: string;
  trigger: string;
  action: string;
  enabled: boolean;
  model?: string;
}

export interface EvolutionApiConfig {
    id: string;
    workspace_id: string;
    api_url: string | null;
    api_key: string | null;
}

export interface EvolutionInstance {
    id: string;
    name: string;
    status: 'connected' | 'disconnected' | 'pending';
    type: 'baileys' | 'wa_cloud';
    config_id: string;
    qrCode?: string;
}

export interface EvolutionInstanceCreationPayload {
    instanceName: string;
    integration?: 'WHATSAPP-BAILEYS' | 'WHATSAPP-BUSINESS';
    
    // Cloud API Fields
    token?: string;
    businessId?: string;

    // Baileys Fields
    qrcode?: boolean;
    
    // Common fields
    number?: string;
    rejectCall?: boolean;
    msgCall?: string;
    groupsIgnore?: boolean;
    alwaysOnline?: boolean;
    readMessages?: boolean;
    readStatus?: boolean;
    proxy?: {
        host: string;
        port: number;
        username?: string;
        password?: string;
    };
    webhook?: {
        url?: string;
        enabled?: boolean,
        events?: string[];
    };
    rabbitmq?: {
        enabled?: boolean;
        events?: string[];
    };
    sqs?: {
        enabled?: boolean;
        events?: string[];
    };
}


export interface WorkspaceInvite {
    id: string;
    workspace_id: string;
    code: string;
    created_by: string;
    created_at: string;
    expires_at: string;
    max_uses: number | null;
    is_revoked: boolean;
    use_count: number;
}
