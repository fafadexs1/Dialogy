import type { AutopilotConfig, Chat, Contact } from '@/lib/types';

export type AgentToolName = 'transfer_chat' | 'add_internal_note';

export type AgentToolAction =
  | {
      type: 'transfer_chat';
      reason?: string | null;
      payload?: {
        teamId?: string | null;
        teamName?: string | null;
        agentId?: string | null;
      } | null;
    }
  | {
      type: 'add_internal_note';
      reason?: string | null;
      payload?: {
        content?: string | null;
      } | null;
    };

export type AgentToolRuntimeContext = {
  workspaceId: string;
  chat: Chat;
  contact: Contact;
  systemAgentId: string;
  systemAgentName: string;
  autopilotConfig: AutopilotConfig;
  customerMessage: string;
};

export type AgentToolExecutionResult = {
  toolName: AgentToolName;
  status: 'success' | 'rejected' | 'error';
  input: AgentToolAction;
  output?: Record<string, unknown> | null;
  error?: string | null;
};
