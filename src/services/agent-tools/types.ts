import type { AutopilotConfig, Chat, Contact } from '@/lib/types';
import type { AutopilotTurnPolicy } from '@/services/autopilot/turn-policy';

export type AgentToolName =
  | 'transfer_chat'
  | 'close_chat'
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
      type: 'close_chat';
      reason?: string | null;
      payload?: {
        reasonTagId?: string | null;
        notes?: string | null;
        sendCloseMessage?: boolean | null;
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
      type: 'sgp_fetch_contracts';
      reason?: string | null;
      payload?: Record<string, never> | null;
    }
  | {
      type: 'sgp_fetch_contact_panel_data';
      reason?: string | null;
      payload?: {
        contractId?: string | null;
        customerIdentifier?: string | null;
      } | null;
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
  turnPolicy: AutopilotTurnPolicy;
  customerMessage: string;
  recentCustomerVisibleMessages?: Array<{
    fromMe: boolean;
    content: string;
  }>;
  confirmedActionFingerprint?: string | null;
  /**
   * Native workflows can bind a natural-language confirmation to a recent,
   * customer-visible request for the same tool. Legacy callers remain on the
   * stricter persisted-fingerprint path unless they opt in explicitly.
   */
  allowRecentConversationalConfirmation?: boolean;
  orchestratorRunId?: string | null;
  sourceMessageId?: string | null;
  /**
   * Server-only control-plane authorization. It is never parsed from model
   * output or accepted inside an AgentToolAction payload.
   */
  closeAuthorization?: (
    | {
        source: 'workflow_goal_completed';
        chatId: string;
        orchestratorRunId: string;
        workflowId: string;
        workflowVersion: string;
        executionId: string;
        terminalNodeId: string;
        actionFingerprint: string;
      }
    | {
        source: 'procedure_goal_completed';
        chatId: string;
        orchestratorRunId: string;
        procedureExecutionId: string;
        actionFingerprint: string;
      }
    | {
        source: 'conversation_collection_completed';
        chatId: string;
        orchestratorRunId: string;
        sourceMessageId: string;
        workflowId: string;
        workflowVersion: string;
        needsInputExecutionId: string;
        completionExecutionId: string;
        agentNodeId: string;
        terminalNodeId: string;
        pendingFieldsFingerprint: string;
        persistenceReceiptFingerprint: string;
        checkpointFingerprint: string;
        actionFingerprint: string;
      }
  ) | null;
};

export type AgentToolExecutionResult = {
  toolName: AgentToolName;
  status: 'success' | 'rejected' | 'error';
  input: AgentToolAction;
  output?: Record<string, unknown> | null;
  error?: string | null;
};
