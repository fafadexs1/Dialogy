import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), connect: vi.fn(), fetch: vi.fn(), access: vi.fn(), permission: vi.fn(), canEdit: vi.fn(), limit: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query, connect: mocks.connect } }));
vi.mock('@/lib/whatsapp/evolution-api-client', () => ({ fetchEvolutionAPI: mocks.fetch }));
vi.mock('@/lib/security/access', () => ({ requireWorkspaceAccess: mocks.access, requireWorkspacePermission: mocks.permission }));
vi.mock('@/lib/workspace-permissions', () => ({ hasWorkspacePermission: mocks.canEdit }));
vi.mock('@/lib/billing-logic', () => ({ checkLimit: mocks.limit }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/services/telegram/bot-api', () => ({
  buildTelegramWebhookUrl: vi.fn(), deleteTelegramWebhook: vi.fn(), getTelegramWebhookInfo: vi.fn(),
  normalizeTelegramBotToken: vi.fn(), setTelegramWebhook: vi.fn(), validateTelegramBotToken: vi.fn(),
}));

import { buildEvolutionWebhookUrl } from '@/lib/whatsapp/evolution-config';
import { buildEvolutionWebhookConfig, configureEvolutionInstanceWebhook } from '@/services/whatsapp/evolution-webhook-config';
import { createEvolutionApiInstance, getEvolutionApiInstances, reconfigureEvolutionWebhook } from '@/actions/evolution-api';

const webhookUrl = 'https://dialogy.example/api/webhooks/evolution/secret-key';
const apiConfig = { api_url: 'https://evolution.example', api_key: 'private-api-key' };
const instance = { instance_name: 'zap1', webhook_key: 'secret-key', ...apiConfig };
const confirmedWebhook = () => ({ ...buildEvolutionWebhookConfig(webhookUrl), webhookByEvents: false });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXTAUTH_URL', 'https://dialogy.example');
  vi.stubEnv('EVOLUTION_WEBHOOK_BASE_URL', '');
  mocks.limit.mockResolvedValue({ allowed: true, limit: 10, plan: 'pro' });
  mocks.access.mockResolvedValue({ id: 'user-1' });
  mocks.permission.mockResolvedValue({ id: 'user-1' });
  mocks.canEdit.mockResolvedValue(true);
  mocks.query.mockResolvedValue({ rows: [instance], rowCount: 1 });
  mocks.fetch.mockResolvedValue(confirmedWebhook());
});
afterEach(() => vi.unstubAllEnvs());

describe('Evolution webhook URL', () => {
  it('uses the server URL and escapes legacy identifiers as one path segment', () => {
    vi.stubEnv('NEXTAUTH_URL', ' https://dialogy.example/ ');
    expect(buildEvolutionWebhookUrl('zap/1?x=2')).toBe('https://dialogy.example/api/webhooks/evolution/zap%2F1%3Fx%3D2');
  });

  it('keeps the public webhook address independent from local auth URLs', () => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:9002');
    vi.stubEnv('EVOLUTION_WEBHOOK_BASE_URL', 'https://dialogy.example');
    expect(buildEvolutionWebhookUrl('secret-key')).toBe(webhookUrl);
  });

  it.each(['', 'invalid-url', 'ftp://dialogy.example', 'https://user:secret@dialogy.example', 'https://dialogy.example?next=x', 'https://dialogy.example#x', 'http://localhost:9002', 'http://127.0.0.1:9002', 'http://[::1]:9002'])('rejects an invalid public base: %s', (base) => {
    vi.stubEnv('NEXTAUTH_URL', base);
    expect(() => buildEvolutionWebhookUrl('secret-key')).toThrow();
  });
});

describe('webhook visibility and authorization', () => {
  beforeEach(() => {
    mocks.query.mockResolvedValue({ rows: [{ ...instance, id: 'instance-1', type: 'baileys', webhook_url: webhookUrl }], rowCount: 1 });
  });

  it('returns the canonical copyable link to integration managers without exposing the raw key', async () => {
    const result = await getEvolutionApiInstances('workspace-1');
    expect(mocks.canEdit).toHaveBeenCalledWith('user-1', 'workspace-1', 'workspace:settings:edit');
    expect(result.canManageWebhooks).toBe(true);
    expect(result.instances?.[0]).toMatchObject({ webhook_url: webhookUrl, webhook_needs_sync: false });
    expect(result.instances?.[0]).not.toHaveProperty('webhook_key');
  });

  it('does not expose webhook credentials to read-only members', async () => {
    mocks.canEdit.mockResolvedValue(false);
    const result = await getEvolutionApiInstances('workspace-1');
    expect(result.canManageWebhooks).toBe(false);
    expect(result.instances?.[0]).not.toHaveProperty('webhook_url');
    expect(result.instances?.[0]).not.toHaveProperty('webhook_key');
  });

  it('shows the current URL and flags a stored URL from the old domain', async () => {
    mocks.query.mockResolvedValue({ rows: [{ ...instance, webhook_url: 'https://old.example/webhook' }], rowCount: 1 });
    expect((await getEvolutionApiInstances('workspace-1')).instances?.[0]).toMatchObject({ webhook_url: webhookUrl, webhook_needs_sync: true });
  });

  it('keeps the instance listing usable when the public server URL is missing', async () => {
    vi.stubEnv('NEXTAUTH_URL', '');
    const result = await getEvolutionApiInstances('workspace-1');
    expect(result.error).toBeUndefined();
    expect(result.instances?.[0]).toMatchObject({ webhook_url: webhookUrl, webhook_configuration_error: expect.stringContaining('NEXTAUTH_URL') });
  });

  it('denies repair before querying instance data or contacting Evolution', async () => {
    mocks.permission.mockRejectedValue(new Error('forbidden'));
    expect((await reconfigureEvolutionWebhook('instance-1', 'workspace-2')).success).toBe(false);
    expect(mocks.permission).toHaveBeenCalledWith('workspace-2', 'workspace:settings:edit');
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('repairing delivery configuration', () => {
  it('activates the webhook, preserves authentication/media settings, confirms and saves without reconnecting', async () => {
    mocks.fetch.mockResolvedValueOnce({ enabled: false, headers: { Authorization: 'private-header' }, webhookBase64: true });
    const result = await reconfigureEvolutionWebhook('instance-1', 'workspace-1');
    expect(result).toEqual({ success: true, webhookUrl });
    expect(mocks.fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual(['/webhook/find/zap1', '/webhook/set/zap1', '/webhook/find/zap1']);
    const posted = JSON.parse(mocks.fetch.mock.calls[1][2].body).webhook;
    expect(posted).toMatchObject({ enabled: true, url: webhookUrl, byEvents: false, base64: true, headers: { Authorization: 'private-header' } });
    expect(posted.events).toEqual(expect.arrayContaining(['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE']));
    expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('SET webhook_url = $3'), ['instance-1', 'workspace-1', webhookUrl]);
    expect(JSON.stringify(result)).not.toContain('private-header');
    expect(JSON.stringify(result)).not.toContain('private-api-key');
  });

  it.each([
    { enabled: false }, { url: 'https://old.example/webhook' }, { webhookByEvents: true }, { events: ['CONNECTION_UPDATE'] },
  ])('does not claim success when remote verification differs: %j', async (changes) => {
    mocks.fetch.mockResolvedValueOnce(null).mockResolvedValueOnce({}).mockResolvedValueOnce({ ...confirmedWebhook(), ...changes });
    expect((await reconfigureEvolutionWebhook('instance-1', 'workspace-1')).success).toBe(false);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('SET webhook_url'))).toBe(false);
  });

  it('does not send a provider response or its secrets to the browser on failure', async () => {
    mocks.fetch.mockRejectedValue(new Error('provider error private-api-key private-header'));
    const result = await reconfigureEvolutionWebhook('instance-1', 'workspace-1');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-api-key');
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('sends the same explicit enabled webhook contract when creating an instance', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('FROM whatsapp_clusters') ? [{ id: 'cluster-1', ...apiConfig }]
        : sql.includes('RETURNING id') ? [{ id: 'instance-1' }] : [],
      rowCount: 1,
    }));
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });
    mocks.query.mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 });
    mocks.fetch.mockResolvedValue([]);
    const result = await createEvolutionApiInstance({ displayName: 'Suporte', integration: 'WHATSAPP-BAILEYS', webhook: { enabled: false, events: [] } }, 'workspace-1');
    expect(result.success).toBe(true);
    const call = mocks.fetch.mock.calls.find(([endpoint]) => endpoint === '/instance/create')!;
    const payload = JSON.parse(call[2].body);
    expect(payload.webhook).toMatchObject({ enabled: true, byEvents: false, events: expect.arrayContaining(['MESSAGES_UPSERT']) });
    expect(payload.webhook.url).toMatch(/^https:\/\/dialogy\.example\/api\/webhooks\/evolution\/[\da-f-]+$/);
  });
});

describe('webhook persistence SQL', () => {
  let database: PGlite;
  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      CREATE TABLE whatsapp_clusters (id text PRIMARY KEY, api_url text, api_key text);
      CREATE TABLE evolution_api_instances (id text PRIMARY KEY, workspace_id text, instance_name text, type text, cluster_id text, webhook_key text, webhook_url text);
      INSERT INTO whatsapp_clusters VALUES ('cluster-1', 'https://evolution.example', 'private-api-key');
    `);
  });
  afterAll(async () => database.close());
  beforeEach(async () => {
    await database.exec(`DELETE FROM evolution_api_instances; INSERT INTO evolution_api_instances VALUES ('instance-1', 'workspace-1', 'zap1', 'baileys', 'cluster-1', NULL, 'https://old.example/webhook');`);
    mocks.query.mockImplementation(async (sql, params) => {
      const result = await database.query(sql, params);
      return { ...result, rowCount: result.rows.length };
    });
  });

  it('rejects a different workspace before making any provider call', async () => {
    await expect(configureEvolutionInstanceWebhook('instance-1', 'workspace-2')).rejects.toThrow('nao encontrada');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('creates a legacy key before delivery, saves the URL, and reuses the key on retry', async () => {
    let remote: unknown = null;
    mocks.fetch.mockImplementation(async (endpoint, _config, options) => {
      if (endpoint.includes('/set/')) {
        const { webhook } = JSON.parse(options.body);
        const saved = await database.query<{ webhook_key: string }>('SELECT webhook_key FROM evolution_api_instances');
        expect(webhook.url).toBe(buildEvolutionWebhookUrl(saved.rows[0].webhook_key));
        remote = webhook;
      }
      return remote;
    });
    const first = await configureEvolutionInstanceWebhook('instance-1', 'workspace-1');
    expect(await configureEvolutionInstanceWebhook('instance-1', 'workspace-1')).toBe(first);
    expect((await database.query<{ webhook_url: string }>('SELECT webhook_url FROM evolution_api_instances')).rows[0].webhook_url).toBe(first);
  });
});
