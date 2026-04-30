import type { AutopilotConfig, Chat, Contact } from '@/lib/types';

export type AgentToolName =
  | 'transfer_chat'
  | 'add_internal_note'
  | 'crm_update_contact_custom_fields'
  | 'sgp_fetch_contracts'
  | 'sgp_fetch_contact_panel_data'
  | 'sgp_generate_invoice_pix'
  | 'sgp_create_payment_promise'
  | 'sgp_open_support_ticket'
  | 'mcp_call_tool'
  | `mcp:${string}:${string}`;

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
    }
  | {
      type: 'crm_update_contact_custom_fields';
      reason?: string | null;
      payload?: {
        fields?: Record<string, string | number | boolean | null | undefined> | null;
      } | null;
    }
  | {
      type: 'sgp_fetch_contracts' | 'sgp_fetch_contact_panel_data';
      reason?: string | null;
      payload?: Record<string, never> | null;
    }
  | {
      type: 'sgp_generate_invoice_pix';
      reason?: string | null;
      payload?: {
        invoiceId?: string | null;
        contractId?: string | null;
      } | null;
    }
  | {
      type: 'sgp_create_payment_promise';
      reason?: string | null;
      payload?: {
        contractId?: string | null;
        promiseDate?: string | null;
        sendSms?: boolean | null;
      } | null;
    }
  | {
      type: 'sgp_open_support_ticket';
      reason?: string | null;
      payload?: Record<string, unknown> | null;
    }
  | {
      type: 'mcp_call_tool';
      reason?: string | null;
      payload?: {
        toolName?: string | null;
        arguments?: Record<string, unknown> | null;
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
  orchestratorRunId?: string | null;
};

export type AgentToolExecutionResult = {
  toolName: AgentToolName;
  status: 'success' | 'rejected' | 'error';
  input: AgentToolAction;
  output?: Record<string, unknown> | null;
  error?: string | null;
};
