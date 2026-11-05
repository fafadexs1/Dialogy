import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), enqueue: vi.fn(), discard: vi.fn(), access: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/queue', () => ({ enqueueAiAutopilotProcess: mocks.enqueue, shouldEnqueueJob: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }) }));
vi.mock('@/server/inbox/access', () => ({ requireChatAccess: mocks.access, requireWorkspaceAccess: mocks.access }));
vi.mock('@/services/autopilot/runtime/copilot-suggestion', () => ({ discardPendingCopilotSuggestions: mocks.discard, getPendingCopilotSuggestionForChat: vi.fn(), resolveCopilotSuggestion: vi.fn() }));
import { activateChatCopilot, requestCopilotSuggestion } from '@/actions/copilot';
const chat = { id: 'chat', workspace_id: 'workspace', status: 'atendimentos', is_autopilot_active: true, autopilot_config_id: 'agent', copilot_mode: 'suggest', assigned_system_agent_id: null };
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ ok: true }); mocks.enqueue.mockResolvedValue(undefined); });
describe('Copilot server actions', () => {
  it('queues the selected agent explicitly for a media message with no text', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [chat] }).mockResolvedValueOnce({ rows: [{ id: 'audio', content: '', instance_name: 'instance' }] });
    expect(await requestCopilotSuggestion('chat')).toEqual({ success: true });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'audio', suggestionRequest: { agentId: 'agent' } }));
    expect(mocks.query.mock.calls[1][1]).toEqual(['chat', 'workspace']);
  });
  it.each([{ copilot_mode: 'auto' }, { assigned_system_agent_id: 'autonomous' }, { is_autopilot_active: false }])('rejects a non-assisted conversation: %j', async (change) => {
    mocks.query.mockResolvedValue({ rows: [{ ...chat, ...change }] });
    expect((await requestCopilotSuggestion('chat')).success).toBe(false); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('denies access before reading any conversation data', async () => {
    mocks.access.mockResolvedValue({ ok: false, error: 'Sem acesso' });
    expect(await requestCopilotSuggestion('chat')).toEqual({ success: false, error: 'Sem acesso' });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('does not activate a copilot over an autonomous agent', async () => {
    mocks.query.mockResolvedValue({ rows: [{ ...chat, assigned_system_agent_id: 'autonomous' }] });
    expect((await activateChatCopilot('chat', 'agent')).success).toBe(false);
    expect(mocks.query).toHaveBeenCalledTimes(1); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
