import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '@/lib/types';
const mocks = vi.hoisted(() => ({ query: vi.fn(), advisory: vi.fn(), autonomous: vi.fn(), selection: vi.fn(), release: vi.fn(),
  publish: vi.fn(), send: vi.fn(), completed: vi.fn(), unlock: vi.fn(), finish: vi.fn(), current: vi.fn(), config: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/lib/debug-file', () => ({ logToDebugFile: vi.fn() }));
vi.mock('@/lib/whatsapp/contact-identity', () => ({ resolveCanonicalWhatsappChatIdByIdentity: async () => 'chat' }));
vi.mock('@/lib/realtime/broadcast', () => ({ broadcastRealtimeEvent: vi.fn() }));
vi.mock('@/services/agent-studio/repository', () => ({ loadStudioRelease: mocks.release }));
vi.mock('@/services/agent-studio/release-selection', () => ({ selectStudioConversationRelease: mocks.selection }));
vi.mock('@/services/agent-studio/runtime', () => ({ runStudioConversation: mocks.autonomous }));
vi.mock('@/services/agent-studio/copilot', () => ({ runStudioCopilot: mocks.advisory }));
vi.mock('@/services/agent-studio/copilot-context', () => ({ loadStudioCopilotContext: async () => ({ history: [{ messageId: 'message', content: 'Olá', fromMe: false }], contact: {}, assertCurrent: mocks.current }) }));
vi.mock('@/services/autopilot/runtime/copilot-suggestion', () => ({ publishCopilotSuggestion: mocks.publish }));
vi.mock('@/services/autopilot/runtime/message-sender', () => ({ sendMultiBlockResponse: mocks.send }));
vi.mock('@/services/autopilot/runtime/media-analysis-context', () => ({ buildMediaAnalysisContext: async () => '' }));
vi.mock('@/services/autopilot/runtime/config-service', () => ({ getAutopilotConfigService: mocks.config }));
vi.mock('@/services/ai/model-selection', () => ({ resolveAutopilotModelFromCatalog: async () => ({ model: 'test', fallbackUsed: false }) }));
vi.mock('@/services/ai/decision-model-config', () => ({ getGlobalAiDecisionModelConfig: async () => ({}) }));
vi.mock('@/services/autopilot/runtime/chat-lease', () => ({ acquireAutopilotChatLease: async () => ({ status: 'acquired', release: mocks.unlock }),
  hasCompletedAutopilotSourceMessage: mocks.completed, AutopilotChatLeaseTimeoutError: Error }));
vi.mock('@/services/orchestrator/runtime', () => ({ startOrchestratorRun: async () => ({ id: 'run' }), finishOrchestratorRun: mocks.finish }));
import { processAutopilotForChat } from '@/services/autopilot/runtime/process-chat';
const chat = { id: 'chat', workspace_id: 'workspace', status: 'atendimentos',
  contact: { id: 'contact', workspace_id: 'workspace', name: 'Ana' }, messages: [], is_autopilot_active: true } as Chat;
let chatRow: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  chatRow = { workspace_id: 'workspace', status: 'atendimentos', copilot_mode: 'suggest', is_autopilot_active: true, autopilot_config_id: 'agent' };
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('sa.name AS assigned_system_agent_name') ? [chatRow] : [] }));
  mocks.config.mockResolvedValue({ config: { id: 'agent', workspace_id: 'workspace', is_active: true, name: 'Studio' }, rules: [] });
  mocks.release.mockResolvedValue({ releaseId: 'release', version: 2 });
  mocks.advisory.mockResolvedValue({ response: 'Rascunho', messageBlocks: ['Rascunho'], insights: { intent: 'support_request', summary: 'Contexto', studioReleaseId: 'release' } });
  mocks.unlock.mockResolvedValue(undefined);
});
describe('Inbox orchestrator routing to Studio copilot', () => {
  it('publishes advisory output without opening an autonomous session or delivering a customer message', async () => {
    await processAutopilotForChat('workspace', chat, 'Olá', 'instance', 'message');
    expect(mocks.advisory).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ stage: 'studio_copilot', suggestion: 'Rascunho',
      insights: expect.objectContaining({ contextMessageId: 'message', summary: 'Contexto' }) }));
    expect(mocks.selection).not.toHaveBeenCalled(); expect(mocks.autonomous).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.unlock).toHaveBeenCalledTimes(1);
  });
  it.each([{ copilot_mode: 'auto', assigned_system_agent_id: 'bot' }, { autopilot_config_id: 'another-agent' }])('drops queued manual suggestions after ownership/agent changes: %j', async (change) => {
    Object.assign(chatRow, change);
    await processAutopilotForChat('workspace', chat, 'Olá', 'instance', 'message', { agentId: 'agent' });
    expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.advisory).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('can regenerate manually even if an autonomous response already exists for the source', async () => {
    mocks.completed.mockResolvedValue(true);
    await processAutopilotForChat('workspace', chat, 'Olá', 'instance', 'message', { agentId: 'agent' });
    expect(mocks.completed).not.toHaveBeenCalled(); expect(mocks.advisory).toHaveBeenCalledTimes(1);
  });
  it('does not enter the autonomous runtime or legacy fallback when advisory generation fails', async () => {
    mocks.advisory.mockRejectedValue(new Error('provider unavailable'));
    await expect(processAutopilotForChat('workspace', chat, 'Olá', 'instance', 'message')).rejects.toThrow('provider unavailable');
    expect(mocks.selection).not.toHaveBeenCalled(); expect(mocks.autonomous).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    expect(mocks.unlock).toHaveBeenCalledTimes(1);
  });
});
