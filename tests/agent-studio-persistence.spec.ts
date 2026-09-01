import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
import { createStudioSession } from '@/services/agent-studio/engine';
import { openStudioSession, sealStudioSession, studioSessionStore } from '@/services/agent-studio/session-store';
import { openMcpServerSecrets, sealMcpServerSecrets } from '@/services/mcp/secret-storage';
import { parseStudioSnapshot, loadStudioRelease, lockStudioDraft } from '@/services/agent-studio/repository';
import { createDefaultAgentStudioDocument } from '@/services/agent-studio/types';
import type { PoolClient } from 'pg';
import type { McpServerConfig } from '@/services/mcp/types';

const scope = { workspaceId: 'workspace', agentId: 'agent', chatId: 'chat', contextId: 'execution:node' };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('WORKSPACE_CREDENTIALS_ENCRYPTION_KEY', 'studio-test-key-at-least-32-characters'); });
afterEach(() => vi.unstubAllEnvs());

describe('Studio encrypted session and scoped persistence', () => {
  it('round trips typed values without storing personal values in plaintext', () => {
    const state = createStudioSession('agent', 'release', 'session'); state.values = { cpf: '52998224725', count: 0, ok: false };
    const sealed = sealStudioSession(scope, state);
    expect(sealed).not.toContain('52998224725'); expect(openStudioSession(scope, sealed)).toEqual(state);
  });
  it.each(['workspaceId', 'agentId', 'chatId', 'contextId'])('rejects decryption under a different %s', (field) => {
    const sealed = sealStudioSession(scope, createStudioSession('agent', 'release', 'session'));
    expect(() => openStudioSession({ ...scope, [field]: 'other' }, sealed)).toThrow();
  });
  it('rejects tampering and missing encryption key', () => {
    const sealed = sealStudioSession(scope, createStudioSession('agent', 'release', 'session'));
    const mutated = `${sealed[0] === '0' ? '1' : '0'}${sealed.slice(1)}`;
    expect(() => openStudioSession(scope, mutated)).toThrow();
    vi.stubEnv('WORKSPACE_CREDENTIALS_ENCRYPTION_KEY', ''); vi.stubEnv('META_PAYLOAD_ENCRYPTION_KEY', '');
    expect(() => sealStudioSession(scope, createStudioSession('agent', 'release', 'session'))).toThrow();
  });
  it('refuses conversations outside the workspace before creating a checkpoint', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(studioSessionStore(scope)).rejects.toThrow('workspace');
    expect(mocks.query.mock.calls[0][1]).toEqual(['chat', 'workspace']);
  });
  it.each([{ agentId: 'other', contextId: scope.contextId }, { agentId: scope.agentId, contextId: 'other' }])('does not take over another active context', async (owner) => {
    mocks.query.mockResolvedValue({ rows: [{ studio: { ...owner, status: 'waiting_input' } }] });
    await expect(studioSessionStore(scope)).rejects.toThrow('Outra execução');
  });
  it('reserves once using CAS and stores only an encrypted payload and safe summary', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ studio: null }] }).mockResolvedValue({ rows: [{ chat_id: 'chat' }] });
    const store = await studioSessionStore(scope); const state = createStudioSession('agent', 'release', 'session'); state.values = { cpf: '52998224725' };
    await store.checkpoint(state);
    const metadata = JSON.parse(mocks.query.mock.calls[1][1][3]);
    expect(metadata.revision).toBe(1); expect(JSON.stringify(metadata)).not.toContain('52998224725');
    expect(openStudioSession(scope, metadata.encrypted).values).toEqual(state.values);
    expect(mocks.query.mock.calls[1][0]).toContain('ON CONFLICT');
  });
  it('fails closed if another worker has advanced the checkpoint', async () => {
    const state = createStudioSession('agent', 'release', 'session');
    mocks.query.mockResolvedValueOnce({ rows: [{ studio: { agentId: 'agent', contextId: scope.contextId, revision: 2, encrypted: sealStudioSession(scope, state) } }] }).mockResolvedValue({ rows: [] });
    const store = await studioSessionStore(scope);
    await expect(store.checkpoint(state)).rejects.toThrow('outra execução');
  });
  it('preserves invalid drafts instead of silently replacing them', () => {
    expect(parseStudioSnapshot({})).toBeNull(); expect(() => parseStudioSnapshot({ agent_studio_document: { broken: true } })).toThrow('preservado');
  });
  it('loads only the fixed release in its workspace and never substitutes the latest version', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(loadStudioRelease('workspace', 'agent', 'fixed-release')).rejects.toThrow('fixada');
    expect(mocks.query.mock.calls[0][1]).toEqual(['workspace', 'agent', 'fixed-release']);
  });
  it('rejects concurrent draft edits under a row lock', async () => {
    const document = createDefaultAgentStudioDocument('agent', 'workspace'); document.draftRevision = 4;
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'agent' }] }).mockResolvedValueOnce({ rows: [{ snapshot: { agent_studio_document: document } }] }).mockResolvedValueOnce({ rows: [] });
    await expect(lockStudioDraft({ query } as unknown as PoolClient, 'workspace', 'agent', 3)).rejects.toThrow('outra aba');
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
  });
});

describe('MCP secret compatibility', () => {
  const server = { id: 'mcp', name: 'ERP', transport: 'streamable_http', url: 'https://erp.example/mcp', isActive: true, headers: { Authorization: 'Bearer test-secret' }, env: { TOKEN: 'local-secret' } } as McpServerConfig;
  it('seals secrets on save and restores them only for the same workspace/server', () => {
    const sealed = sealMcpServerSecrets('workspace', server);
    expect(JSON.stringify(sealed)).not.toContain('test-secret'); expect(JSON.stringify(sealed)).not.toContain('local-secret');
    expect(openMcpServerSecrets('workspace', sealed)).toEqual({ headers: server.headers, env: server.env });
    expect(() => openMcpServerSecrets('other', sealed)).toThrow('escopo');
    expect(() => openMcpServerSecrets('workspace', { ...sealed, id: 'other' })).toThrow('escopo');
  });
  it('reads legacy plaintext without rewriting user records', () => {
    expect(openMcpServerSecrets('workspace', { ...server })).toEqual({ headers: server.headers, env: server.env });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
