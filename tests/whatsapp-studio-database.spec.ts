import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createStudioDraft, templateSlug } from '@/lib/whatsapp/studio';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUser: vi.fn(),
  api: vi.fn(),
  metaList: vi.fn(),
  token: vi.fn(),
  upload: vi.fn(),
  put: vi.fn(),
  signed: vi.fn(),
  billing: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/lib/whatsapp/evolution-api-client', () => ({
  fetchEvolutionAPI: mocks.api,
}));
vi.mock('@/services/whatsapp/studio-media', () => ({
  listStudioMetaTemplates: mocks.metaList,
  getStudioCloudToken: mocks.token,
  uploadStudioImageToMeta: mocks.upload,
}));
vi.mock('@/lib/storage/private-s3', () => ({
  putPrivateObject: mocks.put,
  createPrivateObjectDownloadUrl: mocks.signed,
}));
vi.mock('@/lib/billing-logic', () => ({
  getWorkspaceBillingStatus: mocks.billing,
  isBillingBlocked: (status: string) => status !== 'active',
}));
vi.mock('@/lib/ratelimit', () => ({ consumeRateLimit: () => ({ ok: true }) }));
import {
  deleteWhatsappStudioDraft,
  editWhatsappMetaTemplate,
  getWhatsappStudioLibrary,
  getWhatsappStudioTemplates,
  publishWhatsappStudioTemplate,
  saveWhatsappStudioDraft,
  sendWhatsappStudioTest,
  uploadWhatsappStudioImage,
} from '@/actions/whatsapp-studio';

const W = '10000000-0000-4000-8000-000000000001';
const F = '10000000-0000-4000-8000-000000000002';
const OWNER = '20000000-0000-4000-8000-000000000001';
const VIEWER = '20000000-0000-4000-8000-000000000002';
const QR = '30000000-0000-4000-8000-000000000001';
const CLOUD = '30000000-0000-4000-8000-000000000002';
const FOREIGN = '30000000-0000-4000-8000-000000000003';
const REQUEST = '90000000-0000-4000-8000-000000000001';
let sql: PGlite;
beforeAll(async () => {
  sql = new PGlite();
  await sql.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE users(id uuid PRIMARY KEY,is_superadmin boolean DEFAULT false);
    CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid REFERENCES users(id));
    CREATE TABLE user_workspace_roles(user_id uuid,workspace_id uuid,role_id uuid);
    CREATE TABLE role_permissions(role_id uuid,permission_id text);
    CREATE TABLE whatsapp_clusters(id uuid PRIMARY KEY,api_url text,api_key text);
    CREATE TABLE evolution_api_instances(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),cluster_id uuid REFERENCES whatsapp_clusters(id),instance_name text,type text);
  `);
  await sql.exec(
    readFileSync(
      new URL(
        '../prisma/migrations/20261026120000_whatsapp_message_studio/migration.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
});
afterAll(async () => {
  await sql.close();
});
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: OWNER, app_metadata: {} } },
  });
  mocks.query.mockImplementation(async (query: string, params?: unknown[]) => {
    const result = await sql.query(query, params);
    return {
      ...result,
      rowCount: result.rows.length || result.affectedRows || 0,
    };
  });
  mocks.api.mockImplementation(async (endpoint: string) =>
    endpoint.startsWith('/template/create/')
      ? { id: 'meta-template-id', status: 'PENDING' }
      : { key: { id: 'provider-message-id' } },
  );
  mocks.metaList.mockResolvedValue([]);
  mocks.token.mockResolvedValue('server-only-cloud-token');
  mocks.upload.mockResolvedValue('uploaded-meta-handle');
  mocks.signed.mockImplementation(
    async (key: string) =>
      'https://private-storage.example/' + key + '?temporary=1',
  );
  mocks.put.mockResolvedValue(undefined);
  mocks.billing.mockResolvedValue('active');
  await sql.exec(`TRUNCATE whatsapp_studio_sends,whatsapp_message_library,user_workspace_roles,role_permissions,evolution_api_instances,whatsapp_clusters,workspaces,users CASCADE;
    INSERT INTO users(id) VALUES('${OWNER}'),('${VIEWER}');
    INSERT INTO workspaces VALUES('${W}','${OWNER}'),('${F}','${VIEWER}');
    INSERT INTO user_workspace_roles VALUES('${VIEWER}','${W}','40000000-0000-4000-8000-000000000001');
    INSERT INTO whatsapp_clusters VALUES('50000000-0000-4000-8000-000000000001','https://evolution.example','server-only-api-key');
    INSERT INTO evolution_api_instances VALUES('${QR}','${W}','50000000-0000-4000-8000-000000000001','qr','baileys'),('${CLOUD}','${W}','50000000-0000-4000-8000-000000000001','cloud','wa_cloud'),('${FOREIGN}','${F}','50000000-0000-4000-8000-000000000001','foreign','wa_cloud');`);
});
function completeDraft(kind: 'message' | 'carousel' = 'carousel') {
  const draft = createStudioDraft(kind);
  draft.title = 'Novidades com cuidado';
  draft.templateName = templateSlug(draft.title);
  draft.body = 'Olá {{1}}! Conheça nossas novidades.';
  draft.examples = { '1': 'Marina' };
  draft.cards = draft.cards.map((card, index) => ({
    ...card,
    title: 'Seleção ' + (index + 1),
    body: 'Feito para acompanhar seu dia.',
    imageKey:
      'workspaces/' +
      W +
      '/whatsapp-studio/60000000-0000-4000-8000-00000000000' +
      (index + 1) +
      '.jpg',
  }));
  return draft;
}
async function saved(instanceId = QR, draft = completeDraft()) {
  const result = await saveWhatsappStudioDraft({
    workspaceId: W,
    instanceId,
    draft,
  });
  if (!result.success) throw new Error(result.error);
  return result.entry;
}
const sendInput = (entry: { id: string; revision: number }) => ({
  workspaceId: W,
  entryId: entry.id,
  revision: entry.revision,
  recipient: '+55 (11) 99999-9999',
  requestId: REQUEST,
});

describe('Studio with real PostgreSQL migration, queries and workspace access guards', () => {
  it('edits only an existing template in the selected account, preserving its components', async () => {
    const template = {id:'123456789', name:'existing',status:'APPROVED',language:'pt_BR',category:'UTILITY',components:[{type:'BODY',text:'Olá {{1}}',example:{body_text:[['Ana']]}}]};
    mocks.metaList.mockResolvedValue([template]);
    mocks.api.mockResolvedValue({success:true});
    const input = {workspaceId:W,instanceId:CLOUD,templateId:template.id,originalComponents:JSON.stringify(template.components),originalStatus:template.status,updates:{'0.text':'Oi {{1}}'}};
    const result=await editWhatsappMetaTemplate(input);
    expect(result.success).toBe(true);
    const [endpoint,,options]=mocks.api.mock.calls[0];
    expect(endpoint).toBe('/template/edit/cloud');
    expect(JSON.parse(options.body)).toEqual({templateId:'123456789',components:[{type:'BODY',text:'Oi {{1}}',example:{body_text:[['Ana']]}}]});
    expect((await editWhatsappMetaTemplate({...input,instanceId:FOREIGN})).success).toBe(false);
    expect((await editWhatsappMetaTemplate({...input,templateId:'987654321'})).success).toBe(false);
    expect((await editWhatsappMetaTemplate({...input,originalComponents:'[]'})).success).toBe(false);
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });
  it('loads existing official templates by the selected instance ID, without exposing credentials', async () => {
    mocks.metaList.mockResolvedValue([
      {
        name: 'existing',
        status: 'APPROVED',
        components: [],
        language: 'pt_BR',
        category: 'UTILITY',
      },
    ]);
    const result = await getWhatsappStudioTemplates(W, CLOUD);
    expect(result.success).toBe(true);
    expect(result.templates).toHaveLength(1);
    expect(mocks.metaList).toHaveBeenCalledWith(
      { api_url: 'https://evolution.example', api_key: 'server-only-api-key' },
      'cloud',
    );
    expect(JSON.stringify(result)).not.toContain('server-only');
    expect((await getWhatsappStudioTemplates(W, FOREIGN)).success).toBe(false);
  });
  it('persists and reloads drafts, rejects stale edits and retains drafts after removing a connection', async () => {
    const entry = await saved();
    expect(
      (await getWhatsappStudioLibrary(W)).entries[0].draft.cards,
    ).toHaveLength(2);
    const update = await saveWhatsappStudioDraft({
      workspaceId: W,
      instanceId: QR,
      id: entry.id,
      revision: entry.revision,
      draft: { ...entry.draft, title: 'Um novo nome' },
    });
    expect(update.success).toBe(true);
    const stale = await saveWhatsappStudioDraft({
      workspaceId: W,
      instanceId: QR,
      id: entry.id,
      revision: entry.revision,
      draft: entry.draft,
    });
    expect(stale.success).toBe(false);
    expect(
      (await deleteWhatsappStudioDraft(W, entry.id, entry.revision)).success,
    ).toBe(false);
    await sql.query('DELETE FROM evolution_api_instances WHERE id=$1', [QR]);
    expect(
      (await getWhatsappStudioLibrary(W)).entries[0].instance_id,
    ).toBeNull();
  });
  it('lets members read, but prevents unauthorized edits, sends and cross-workspace account usage', async () => {
    const entry = await saved();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: VIEWER, app_metadata: {} } },
    });
    expect((await getWhatsappStudioLibrary(W)).entries).toHaveLength(1);
    expect(
      (
        await saveWhatsappStudioDraft({
          workspaceId: W,
          instanceId: QR,
          draft: entry.draft,
        })
      ).success,
    ).toBe(false);
    expect((await sendWhatsappStudioTest(sendInput(entry))).success).toBe(
      false,
    );
    expect(mocks.api).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: OWNER, app_metadata: {} } },
    });
    expect((await getWhatsappStudioLibrary(F)).success).toBe(false);
    expect(
      (
        await saveWhatsappStudioDraft({
          workspaceId: W,
          instanceId: FOREIGN,
          draft: entry.draft,
        })
      ).success,
    ).toBe(false);
    expect(
      (await publishWhatsappStudioTemplate(F, entry.id, entry.revision))
        .success,
    ).toBe(false);
  });
  it('prevents Data API roles from bypassing the authenticated server actions', async () => {
    await saved();
    await sql.exec('SET ROLE authenticated');
    try {
      await expect(
        sql.query('SELECT * FROM whatsapp_message_library'),
      ).rejects.toThrow('permission denied');
    } finally {
      await sql.exec('RESET ROLE');
    }
    const result = await sql.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname IN ('whatsapp_message_library','whatsapp_studio_sends')",
    );
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
  });
  it('sends a QR carousel with real card payloads and records acceptance before allowing a repeated click', async () => {
    const entry = await saved();
    const input = sendInput(entry);
    expect((await sendWhatsappStudioTest(input)).success).toBe(true);
    expect((await sendWhatsappStudioTest(input)).success).toBe(true);
    expect(mocks.api).toHaveBeenCalledTimes(1);
    const [endpoint, , options] = mocks.api.mock.calls[0];
    expect(endpoint).toBe('/message/sendCarousel/qr');
    const payload = JSON.parse(options.body);
    expect(payload.number).toBe('5511999999999');
    expect(payload.body).toBe('Olá Marina! Conheça nossas novidades.');
    expect(payload.cards).toHaveLength(2);
    expect(payload.cards[0].body).toContain('*Seleção 1*');
    expect(payload.cards[0].buttons[0]).toMatchObject({
      type: 'reply',
      displayText: 'Tenho interesse',
    });
    expect(
      (
        await sql.query(
          'SELECT status,provider_message_id FROM whatsapp_studio_sends',
        )
      ).rows,
    ).toEqual([{ status: 'sent', provider_message_id: 'provider-message-id' }]);
  });
  it('does not retry an uncertain provider send or a request reused with a different recipient', async () => {
    const entry = await saved();
    mocks.api.mockRejectedValue(
      new Error('Timeout after provider accepted the request'),
    );
    expect((await sendWhatsappStudioTest(sendInput(entry))).success).toBe(
      false,
    );
    expect((await sendWhatsappStudioTest(sendInput(entry))).success).toBe(
      false,
    );
    expect(
      (
        await sendWhatsappStudioTest({
          ...sendInput(entry),
          recipient: '+55 11 98888-8888',
        })
      ).success,
    ).toBe(false);
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(
      (await sql.query('SELECT status FROM whatsapp_studio_sends')).rows[0],
    ).toMatchObject({ status: 'unknown' });
  });
  it('prepares private images for official approval, requires approval to test and invalidates a changed publication', async () => {
    const entry = await saved(CLOUD);
    expect((await sendWhatsappStudioTest(sendInput(entry))).success).toBe(
      false,
    );
    expect(
      (await publishWhatsappStudioTemplate(W, entry.id, entry.revision))
        .success,
    ).toBe(true);
    const publishedLibrary = await getWhatsappStudioLibrary(W);
    expect(publishedLibrary.entries[0].publication_matches).toBe(true);
    expect(JSON.stringify(publishedLibrary)).not.toContain(
      'published_fingerprint',
    );
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    const created = JSON.parse(mocks.api.mock.calls[0][2].body);
    expect(
      created.components[1].cards[0].components[0].example.header_handle,
    ).toEqual(['uploaded-meta-handle']);
    expect(JSON.stringify(created)).not.toContain('workspaces/');
    mocks.metaList.mockResolvedValue([
      { name: entry.draft.templateName, language: 'pt_BR', status: 'PENDING' },
    ]);
    expect((await sendWhatsappStudioTest(sendInput(entry))).success).toBe(
      false,
    );
    mocks.metaList.mockResolvedValue([
      { name: entry.draft.templateName, language: 'pt_BR', status: 'APPROVED' },
    ]);
    expect((await sendWhatsappStudioTest(sendInput(entry))).success).toBe(true);
    const sent = JSON.parse(mocks.api.mock.calls.at(-1)![2].body);
    expect(sent.components[1]).toMatchObject({
      type: 'carousel',
      cards: [
        {
          card_index: 0,
          components: [{ type: 'header', parameters: [{ type: 'image' }] }],
        },
        { card_index: 1 },
      ],
    });
    const changed = await saveWhatsappStudioDraft({
      workspaceId: W,
      instanceId: CLOUD,
      id: entry.id,
      revision: entry.revision,
      draft: { ...entry.draft, body: 'Uma mensagem completamente diferente.' },
    });
    if (!changed.success) throw new Error(changed.error);
    expect(changed.entry.publication_matches).toBe(false);
    expect(
      (
        await sendWhatsappStudioTest({
          ...sendInput(changed.entry),
          requestId: '90000000-0000-4000-8000-000000000002',
        })
      ).success,
    ).toBe(false);
  });
  it('clears the publication when moving a draft to another account and does not publish duplicate names', async () => {
    const entry = await saved(CLOUD, completeDraft('message'));
    expect(
      (await publishWhatsappStudioTemplate(W, entry.id, entry.revision))
        .success,
    ).toBe(true);
    mocks.metaList.mockResolvedValue([
      { name: entry.draft.templateName, language: 'pt_BR', status: 'APPROVED' },
    ]);
    expect(
      (await publishWhatsappStudioTemplate(W, entry.id, entry.revision))
        .success,
    ).toBe(false);
    const moved = await saveWhatsappStudioDraft({
      workspaceId: W,
      instanceId: QR,
      id: entry.id,
      revision: entry.revision,
      draft: entry.draft,
    });
    expect(moved.success && moved.entry.provider_name).toBeNull();
  });
  it('refuses foreign photos, oversized uploads and non-image contents before storage or sending', async () => {
    const draft = completeDraft();
    draft.cards[0].imageKey = draft.cards[0].imageKey.replace(W, F);
    expect(
      (await saveWhatsappStudioDraft({ workspaceId: W, instanceId: QR, draft }))
        .success,
    ).toBe(false);
    const form = new FormData();
    form.set(
      'file',
      new File(['not an image'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    expect((await uploadWhatsappStudioImage(W, form)).success).toBe(false);
    expect(mocks.put).not.toHaveBeenCalled();
    form.set(
      'file',
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', {
        type: 'image/png',
      }),
    );
    expect((await uploadWhatsappStudioImage(W, form)).success).toBe(false);
    expect(mocks.put).not.toHaveBeenCalled();
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#b4c6b0' },
    })
      .png()
      .toBuffer();
    form.set(
      'file',
      new File([new Uint8Array(png)], 'photo.png', { type: 'image/png' }),
    );
    const uploaded = await uploadWhatsappStudioImage(W, form);
    expect(uploaded.success).toBe(true);
    expect(mocks.put).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining('workspaces/' + W + '/whatsapp-studio/'),
        contentType: 'image/jpeg',
      }),
    );
  });
  it('blocks tests for a suspended subscription without contacting the provider', async () => {
    const entry = await saved();
    mocks.billing.mockResolvedValue('blocked');
    expect((await sendWhatsappStudioTest(sendInput(entry))).success).toBe(
      false,
    );
    expect(mocks.api).not.toHaveBeenCalled();
  });
});
