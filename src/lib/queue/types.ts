export type QueueJobType =
  | 'whatsapp_send'
  | 'webhook_outbound'
  | 'queue_auto_close'
  | 'marketing_auto_close'
  | 'analytics_event'
  | 'notification_send'
  | 'ai_task';

export type WhatsappSendPayload = {
  messageId: string;
  workspaceId: string;
  instanceName: string;
  number: string;
  content: string;
  apiContent?: string;
  template?: {
    name: string;
    language: string;
    components: any[];
  };
  metadata?: Record<string, unknown>;
  senderId?: string;
  senderType?: 'user' | 'system_agent';
  tabId?: string | null;
};

export type WebhookOutboundPayload = {
  chatId: string;
  messageId: string;
  instanceName?: string | null;
};

export type AnalyticsEventPayload = {
  workspaceId?: string;
  name: string;
  payload?: Record<string, unknown>;
};

export type QueueAutoClosePayload = {
  chatId: string;
  workspaceId: string;
  lastIncomingAt: string;
  autoCloseMs: number;
};

export type MarketingAutoClosePayload = {
  chatId: string;
  workspaceId: string;
  marketingSentAt: string;
  autoCloseMs: number;
};

export type NotificationPayload = {
  workspaceId?: string;
  userId?: string;
  channel: 'email' | 'sms' | 'push' | 'inapp';
  payload: Record<string, unknown>;
};

export type AiTaskPayload = {
  workspaceId?: string;
  task: string;
  payload?: Record<string, unknown>;
};

export type QueueJobPayload =
  | WhatsappSendPayload
  | WebhookOutboundPayload
  | QueueAutoClosePayload
  | MarketingAutoClosePayload
  | AnalyticsEventPayload
  | NotificationPayload
  | AiTaskPayload;

export type QueueJobRecord = {
  id: string;
  type: QueueJobType;
  status: string;
  payload: QueueJobPayload;
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_at?: string | null;
  locked_by?: string | null;
  last_error?: string | null;
};
