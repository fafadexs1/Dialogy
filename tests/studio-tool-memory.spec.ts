import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const bridge = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: bridge.query } }));
import { readStudioToolMemory, readStudioToolMemoryContent, readStudioToolMemoryReset, writeStudioToolMemory, deleteStudioToolMemory, purgeExpiredStudioToolMemory } from '@/services/agent-studio/tool-memory-store';
import { safeCompleteObservationResult } from '@/services/agent-studio/flow-execution';
import { encryptWithKey } from '@/lib/security/secret-box';

const scope = { workspaceId: '00000000-0000-4000-8000-000000000001', contactId: '00000000-0000-4000-8000-000000000002', agentId: '00000000-0000-4000-8000-000000000003', releaseId: '00000000-0000-4000-8000-000000000004' };
const otherContact = '00000000-0000-4000-8000-000000000005';
const toolKey = 'a'.repeat(64);
const allowed = new Map([[toolKey, 'mcp__calendar']]);
const observation = { name: 'mcp__calendar', observedAt: '2026-11-04T10:00:00.000Z', result: { status: 'completed' as const, response: '', data: { title: 'Private event' } } };
let sql: PGlite;
beforeAll(async () => {
  sql = new PGlite(); bridge.query.mockImplementation((query: string, params?: unknown[]) => sql.query(query, params));
  await sql.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY); CREATE TABLE contacts(id uuid PRIMARY KEY, workspace_id uuid NOT NULL);
    CREATE TABLE autopilot_configs(id uuid PRIMARY KEY, workspace_id uuid NOT NULL);`);
  await sql.exec(await readFile('prisma/migrations/20261104120000_studio_tool_memory/migration.sql', 'utf8'));
  await sql.exec(await readFile('prisma/migrations/20261104131000_studio_tool_memory_resets/migration.sql', 'utf8'));
  await sql.exec(await readFile('prisma/migrations/20261104130000_studio_tool_memory_history_index/migration.sql', 'utf8'));
  await sql.exec(await readFile('prisma/migrations/20261104132000_studio_tool_memory_content/migration.sql', 'utf8'));
  await sql.query('INSERT INTO workspaces VALUES($1);', [scope.workspaceId]);
  await sql.query('INSERT INTO contacts VALUES($1,$3),($2,$3)', [scope.contactId, otherContact, scope.workspaceId]);
  await sql.query('INSERT INTO autopilot_configs VALUES($1,$2)', [scope.agentId, scope.workspaceId]);
}, 30000);
beforeEach(async () => { vi.stubEnv('WORKSPACE_CREDENTIALS_ENCRYPTION_KEY', 'isolated-memory-key-with-32-characters'); vi.stubEnv('STUDIO_TOOL_MEMORY_RETENTION_DAYS', '30'); vi.stubEnv('STUDIO_TOOL_MEMORY_MAX_PER_TOOL', '100'); await sql.exec('TRUNCATE studio_tool_memory_content, studio_tool_memory, studio_tool_memory_resets'); });
afterAll(async () => { await sql.close(); vi.unstubAllEnvs(); });
describe('persistent encrypted tool memory', () => {
  it('preserves legacy encrypted observations without claiming missing pages exist', async () => {
    const id = 'c'.repeat(64);
    const encrypted = encryptWithKey(JSON.stringify({ ...scope, toolKey, observation }), process.env.WORKSPACE_CREDENTIALS_ENCRYPTION_KEY, 'WORKSPACE_CREDENTIALS_ENCRYPTION_KEY');
    await sql.query('INSERT INTO studio_tool_memory(workspace_id,contact_id,agent_id,release_id,tool_key,observation_id,encrypted,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [scope.workspaceId,scope.contactId,scope.agentId,scope.releaseId,toolKey,id,encrypted,observation.observedAt]);
    const [saved] = await readStudioToolMemory(scope, allowed);
    expect(saved).toMatchObject(observation); expect(saved.content).toBeUndefined();
    expect(await readStudioToolMemoryContent(scope, toolKey, id, 0)).toBeNull();
  });
  it('survives a new invocation or release only for the same contact, agent and currently active connection identity', async () => {
    await writeStudioToolMemory(scope, toolKey, observation);
    expect((await sql.query<{ encrypted: string }>('SELECT encrypted FROM studio_tool_memory')).rows[0].encrypted).not.toContain('Private event');
    expect(await readStudioToolMemory(scope, allowed)).toMatchObject([observation]);
    expect(await readStudioToolMemory({ ...scope, contactId: otherContact }, allowed)).toEqual([]);
    expect(await readStudioToolMemory({ ...scope, workspaceId: otherContact }, allowed)).toEqual([]);
    expect(await readStudioToolMemory({ ...scope, agentId: otherContact }, allowed)).toEqual([]);
    expect(await readStudioToolMemory({ ...scope, releaseId: otherContact }, allowed)).toMatchObject([observation]);
    expect(await readStudioToolMemory(scope, new Map())).toEqual([]);
    expect(await readStudioToolMemory(scope, new Map([['b'.repeat(64), 'mcp__calendar']]))).toEqual([]);
    await expect(readStudioToolMemory(scope, new Map([[toolKey, 'different']]))).rejects.toThrow('escopo autorizado');
  });
  it('keeps observations in time order even when requests complete out of order, deduplicates retries and supports deletion', async () => {
    await writeStudioToolMemory(scope, toolKey, observation);
    const older = { ...observation, observedAt: '2026-11-03T10:00:00.000Z', result: { ...observation.result, data: { stale: true } } };
    await writeStudioToolMemory(scope, toolKey, older);
    await writeStudioToolMemory(scope, toolKey, older);
    expect(await readStudioToolMemory(scope, allowed)).toMatchObject([older, observation]);
    await deleteStudioToolMemory(scope); expect(await readStudioToolMemory(scope, allowed)).toEqual([]);
  });
  it('revokes direct browser roles and deletes memory with the contact', async () => {
    await writeStudioToolMemory(scope, toolKey, observation);
    const privileges = await sql.query<{ permitted: boolean }>("SELECT has_table_privilege('authenticated', 'studio_tool_memory', 'SELECT') AS permitted");
    expect(privileges.rows[0].permitted).toBe(false);
    await sql.query('DELETE FROM contacts WHERE id=$1', [scope.contactId]);
    expect(await readStudioToolMemory(scope, allowed)).toEqual([]);
    await sql.query('INSERT INTO contacts VALUES($1,$2)', [scope.contactId, scope.workspaceId]);
  });
  it('does not stop the agent when the migration is not installed yet', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.query.mockRejectedValueOnce(Object.assign(new Error('missing table'), { code: '42P01' }));
    expect(await readStudioToolMemory(scope, allowed)).toEqual([]);
    bridge.query.mockRejectedValueOnce(Object.assign(new Error('missing table'), { code: '42P01' }));
    await expect(writeStudioToolMemory(scope, toolKey, observation)).rejects.toThrow('Migração de memória completa pendente');
    warning.mockRestore();
  });
  it('refuses expired results, bounds each connection to 100 and enforces database workspace membership', async () => {
    const expired = { ...observation, observedAt: new Date(Date.now() - 31 * 86400000).toISOString() };
    await writeStudioToolMemory(scope, toolKey, expired);
    expect((await sql.query('SELECT 1 FROM studio_tool_memory')).rows).toHaveLength(0);
    await writeStudioToolMemory({ ...scope, workspaceId: otherContact }, toolKey, observation);
    expect((await sql.query('SELECT 1 FROM studio_tool_memory')).rows).toHaveLength(0);
    for (let i = 0; i < 105; i++) await writeStudioToolMemory(scope, toolKey, { ...observation, observedAt: new Date(Date.now() - i * 1000).toISOString(), result: { ...observation.result, data: { i } } });
    expect((await sql.query('SELECT 1 FROM studio_tool_memory')).rows).toHaveLength(100);
    await sql.exec("UPDATE studio_tool_memory SET observed_at = now() - interval '31 days'");
    expect(await readStudioToolMemory(scope, allowed)).toEqual([]);
    await purgeExpiredStudioToolMemory();
    expect((await sql.query('SELECT 1 FROM studio_tool_memory')).rows).toHaveLength(0);
  });
  it('can preserve older observations indefinitely when retention limits are disabled', async () => {
    vi.stubEnv('STUDIO_TOOL_MEMORY_RETENTION_DAYS', '0');
    vi.stubEnv('STUDIO_TOOL_MEMORY_MAX_PER_TOOL', '0');
    const older = { ...observation, observedAt: new Date(Date.now() - 90 * 86400000).toISOString() };
    await writeStudioToolMemory(scope, toolKey, older);
    await purgeExpiredStudioToolMemory();
    expect(await readStudioToolMemory(scope, allowed)).toMatchObject([older]);
  });
  it('pages through older authorized observations without crossing contact or tool scope', async () => {
    const now = Date.now();
    for (let i = 0; i < 4; i++) await writeStudioToolMemory(scope, toolKey, { ...observation, observedAt: new Date(now - i * 1000).toISOString(), result: { ...observation.result, data: { index: i } } });
    const first = await readStudioToolMemory(scope, allowed, { offset: 0, limit: 2 });
    const second = await readStudioToolMemory(scope, allowed, { offset: 2, limit: 2 });
    expect(first.map((item) => item.result.data.index)).toEqual([1, 0]);
    expect(second.map((item) => item.result.data.index)).toEqual([3, 2]);
    expect(await readStudioToolMemory({ ...scope, contactId: otherContact }, allowed, { offset: 2, limit: 2 })).toEqual([]);
  });
  it('blocks results predating contact or workspace clearing, including a late completion', async () => {
    await writeStudioToolMemory(scope, toolKey, observation);
    await writeStudioToolMemory({ ...scope, contactId: otherContact }, toolKey, observation);
    await sql.query('INSERT INTO studio_tool_memory_resets(workspace_id,scope_key,cleared_at) VALUES($1,$2,$3)', [scope.workspaceId, `contact:${scope.contactId}`, '2026-11-04T10:30:00.000Z']);
    expect(await readStudioToolMemory(scope, allowed)).toEqual([]);
    expect(await readStudioToolMemory({ ...scope, contactId: otherContact }, allowed)).toMatchObject([observation]);
    await sql.query('UPDATE studio_tool_memory SET observed_at=$2 WHERE contact_id=$1', [scope.contactId, '2099-01-01T00:00:00.000Z']);
    await writeStudioToolMemory(scope, toolKey, { ...observation, observedAt: '2099-01-01T00:00:00.000Z' });
    expect(await readStudioToolMemory(scope, allowed)).toEqual([]);
    const generation = await readStudioToolMemoryReset(scope.workspaceId, scope.contactId);
    const newer = { ...observation, observedAt: '2026-11-04T09:00:00.000Z', sourceReset: generation };
    await writeStudioToolMemory(scope, toolKey, newer);
    expect(await readStudioToolMemory(scope, allowed)).toMatchObject([newer]);
    expect(await readStudioToolMemory(scope, allowed, { limit: 1 })).toMatchObject([newer]);
    await writeStudioToolMemory(scope, toolKey, { ...observation, observedAt: '2099-11-04T11:00:00.000Z' });
    expect(await readStudioToolMemory(scope, allowed)).toMatchObject([newer]);
    await sql.query('INSERT INTO studio_tool_memory_resets(workspace_id,scope_key,cleared_at) VALUES($1,$2,$3)', [scope.workspaceId, 'workspace', '2026-11-04T12:00:00.000Z']);
    expect(await readStudioToolMemory(scope, allowed)).toEqual([]);
    expect(await readStudioToolMemory({ ...scope, contactId: otherContact }, allowed)).toEqual([]);
  });
  it('stores a bounded preview instead of failing the completed tool on an oversized result', async () => {
    const large = { ...observation, result: { ...observation.result, response: '😀'.repeat(12000), data: { text: 'á'.repeat(12000) } } };
    await writeStudioToolMemory(scope, toolKey, large);
    const [saved] = await readStudioToolMemory(scope, allowed);
    expect(saved.result.data.omitted).toContain('páginas');
    expect(Buffer.byteLength(saved.result.response)).toBeLessThanOrEqual(3003);
  });
  it('reconstructs complete redacted responses across Unicode page boundaries and denies stale scope', async () => {
    const prefix = '{"status":"completed","response":"","data":{"text":"';
    const text = 'A'.repeat(2999 - prefix.length) + '😀ação' + 'z'.repeat(10000) + 'fim';
    const complete = safeCompleteObservationResult({ status: 'completed', response: '', data: { text, list: Array.from({ length: 100 }, (_, i) => ({ i })), password: 'do-not-store', note: 'Bearer private-token' } });
    await writeStudioToolMemory(scope, toolKey, { ...observation, result: complete });
    const [saved] = await readStudioToolMemory(scope, allowed);
    const encryptedPages = await sql.query<{ encrypted: string }>('SELECT encrypted FROM studio_tool_memory_content');
    expect(encryptedPages.rows.every((row) => !row.encrypted.includes('private-token') && !row.encrypted.includes('ação'))).toBe(true);
    expect(saved.content!.pages).toBeGreaterThan(3);
    let json = '';
    for (let page = 0; page < saved.content!.pages; page++) {
      const part = await readStudioToolMemoryContent(scope, toolKey, saved.content!.id, page);
      expect(part?.content.length).toBeLessThanOrEqual(3000); json += part!.content;
      if (page === 0) expect(part!.content.length).toBe(2999);
    }
    expect(JSON.parse(json)).toMatchObject({ data: { text, list: Array.from({ length: 100 }, (_, i) => ({ i })), password: '[protegido]', note: 'Bearer [protegido]' } });
    expect(json).not.toContain('do-not-store'); expect(json).not.toContain('private-token');
    expect(await readStudioToolMemoryContent({ ...scope, contactId: otherContact }, toolKey, saved.content!.id, 0)).toBeNull();
    expect(await readStudioToolMemoryContent(scope, 'b'.repeat(64), saved.content!.id, 0)).toBeNull();
    await sql.query('INSERT INTO studio_tool_memory_resets(workspace_id,scope_key) VALUES($1,$2)', [scope.workspaceId, `contact:${scope.contactId}`]);
    expect(await readStudioToolMemoryContent(scope, toolKey, saved.content!.id, 0)).toBeNull();
  });
  it('discards a content page if memory is cleared while it is being read', async () => {
    await writeStudioToolMemory(scope, toolKey, observation);
    const [saved] = await readStudioToolMemory(scope, allowed);
    bridge.query.mockImplementation(async (query: string, params?: unknown[]) => {
      const result = await sql.query(query, params);
      if (query.includes('SELECT c.encrypted')) await sql.query('INSERT INTO studio_tool_memory_resets(workspace_id,scope_key) VALUES($1,$2)', [scope.workspaceId, `contact:${scope.contactId}`]);
      return result;
    });
    try { expect(await readStudioToolMemoryContent(scope, toolKey, saved.content!.id, 0)).toBeNull(); }
    finally { bridge.query.mockImplementation((query: string, params?: unknown[]) => sql.query(query, params)); }
  });
  it('stores and serves a maximum-size HTTP text response in bounded pages', async () => {
    const text = 'A'.repeat(9_999_900) + 'FIM';
    await writeStudioToolMemory(scope, toolKey, { ...observation, result: { status: 'completed', response: '', data: { text } } });
    const [saved] = await readStudioToolMemory(scope, allowed);
    expect(saved.content!.pages).toBeGreaterThan(3000);
    const first = await readStudioToolMemoryContent(scope, toolKey, saved.content!.id, 0);
    const last = await readStudioToolMemoryContent(scope, toolKey, saved.content!.id, saved.content!.pages - 1);
    expect(first?.content.length).toBeLessThanOrEqual(3000);
    expect(last?.content).toContain('FIM'); expect(last?.nextPage).toBeNull();
  }, 120000);
});
