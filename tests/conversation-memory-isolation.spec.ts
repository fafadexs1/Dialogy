import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({ query: vi.fn(), summarize: vi.fn(), upsert: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/lib/embeddings', () => ({ DOCUMENT_EMBEDDING_MODEL: 'test', DOCUMENT_EMBEDDING_DIMENSIONS: 2,
  generateDocumentPassageEmbedding: async () => [0.1, 0.2] }));
vi.mock('@/lib/vector-store', () => ({ VectorStore: { upsertCaseMemory: mocks.upsert, deleteCaseMemoryByChatId: mocks.remove } }));
vi.mock('@/ai/flows/case-memory-summarization', () => ({ summarizeCaseMemory: mocks.summarize }));
vi.mock('@/services/ai/runtime', () => ({ resolveWorkspaceAiExecutionContext: async () => ({ model: 'test' }) }));

import { loadStudioConversationHistory } from '@/services/agent-studio/history';
import { loadCaseMemoryTranscript } from '@/services/rag/case-transcript';
import { refreshCaseMemoryForChat } from '@/services/rag/case-memory';

let sql: PGlite;
beforeAll(async () => {
  sql = new PGlite();
  mocks.query.mockImplementation((query: string, params?: unknown[]) => sql.query(query, params));
  await sql.exec(`CREATE TABLE chats (id text PRIMARY KEY, workspace_id text, contact_id text,
    autopilot_config_id text, close_reason_tag_id text, close_notes text, status text, closed_at text, source text);
    CREATE TABLE tags (id text PRIMARY KEY, workspace_id text, label text);
    CREATE TABLE messages (id text PRIMARY KEY, workspace_id text, chat_id text, content text,
      from_me boolean, type text, metadata jsonb, created_at int);`);
});
afterAll(async () => { await sql.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.summarize.mockResolvedValue({ shouldStore: true, summary: 'Acesso recuperado', problem: 'Falha de acesso',
    resolution: 'Recuperar o acesso pelo portal', outcome: 'Resolvido', keywords: ['acesso'] });
  await sql.exec(`TRUNCATE chats, messages, tags;
    INSERT INTO chats(id, workspace_id, contact_id, status, close_notes, close_reason_tag_id) VALUES
      ('chat-a','tenant-a','contact-a','encerrados','PRIVATE_CLOSE_NOTES','tag-b'),
      ('chat-b','tenant-a','contact-b','encerrados',NULL,NULL),
      ('chat-c','tenant-b','contact-c','encerrados',NULL,NULL);
    INSERT INTO tags VALUES ('tag-b','tenant-b','PRIVATE_OTHER_TENANT_TAG');
    INSERT INTO messages SELECT 'm-' || lpad(i::text,3,'0'),'tenant-a','chat-a',
      'public-turn-' || i, i % 2 = 0,'text','{}',i FROM generate_series(1,130) i;
    INSERT INTO messages VALUES
      ('note','tenant-a','chat-a','PRIVATE_NOTE',true,'text','{"isInternalNote":true}',131),
      ('system','tenant-a','chat-a','PRIVATE_SYSTEM',true,'system','{}',132),
      ('foreign-chat','tenant-a','chat-b','PRIVATE_OTHER_CHAT',false,'text','{}',133),
      ('foreign-tenant','tenant-b','chat-a','PRIVATE_OTHER_TENANT',false,'text','{}',134),
      ('final','tenant-a','chat-a','Acesso recuperado e confirmado pelo cliente.',false,'text','{}',135);`);
});

describe('conversation memory SQL boundaries', () => {
  it('keeps the latest 120 public turns including the resolution, in chronological order', async () => {
    const transcript = await loadCaseMemoryTranscript('tenant-a', 'chat-a');
    expect(transcript.split('\n')).toHaveLength(120);
    expect(transcript).toMatch(/^Agente: public-turn-12\n/);
    expect(transcript).toMatch(/Cliente: Acesso recuperado e confirmado pelo cliente\.$/);
    expect(transcript).not.toContain('PRIVATE_');
  });
  it('rejects a chat from another tenant', async () => {
    expect(await loadCaseMemoryTranscript('tenant-b', 'chat-a')).toBe('');
    expect(await loadStudioConversationHistory('tenant-b', 'chat-a', 'final')).toBe('');
  });
  it('keeps Studio history in its own chat and strictly before its source message', async () => {
    const history = await loadStudioConversationHistory('tenant-a', 'chat-a', 'm-100');
    expect(history.split('\n')).toHaveLength(80);
    expect(history).toMatch(/^Agente: public-turn-20\n/);
    expect(history).toMatch(/Cliente: public-turn-99$/);
    expect(history).not.toContain('PRIVATE_');
    expect(await loadStudioConversationHistory('tenant-a', 'chat-a', 'foreign-chat')).toBe('');
    const latest = await loadStudioConversationHistory('tenant-a', 'chat-a', 'final');
    expect(latest).not.toContain('PRIVATE_');
  });
  it('does not send internal closing notes or foreign tag data to the summary model', async () => {
    await refreshCaseMemoryForChat({ workspaceId: 'tenant-a', chatId: 'chat-a' });
    expect(mocks.summarize).toHaveBeenCalledOnce();
    const input = mocks.summarize.mock.calls[0][0];
    expect(input).not.toHaveProperty('closeNotes');
    expect(input).not.toHaveProperty('contactName');
    expect(JSON.stringify(input)).not.toContain('PRIVATE_');
    expect(input.chatHistory).toContain('Acesso recuperado e confirmado');
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'tenant-a', chatId: 'chat-a' }));
  });
  it('does not generate or persist a case outside its workspace', async () => {
    await refreshCaseMemoryForChat({ workspaceId: 'tenant-b', chatId: 'chat-a' });
    expect(mocks.summarize).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
