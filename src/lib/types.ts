

import { HTMLInputTypeAttribute } from "react";

export type Workspace = {
    id: string;
    name: string;
    avatar: string;
    timezone?: string;
    roleName?: string;
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
  avatar_url?: string; // Made optional to match DB
  avatar?: string;
  email?: string;
  workspaces?: Workspace[];
  activeWorkspaceId?: string;
  last_active_workspace_id?: string;
  is_superadmin?: boolean;
  firstName: string;
  lastName: string;
  phone?: string;
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
  roleId: string;
  role: string;
  team: string;
  memberSince: string;
  autopilotUsage: number;
}


export type Contact = {
  id: string;
  workspace_id: string;
  name: string;
  avatar_url?: string;
  email?: string;
  phone?: string;
  phone_number_jid?: string;
  lastSeen?: string;
  // Campos que podem não vir do DB diretamente mas são úteis no front
  firstName?: string;
  lastName?: string;
  tags?: Tag[];
  owner?: User;
  activities?: Activity[];
  last_activity?: string;
  address?: string;
  owner_id?: string;
  created_at?: string;
  custom_fields?: Record<string, any>;
}

export type OnlineAgent = {
  user: User;
  joined_at: string;
}

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

export type Activity = {
    id?: string;
    contact_id?: string;
    type: 'ligacao' | 'email' | 'whatsapp' | 'visita' | 'viabilidade' | 'contrato' | 'agendamento' | 'tentativa-contato' | 'nota';
    date: string;
    notes: string;
    user_id?: string; // ID do agente que registrou
}

export type MessageSender = User | Contact | SystemAgent | undefined;

export type MessageMetadata = {
    mediaUrl?: string;
    mimetype?: string;
    fileName?: string;
    thumbnail?: string; // Base64 encoded thumbnail
    sentBy?: 'autopilot' | 'agent' | 'system_agent';
    duration?: number; // Duration in seconds for audio/video
    waveform?: number[]; // For audio visualization
}

export type Message = {
  id: string;
  sender?: MessageSender;
  content: string;
  type: 'text' | 'system' | 'audio' | 'image' | 'video' | 'document';
  status: 'default' | 'deleted';
  metadata?: MessageMetadata;
  timestamp: string;
  createdAt: string;
  formattedDate: string;
  chat_id: string;
  workspace_id: string;
  instance_name?: string;
  source_from_api?: string;
  message_id_from_api?: string;
  from_me?: boolean;
  api_message_status?: string;
  is_read?: boolean;
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
  unreadCount?: number;
  teamName?: string;
  tag?: string;
  color?: string;
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
    type: 'text' | 'number' | 'date' | 'email' | 'tel' | 'select';
    placeholder?: string;
    options?: { id: string; value: string; label: string }[];
};

export interface SelectableOption {
    id: string;
    value: string;
    label: string;
    color?: string;
}

export interface Tag {
    id: string;
    value: string;
    label: string;
    color: string;
    is_close_reason: boolean;
}


export interface Team {
  id: string;
  name: string;
  color: string;
  roleId: string;
  tagId: string | null;
  businessHours: BusinessHour[];
  scheduleExceptions: ScheduleException[];
  members: User[];
}

export interface BusinessHour {
  id: string;
  day: string;
  isEnabled: boolean;
  startTime: string;
  endTime: string;
}

export interface ScheduleException {
  id: string;
  date: string;
  description: string;
  is_closed: boolean;
  start_time: string | null;
  end_time: string | null;
  team_id: string;
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

export type ActionType = 'reply' | 'webhook';

export type Action = 
  | {
      type: 'reply';
      value: string;
    }
  | {
      type: 'webhook';
      url: string;
      method: 'GET' | 'POST';
      body?: Record<string, any>;
    };

export interface NexusFlowInstance {
  id: string;
  name: string;
  trigger: string;
  action: Action;
  enabled: boolean;
  model?: string;
}

export interface AutopilotConfig {
    id: string;
    workspace_id: string;
    gemini_api_key: string | null;
    ai_model: string | null;
    knowledge_base: string | null;
    created_at: string;
    updated_at: string;
}

export interface AutopilotUsageLog {
    id: string;
    flow_name: string;
    rule_name: string | null;
    model_name: string;
    total_tokens: number;
    created_at: string;
    input_tokens: number;
    output_tokens: number;
}

export interface WhatsappCluster {
    id: string;
    name: string;
    api_url: string;
    api_key: string;
    is_active: boolean;
    metrics: {
        cpu: number;
        memory: number;
        storage: {
            used: number;
            total: number;
        };
        network: {
            down: number;
            up: number;
        };
        instances_count: number;
    } | null;
    created_at: string;
    updated_at: string;
}

export interface EvolutionInstance {
    id: string;
    instance_name: string;
    display_name: string;
    status: 'connected' | 'disconnected' | 'pending';
    type: 'baileys' | 'wa_cloud';
    cluster_id: string; 
    qrCode?: string;
    webhook_url?: string;
}

export type EvolutionApiConfig = {
  id: string;
  workspace_id: string;
  api_url: string;
  api_key: string;
};

export interface EvolutionInstanceCreationPayload {
    // Top-level
    instanceName?: string;
    displayName: string;
    number?: string;
    token?: string; // Can be for Baileys instance or Cloud API
    integration?: 'WHATSAPP-BAILEYS' | 'WHATSAPP-BUSINESS';

    // Baileys Specific
    qrcode?: boolean;
    rejectCall?: boolean;
    msgCall?: string;
    groupsIgnore?: boolean;
    alwaysOnline?: boolean;
    readMessages?: boolean;
    readStatus?: boolean;
    syncFullHistory?: boolean;

    // Cloud API Specific
    businessId?: string;

    // Proxy
    proxy?: {
        host: string;
        port: number;
        username?: string;
        password?: string;
        protocol?: string;
    };

    // Webhook
    webhook?: {
        url?: string;
        byEvents?: boolean;
        base64?: boolean;
        headers?: Record<string, string>;
        events?: string[];
    };
    
    // RabbitMQ
    rabbitmq?: {
        enabled?: boolean;
        events?: string[];
    };

    // SQS
    sqs?: {
        enabled?: boolean;
        events?: string[];
    };

    // Chatwoot
    chatwoot?: {
        accountId?: number;
        token?: string;
        url?: string;
        signMsg?: boolean;
        reopenConversation?: boolean;
        conversationPending?: boolean;
        importContacts?: boolean;
        nameInbox?: string;
        mergeBrazilContacts?: boolean;
        importMessages?: boolean;
        daysLimitImportMessages?: number;
        organization?: string;
        logo?: string;
    }
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

export interface SystemAgent {
    id: string;
    workspace_id: string;
    name: string;
    avatar_url: string;
    token: string;
    webhook_url: string;
    is_active: boolean;
    created_at: string;
}

// Analytics Types
export interface AnalyticsData {
    totalConversations: number;
    newContacts: number;
    avgFirstResponseTime: string | null;
    firstContactResolutionRate: number;
    conversationsByHour: { hour: string; count: number }[];
}

export interface AgentPerformance {
    agent_id: string;
    agent_name: string;
    avatar_url: string;
    total_chats: number;
    resolved_chats: number;
    avg_first_response_time: string | null;
    avg_rating: string | null; // Mocked for now
}

export interface Shortcut {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  message: string;
  type: 'global' | 'private';
  created_at: string;
  updated_at: string;
  user_name?: string; // Optional: for displaying the creator's name
}

export type CampaignStatus = 'draft' | 'sending' | 'completed' | 'paused' | 'failed';
export type CampaignRecipientStatus = 'pending' | 'sent' | 'failed';

export interface Campaign {
  id: string;
  workspace_id: string;
  name: string;
  message: string;
  instance_name: string;
  status: CampaignStatus;
  channel: 'parallel' | 'api';
  created_at: string;
  started_at?: string;
  completed_at?: string;
  total_recipients?: number;
  sent_recipients?: number;
  progress?: number;
  recipients?: number;
  deliveredPct?: number;
  lastUpdate?: string;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  contact_id: string;
  status: CampaignRecipientStatus;
  sent_at?: string;
  error_message?: string;
}

    

    
