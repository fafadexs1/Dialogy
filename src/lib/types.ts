

import { HTMLInputTypeAttribute } from "react";

export type InterfaceTheme = 'light' | 'dark' | 'system';

export type Workspace = {
  id: string;
  name: string;
  avatar: string;
  timezone?: string;
  closeMessageTemplate?: string;
  transferTeamMessageTemplate?: string;
  marketingAutoCloseSeconds?: number;
  queueAutoCloseSeconds?: number;
  roleName?: string;
  isOwner?: boolean;
  plan?: string;
  nexus_settings?: {
    mode?: 'workspace_managed' | 'existing_account';
    email?: string;
    username?: string;
    autoProvisioned?: boolean;
    nexusUserId?: string;
    createdAt?: string;
    updatedAt?: string;
  }; // Shared NexusFlow credentials per workspace
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
  activeWorkspaceTimezone?: string;
  is_superadmin?: boolean;
  firstName: string;
  lastName: string;
  phone?: string;
  memberSince?: string;
  geminiUsage?: number; // Old, to be removed
  autopilotUsage?: number;
  themePreference?: InterfaceTheme;
  // RBAC properties
  role?: Role;
  permissions?: string[];
  team?: string;
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
  phone_canonical?: string;
  lastSeen?: string;
  // Campos que podem não vir do DB diretamente mas são úteis no front
  firstName?: string;
  lastName?: string;
  tags?: Tag[];
  owner?: Partial<User>;
  activities?: Activity[];
  last_activity?: string;
  address?: string;
  owner_id?: string;
  meta_contact_id?: string; // Reference to meta_contacts for Instagram/Messenger
  created_at?: string;
  converted_at?: string | null;
  custom_fields?: Record<string, any>;
  lead_score?: number;
  relatedContactIds?: string[];
  relatedPhoneNumberJids?: string[];
  relatedContactCount?: number;
}

export type OnlineAgent = {
  user: User;
  joined_at: string;
}

export type Deal = {
  id: string;
  workspace_id: string;
  contact_id: string;
  title: string;
  value: number;
  currency: string;
  stage: string;
  probability: number;
  expected_close_date?: string | null;
  closed_at?: string | null;
  won?: boolean | null;
  owner_id?: string | null;
  owner?: Partial<User>;
  contact?: Partial<Contact>;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type DealMetrics = {
  totalPipelineValue: number;
  weightedPipelineValue: number;
  averageTicket: number;
  winRate: number;
  averageCycleTimeDays: number;
  dealsByStage: { stage: string; count: number; totalValue: number }[];
  trends: {
    newDeals: { current: number; previous: number; change: number };
    closedWon: { current: number; previous: number; change: number };
    revenue: { current: number; previous: number; change: number };
  };
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

export type MessageSender = Partial<User> & { type?: 'user' | 'contact' | 'system_agent' } | Partial<Contact> & { type?: 'user' | 'contact' | 'system_agent' } | Partial<SystemAgent> & { type?: 'user' | 'contact' | 'system_agent' } | undefined;



export type MessageMetadata = {
  sharedContactName?: string;
  sharedContactPhones?: string[];
  sharedContactVcard?: string;
  sharedContacts?: Array<{
    displayName?: string;
    fullName?: string;
    organization?: string;
    phones?: string[];
    vcard?: string;
  }>;
  mediaUrl?: string;
  mimetype?: string;
  fileName?: string;
  thumbnail?: string; // Base64 encoded thumbnail
  latitude?: number;
  longitude?: number;
  address?: string;
  locationName?: string;
  mapUrl?: string;
  locationDescription?: string;
  sentBy?: 'autopilot' | 'agent' | 'system_agent';
  duration?: number; // Duration in seconds for audio/video
  waveform?: number[]; // For audio visualization
  isInternalNote?: boolean;
  isAiAnalysis?: boolean;
  isToolExecution?: boolean;
  tool?: string;
  customerMessage?: string;
  analysisKind?: 'transcription' | 'visual_summary' | 'video_summary' | 'media_summary' | 'routing_context';
  sourceMessageId?: string;
  sourceType?: 'text' | 'audio' | 'image' | 'video' | 'document' | 'location' | 'system';
  event?: string;
  from_agent_id?: string;
  to_agent_id?: string;
  to_team_id?: string;
  to_name?: string;
  closed_by?: string;
  reason_tag_id?: string | null;
  notes?: string | null;
  authored_by?: string;
  authored_by_name?: string;
  authored_by_avatar?: string;
  authored_by_avatar_url?: string;
  template_applied?: boolean;
  closed_by_system_agent_id?: string;
  authored_by_system_agent_id?: string;
  isMarketing?: boolean;
  is_bulk_action?: boolean;
  optimisticId?: string;
  send_error?: string;
  send_error_details?: {
    source?: string;
    status?: string;
    reason?: string;
    code?: string | number;
    provider_message?: string;
    webhook_event?: string;
    key_id?: string;
    captured_at?: string;
    raw_data?: Record<string, unknown>;
    raw_payload?: unknown;
    provider_payload?: Record<string, unknown>;
    message_updates?: Array<Record<string, unknown>>;
  };
  replyToMessageId?: string;
  replyToMessageIdFromApi?: string;
  replyToChatId?: string;
  replyToContent?: string;
  replyToType?: 'text' | 'system' | 'audio' | 'image' | 'video' | 'document' | 'location';
  replyToFromMe?: boolean;
  replyToCreatedAt?: string;
  replyToParticipantJid?: string;
  isQuestionReply?: boolean;
  packId?: string;
  buyerId?: string;
  questionId?: string;
  interactiveType?: 'list';
  interactivePayload?: {
    kind: 'list';
    title?: string;
    description?: string;
    buttonText: string;
    footerText?: string;
    sections: Array<{
      title: string;
      rows: Array<{
        title: string;
        description?: string;
        rowId: string;
      }>;
    }>;
    delay?: number;
    quoted?: {
      key?: {
        id?: string;
      };
      message?: Record<string, any>;
    };
    mentionsEveryOne?: boolean;
    mentioned?: string[];
  };
  telegram?: {
    updateId?: number;
    eventType?: 'message' | 'edited_message';
    chatId?: string;
    chatType?: string;
    chatTitle?: string;
    username?: string;
    fromId?: string;
    isEdited?: boolean;
  };
}

export type Message = {
  id: string;
  sender?: MessageSender;
  content: string;
  type: 'text' | 'system' | 'audio' | 'image' | 'video' | 'document' | 'location';
  status: 'default' | 'deleted';
  metadata?: MessageMetadata;
  transcription: string | null;
  timestamp: string;
  createdAt: string;
  updatedAt?: string;
  formattedDate: string;
  chat_id: string;
  workspace_id: string;
  instance_name?: string;
  source_from_api?: string;
  message_id_from_api?: string;
  from_me?: boolean;
  api_message_status?: string;
  is_read?: boolean;
  sentByTab?: string | null;
  optimistic?: boolean;
  platform?: 'instagram' | 'messenger' | string;
  direction?: 'incoming' | 'outgoing';
  externalMessageId?: string;
  externalSenderId?: string;
  externalChannelId?: string;
  mediaUrl?: string;
};
export type Chat = {
  id: string;
  contact: Contact;
  agent?: User;
  agentId?: string;
  assignedSystemAgent?: Pick<SystemAgent, 'id' | 'name' | 'avatar_url' | 'type'>;
  assigned_system_agent_id?: string | null;
  messages: Message[];
  protocol?: string;
  protocolScoped?: boolean;
  updatedAt?: string;
  status: 'atendimentos' | 'gerais' | 'encerrados';
  workspace_id: string;
  assigned_at?: string;
  source?: string;
  team_id?: string;
  instance_name?: string;
  instance_type?: 'baileys' | 'wa_cloud' | 'telegram';
  unreadCount?: number;
  teamName?: string;
  teamColor?: string;
  tag?: string;
  color?: string;
  is_autopilot_active?: boolean;
  autopilot_config_id?: string | null;
  copilot_mode?: 'off' | 'auto' | 'suggest';
  metaContactExternalId?: string | null;
  metaContactUsername?: string | null;
  metaPlatform?: 'instagram' | 'messenger' | null;
  relatedContactThread?: boolean;
  relatedContactIds?: string[];
  relatedChatIds?: string[];
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

export type CustomFieldDefinition = {
  id: string;
  workspace_id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'email' | 'tel' | 'select' | 'file';
  placeholder?: string;
  options?: SelectableOption[];
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
  team_ids?: string[];
  category?: string;
  sort_order?: number | null;
}


export interface Team {
  id: string;
  name: string;
  color: string;
  roleId: string;
  tagId: string | null;
  agentRoutingConfig?: {
    enabled?: boolean;
    autoTransfer?: boolean;
    keywords?: string[];
    responseHint?: string | null;
  } | null;
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
  icon_url: string;
  tag: string;
  tag_type: 'primary' | 'secondary' | 'beta';
  href: string;
  status: 'active' | 'coming_soon';
  limitStatus?: {
    reached: boolean;
    current: number;
    max: number;
    plan: string;
  };
}

export type MetaChannel = {
  id: string;
  workspace_id: string;
  type: 'instagram' | 'messenger';
  external_page_id?: string | null;
  ig_business_id?: string | null;
  access_token?: string;
  verify_token?: string;
  app_secret?: string | null;
  name?: string | null;
  status?: string | null;
  settings?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
};

export type MetaContact = {
  id: string;
  channel_id: string;
  contact_id: string;
  external_id: string;
  username?: string | null;
  name?: string | null;
  profile_pic?: string | null;
};

export type MetaConversation = {
  id: string;
  channel_id: string;
  meta_contact_id: string;
  chat_id: string;
  external_thread_id: string;
  platform: 'instagram' | 'messenger';
  last_message_at?: string;
  status?: string;
};

export type ActionType = 'reply' | 'webhook';

export type Action =
  | {
    type: 'reply';
    value: string;
  }
  | {
    type: 'webhook';
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    description?: string;
    auth?: {
      type: 'none' | 'bearer' | 'basic' | 'api_key';
      token?: string;
      username?: string;
      password?: string;
      key?: string;
      value?: string;
      placement?: 'header' | 'query';
    };
    headers?: Record<string, string>;
    query?: Record<string, string>;
    bodyType?: 'json' | 'form-data';
    body?: Record<string, any>;
  };

export interface KnowledgeBaseDocument {
  id: string;
  name: string;
  content: string;
  tokens?: number;
  uploaded_at?: string;
  summary?: string | null;
  category?: string | null;
  tags?: string[] | null;
  priority?: number | null;
  status?: 'draft' | 'active' | 'archived' | 'expired' | string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  audience?: string | string[] | null;
  source?: string | null;
  owner?: string | null;
  updatedAt?: string | null;
  workflowHints?: string[] | null;
  requiredTools?: string[] | null;
  canonicalAnswer?: string | null;
}

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
  user_id: string;
  name: string;
  gemini_api_key: string | null;
  ai_model: string | null;
  transcription_model: string | null;
  knowledge_base: string | null;
  knowledge_base_documents: KnowledgeBaseDocument[] | null;
  is_primary: boolean;
  is_active: boolean;
  is_private: boolean;
  default_fallback_reply: string | null;
  escalation_policy: string | null;
  closing_policy: string | null;
  enabled_tool_names?: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface AutopilotConfigDraftSnapshot {
  name: string;
  gemini_api_key: string | null;
  ai_model: string | null;
  transcription_model?: string | null;
  knowledge_base: string | null;
  knowledge_base_documents: KnowledgeBaseDocument[];
  is_active: boolean;
  is_private: boolean;
  default_fallback_reply: string | null;
  escalation_policy: string | null;
  closing_policy: string | null;
  enabled_tool_names: string[];
}

export interface AutopilotConfigDraft {
  config_id: string;
  workspace_id: string;
  user_id: string;
  snapshot: AutopilotConfigDraftSnapshot;
  created_at: string;
  updated_at: string;
}

export interface AutopilotConfigVersionSummary {
  id: string;
  config_id: string;
  workspace_id: string;
  user_id: string | null;
  version_number: number;
  label: string | null;
  created_at: string;
  snapshot?: AutopilotConfigDraftSnapshot;
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
  chat_id?: string | null;
  system_agent_id?: string | null;
  input_message?: string | null;
  output_message?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
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
  webhook_key?: string | null;
  display_name: string;
  status: 'connected' | 'disconnected' | 'pending';
  type: 'baileys' | 'wa_cloud' | 'telegram' | 'mercadolivre';
  cluster_id: string;
  qrCode?: string;
  webhook_url?: string;
  business_name?: string | null;
  waba_name?: string | null;
  display_phone_number?: string | null;
  verified_name?: string | null;
  waba_id?: string | null;
  phone_number_id?: string | null;
  telegram_bot_id?: string | null;
  telegram_bot_username?: string | null;
  telegram_bot_name?: string | null;
  telegram_webhook_url?: string | null;
}

export interface TelegramBotInstance {
  id: string;
  workspace_id: string;
  instance_name: string;
  webhook_key?: string | null;
  display_name: string;
  status: 'connected' | 'disconnected' | 'pending';
  type: 'telegram';
  webhook_url?: string | null;
  telegram_bot_id?: string | null;
  telegram_bot_username?: string | null;
  telegram_bot_name?: string | null;
  telegram_webhook_url?: string | null;
}

export interface TelegramBotProfileSettings {
  instance_id: string;
  instance_name: string;
  dialogy_display_name: string;
  bot_id?: string | null;
  username?: string | null;
  default_name: string;
  name: string;
  description: string;
  short_description: string;
  photo_data_url?: string | null;
  has_photo: boolean;
}

export type EvolutionInstanceSettings = {
  rejectCall?: boolean;
  msgCall?: string;
  groupsIgnore?: boolean;
  alwaysOnline?: boolean;
  readMessages?: boolean;
  readStatus?: boolean;
  syncFullHistory?: boolean;
};


export type EvolutionApiConfig = {
  id: string;
  workspace_id: string;
  api_url: string;
  api_key: string;
};

export interface EvolutionInstanceCreationPayload {
  // Top-level - instanceName é gerado automaticamente pela action (zap1, zap2, etc.)
  instanceName?: string;
  // displayName é o nome amigável mostrado no Dialogy (ex: "WhatsApp Vendas")
  displayName?: string;
  number?: string;
  token?: string; // Can be for Baileys instance or Cloud API
  integration?: 'WHATSAPP-BAILEYS' | 'WHATSAPP-BUSINESS' | 'EVOLUTION';
  channel?: 'telegram';
  telegramBotToken?: string;

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

  // Meta Info (for storage only)
  metaInfo?: {
    businessName?: string;
    wabaName?: string;
    displayPhoneNumber?: string;
    verifiedName?: string;
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

export interface SystemAgent {
  id: string;
  workspace_id: string;
  name: string;
  avatar_url: string;
  token: string;
  webhook_url: string | null;
  is_active: boolean;
  created_at: string;
  type?: string | null;
  handoff_system_agent_id?: string | null;
  hide_from_chatlist?: boolean;
  autopilot_config_id?: string | null;
  team_id?: string | null;
  autopilot_config_name?: string | null;
  team_name?: string | null;
}

// Analytics Types
export interface AnalyticsData {
  totalConversations: number;
  newContacts: number;
  avgFirstResponseTime: string | null;
  firstContactResolutionRate: number;
  resolvedConversations: number;
  openConversations: number;
  automationConversations: number;
  totalMessages: number;
  customerMessages: number;
  agentMessages: number;
  avgMessagesPerConversation: number;
  conversationsByHour: { hour: string; count: number }[];
  conversationsByChannel: { name: string; value: number; color: string }[];
}

export type ConversionCounterMode = 'won_deals' | 'unique_converted_contacts';

export interface ConversionSettings {
  counterMode: ConversionCounterMode;
}

export interface ConversionMetrics {
  counterMode: ConversionCounterMode;
  counterValue: number;
  wonDeals: number;
  convertedContacts: number;
  totalRevenue: number;
  lastConversionAt: string | null;
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
  type: 'global' | 'private' | 'team';
  team_id?: string;
  created_at: string;
  updated_at: string;
  user_name?: string; // Optional: for displaying the creator's name
  team_name?: string; // Optional: for displaying the team name
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

export interface InstanceCost {
  type: 'baileys' | 'wa_cloud' | 'telegram';
  cost: number;
}

export interface BillingData {
  totalBaileysInstances: number;
  totalCloudInstances: number;
  totalBaileysCost: number;
  totalCloudCost: number;
  totalCost: number;
  workspaces: {
    id: string;
    name: string;
    owner_id: string;
    owner_name: string;
    baileys_count: number;
    cloud_count: number;
    subtotal: number;
  }[];
}

// Plan Management
export interface PlanIntegration extends Integration {
  integration_id: string;
  included_quantity: number;
  additional_cost: number;
  is_enabled: boolean;
}

export interface Plan {
  id: string;
  slug?: string;
  name: string;
  description: string;
  price: number;
  limits?: {
    users?: number;
    monthly_chats?: number;
    whatsapp?: number;
    history_months?: number;
    departments?: boolean;
    campaigns?: boolean | 'moderate' | 'high';
    api?: boolean;
    transcription?: boolean;
    ai_byok?: boolean;
  };
  is_active: boolean;
  is_default: boolean;
  integrations: PlanIntegration[];
}

export interface Segment {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  criteria: any;
  created_at: string;
  updated_at: string;
}
