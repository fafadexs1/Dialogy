import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, type AgentReleaseManifest } from '@/services/agent-studio/types';
import type { Contact } from '@/lib/types';
const mocks = vi.hoisted(() => ({ model: vi.fn(), rag: vi.fn(), query: vi.fn() }));
vi.mock('@/services/ai/platform-json', () => ({ requestPlatformJson: mocks.model }));
vi.mock('@/services/ai/platform-config', () => ({ platformModel: async () => ({ id: 'openai/test' }) }));
vi.mock('@/services/rag/hybrid-retrieval', () => ({ retrieveHybridSupportContext: mocks.rag }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
import { runStudioCopilot } from '@/services/agent-studio/copilot';
import { loadStudioCopilotContext } from '@/services/agent-studio/copilot-context';

const plan = { intent: 'support_request', summary: 'Cliente já reiniciou o equipamento e pede diagnóstico.', queries: ['conexão instável'], procedureIds: ['support'] };
const draft = { summary: plan.summary, messageBlocks: ['Entendi que já reiniciou. A falha ocorre também pelo cabo?'], sourceIds: ['kb'], missingInformation: ['Teste pelo cabo'], cautions: [],
  nextSteps: [{ procedureId: 'support', stepId: 'lookup', reason: 'Verificar a conexão após o teste.' }] };
function fixture() {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.resolveStage.knowledgeCollectionIds = ['kb'];
  const procedure = ProcedureDocumentSchema.parse({ id: 'support', name: 'Diagnóstico', status: 'published', updatedAt: '2026-09-19',
    steps: [{ id: 'lookup', order: 1, type: 'http_request', title: 'Consultar conexão', nativeActionPayload: { secret: 'DO_NOT_EXPOSE' } }] });
  const release: AgentReleaseManifest = { releaseId: 'release', agentId: 'agent', workspaceId: 'workspace', version: 3,
    agentSnapshot: document, publishedProcedures: [procedure], referencedConnectionIds: [], mcpServerToolFingerprints: {}, createdAt: '2026-09-19',
    knowledgeSnapshot: [{ id: 'kb', name: 'Suporte', content: 'Teste também pelo cabo.' }, { id: 'foreign', name: 'Privado', content: 'FORBIDDEN' }] };
  return { release, workspaceId: 'workspace', agentId: 'agent', chatId: 'chat', message: 'E agora?', contact: { name: 'Ana' } as Contact,
    history: [{ content: 'Já reiniciei e não resolveu.', fromMe: false, messageId: 'm1' }], assertCurrent: vi.fn().mockResolvedValue(undefined) };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.model.mockReset(); mocks.rag.mockReset(); mocks.query.mockReset();
  mocks.model.mockResolvedValueOnce(plan).mockResolvedValueOnce(draft);
  mocks.rag.mockResolvedValue({ knowledgeBaseDocuments: [{ id: 'kb', content: 'MUTABLE_INDEX_CONTENT' }, { id: 'foreign', content: 'FORBIDDEN' }] });
});
describe('Studio advisory copilot', () => {
  it('plans from history, retrieves published evidence and produces a separate draft and operator guidance', async () => {
    const input = fixture(); const unchanged = structuredClone(input.release);
    const result = await runStudioCopilot(input);
    expect(result.response).toBe(draft.messageBlocks[0]);
    expect(result.insights).toMatchObject({ summary: plan.summary, studioReleaseId: 'release', studioVersion: 3,
      knowledgeSources: [{ id: 'kb', name: 'Suporte' }], recommendedActions: [{ label: 'Diagnóstico: Consultar conexão' }] });
    expect(mocks.rag).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', autopilotConfigId: 'agent', chatId: 'chat', allowedDocumentIds: ['kb'] }));
    const request = mocks.model.mock.calls[1][0];
    expect(request.userPrompt).toContain('Já reiniciei');
    expect(request.userPrompt).toContain('Teste também pelo cabo.');
    for (const text of ['MUTABLE_INDEX_CONTENT', 'FORBIDDEN', 'DO_NOT_EXPOSE']) expect(request.userPrompt).not.toContain(text);
    expect(input.release).toEqual(unchanged);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('rejects cross-workspace releases before the model or retrieval', async () => {
    const input = fixture(); input.workspaceId = 'other';
    await expect(runStudioCopilot(input)).rejects.toThrow('fora do escopo');
    expect(mocks.model).not.toHaveBeenCalled(); expect(mocks.rag).not.toHaveBeenCalled();
  });
  it('removes invented citations and nonexistent recommended actions', async () => {
    mocks.model.mockReset().mockResolvedValueOnce(plan).mockResolvedValueOnce({ ...draft, sourceIds: ['invented'],
      nextSteps: [{ procedureId: 'support', stepId: 'invented', reason: 'bad' }] });
    const result = await runStudioCopilot(fixture());
    expect(result.insights.knowledgeSources).toEqual([]); expect(result.insights.recommendedActions).toEqual([]);
    expect(result.insights.knowledgeCoverage).toBe('insufficient');
  });
  it('does not search or claim sources when the publication has no authorized knowledge', async () => {
    const input = fixture(); input.release.agentSnapshot.resolveStage.knowledgeCollectionIds = [];
    const result = await runStudioCopilot(input);
    expect(mocks.rag).not.toHaveBeenCalled(); expect(result.insights.knowledgeSources).toEqual([]);
  });
  it('surfaces retrieval failure without pretending to have consulted a source', async () => {
    mocks.rag.mockRejectedValue(new Error('retrieval offline'));
    const result = await runStudioCopilot(fixture());
    expect(result.insights.cautions?.[0]).toContain('busca na base falhou');
    expect(result.insights.knowledgeSources).toEqual([]);
  });
  it('refuses empty or malformed drafts instead of sending a fallback', async () => {
    mocks.model.mockReset().mockResolvedValueOnce(plan).mockResolvedValueOnce({ ...draft, messageBlocks: ['  '] });
    await expect(runStudioCopilot(fixture())).rejects.toThrow();
  });
  it('stops between planning and drafting when the conversation changes', async () => {
    const input = fixture(); input.assertCurrent.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('superseded'));
    await expect(runStudioCopilot(input)).rejects.toThrow('superseded');
    expect(mocks.model).toHaveBeenCalledTimes(1); expect(mocks.rag).not.toHaveBeenCalled();
  });
  it('rechecks after model output so a deactivated copilot cannot publish it', async () => {
    const input = fixture();
    mocks.model.mockReset().mockResolvedValueOnce(plan).mockImplementationOnce(async () => {
      input.assertCurrent.mockRejectedValue(new Error('disabled')); return draft;
    });
    await expect(runStudioCopilot(input)).rejects.toThrow('disabled');
  });
  it('honors cancellation before calling a model', async () => {
    await expect(runStudioCopilot({ ...fixture(), signal: AbortSignal.abort() })).rejects.toThrow();
    expect(mocks.model).not.toHaveBeenCalled();
  });
});
describe('Copilot conversation context', () => {
  it('loads chronological history and revalidates tenant, agent, mode and the newest visible message', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'outbound', content: 'Teste pelo cabo', from_me: true }, { id: 'inbound', content: 'Transcrição', from_me: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'contact', name: 'Ana' }] }).mockResolvedValue({ rows: [{ id: 'chat' }] });
    const context = await loadStudioCopilotContext({ workspaceId: 'workspace', chatId: 'chat', agentId: 'agent', messageId: 'inbound' });
    expect(context.history.map((turn) => turn.messageId)).toEqual(['inbound', 'outbound']);
    expect(mocks.query.mock.calls[0][0]).toContain("m.metadata->>'isInternalNote'");
    expect(mocks.query.mock.calls[0][0]).toContain('m.transcription');
    expect(mocks.query.mock.calls[2][1]).toEqual(['chat', 'workspace', 'agent', 'inbound', 'outbound']);
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(context.assertCurrent()).rejects.toMatchObject({ code: 'AUTOPILOT_SOURCE_SUPERSEDED' });
  });
});
