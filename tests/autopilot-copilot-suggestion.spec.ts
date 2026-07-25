import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import {
  filterNonMutatingToolNames,
  isNonMutatingAgentTool,
} from '@/services/autopilot/runtime/copilot-tool-guard';
import { publishCopilotSuggestion } from '@/services/autopilot/runtime/copilot-suggestion';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

const httpSend = vi.fn();
const channel = vi.fn(() => ({ httpSend }));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({ channel }),
}));

function mcpCatalogItem(overrides: Partial<AgentToolCatalogItem>): AgentToolCatalogItem {
  return {
    name: 'mcp:isp:lookup' as AgentToolCatalogItem['name'],
    version: 'mcp',
    description: 'Consulta somente leitura em servidor MCP.',
    class: 'read_only',
    riskLevel: 'low',
    sideEffect: 'none',
    idempotent: true,
    timeoutMs: 15000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: [],
    requiredSlots: [],
    fallbackAction: 'drop',
    source: 'mcp',
    enabledByDefault: false,
    ...overrides,
  } as AgentToolCatalogItem;
}

describe('copilot suggestion tool guard', () => {
  it('keeps read-only Dialogy tools available so drafts are grounded in real data', () => {
    expect(isNonMutatingAgentTool('sgp_fetch_contracts')).toBe(true);
    expect(isNonMutatingAgentTool('sgp_fetch_contact_panel_data')).toBe(true);
  });

  it('blocks every tool that changes state before a human approves the draft', () => {
    expect(isNonMutatingAgentTool('transfer_chat')).toBe(false);
    expect(isNonMutatingAgentTool('close_chat')).toBe(false);
    expect(isNonMutatingAgentTool('crm_update_contact_custom_fields')).toBe(false);
    expect(isNonMutatingAgentTool('sgp_generate_invoice_pix')).toBe(false);
    expect(isNonMutatingAgentTool('sgp_create_payment_promise')).toBe(false);
    expect(isNonMutatingAgentTool('sgp_open_support_ticket')).toBe(false);
  });

  it('classifies MCP tools by their own safety profile', () => {
    const catalog = [
      mcpCatalogItem({}),
      mcpCatalogItem({
        name: 'mcp:isp:reboot_router' as AgentToolCatalogItem['name'],
        class: 'write_non_idempotent',
        riskLevel: 'high',
        sideEffect: 'high',
        requiresHumanApproval: true,
      }),
    ];

    expect(
      filterNonMutatingToolNames(['mcp:isp:lookup', 'mcp:isp:reboot_router'], catalog),
    ).toEqual(['mcp:isp:lookup']);
  });

  it('drops unknown tool names instead of assuming they are safe', () => {
    expect(isNonMutatingAgentTool('mcp:unknown:tool')).toBe(false);
  });
});

describe('publishCopilotSuggestion', () => {
  const clientQuery = vi.fn();
  const release = vi.fn();

  beforeEach(() => {
    clientQuery.mockReset();
    release.mockReset();
    httpSend.mockReset();
    channel.mockClear();
    vi.mocked(db.connect).mockReset();

    clientQuery.mockImplementation(async (query: string) => {
      if (query.includes('INSERT INTO public.autopilot_chat_suggestions')) {
        return {
          rows: [{
            id: 'suggestion-1',
            chat_id: 'chat-1',
            workspace_id: 'workspace-1',
            autopilot_config_id: 'config-1',
            system_agent_id: 'agent-1',
            source_message_id: 'message-1',
            orchestrator_run_id: 'run-1',
            stage: 'post_tool_response',
            suggestion: 'Sua fatura vence dia 10.',
            message_blocks: ['Sua fatura vence dia 10.', 'Quer o PIX agora?'],
            insights: { intent: 'billing_or_payment' },
            status: 'pending',
            created_at: '2026-07-25T12:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    });

    vi.mocked(db.connect).mockResolvedValue({
      query: clientQuery,
      release,
    } as never);
  });

  it('supersedes the previous draft so only one suggestion is live per chat', async () => {
    await publishCopilotSuggestion({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      autopilotConfigName: 'Dra. Roberta',
      systemAgentId: 'agent-1',
      sourceMessageId: 'message-1',
      orchestratorRunId: 'run-1',
      stage: 'post_tool_response',
      suggestion: 'Sua fatura vence dia 10.',
      messageBlocks: ['Sua fatura vence dia 10.', 'Quer o PIX agora?'],
      insights: { intent: 'billing_or_payment' },
    });

    const statements = clientQuery.mock.calls.map(([query]) => String(query));
    expect(statements.some((query) => query.includes("SET status = 'superseded'"))).toBe(true);
    expect(statements.some((query) => query.includes('INSERT INTO public.autopilot_chat_suggestions'))).toBe(true);
    expect(release).toHaveBeenCalled();
  });

  it('broadcasts the reasoning trail alongside the draft', async () => {
    await publishCopilotSuggestion({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      autopilotConfigName: 'Dra. Roberta',
      stage: 'post_tool_response',
      suggestion: 'Sua fatura vence dia 10.',
      messageBlocks: ['Sua fatura vence dia 10.', 'Quer o PIX agora?'],
      insights: {
        intent: 'billing_or_payment',
        intentConfidence: 0.82,
        toolsUsed: [{ name: 'sgp_fetch_contact_panel_data', status: 'success' }],
      },
    });

    expect(channel).toHaveBeenCalledWith('chat:chat-1');
    const [event, payload] = httpSend.mock.calls[0];
    expect(event).toBe('ai_suggestion');
    expect(payload).toMatchObject({
      chatId: 'chat-1',
      suggestion: 'Sua fatura vence dia 10.',
      // Legacy field kept so older inbox clients keep rendering during a rollout.
      configName: 'Dra. Roberta',
      agentName: 'Dra. Roberta',
      stage: 'post_tool_response',
      stageLabel: 'Consulta em sistemas',
      messageBlocks: ['Sua fatura vence dia 10.', 'Quer o PIX agora?'],
    });
    expect(payload.insights).toMatchObject({
      intent: 'billing_or_payment',
      intentConfidence: 0.82,
    });
  });

  it('still reaches the operator when persistence fails', async () => {
    vi.mocked(db.connect).mockRejectedValueOnce(new Error('database unavailable'));

    await publishCopilotSuggestion({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      autopilotConfigName: 'Dra. Roberta',
      stage: 'model_response',
      suggestion: 'Posso ajudar com mais alguma coisa?',
    });

    expect(httpSend).toHaveBeenCalledTimes(1);
    const [, payload] = httpSend.mock.calls[0];
    expect(payload.id).toBeNull();
    expect(payload.messageBlocks).toEqual(['Posso ajudar com mais alguma coisa?']);
  });

  it('ignores empty drafts instead of clearing the operator screen', async () => {
    await publishCopilotSuggestion({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      stage: 'model_response',
      suggestion: '   ',
    });

    expect(httpSend).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
  });
});
