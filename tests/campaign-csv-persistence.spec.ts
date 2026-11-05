import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCampaign } from '@/actions/campaigns';
import { parseCampaignContactsCsv } from '@/lib/campaigns/csv-import';
import { renderCampaignTemplatePreview } from '@/lib/campaigns/personalization';
import type { CampaignTemplate } from '@/lib/types';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: mocks }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } } }) } }) }));
vi.mock('@/lib/workspace-permissions', () => ({ hasWorkspacePermission: async () => true }));
vi.mock('@/lib/billing-logic', () => ({ getWorkspaceLimits: async () => ({ limits: { campaigns: true }, plan: 'pro' }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/actions/messages', () => ({ sendAgentTemplateAction: vi.fn(), sendAutomatedMessageAction: vi.fn() }));
vi.mock('@/lib/utils', () => ({ buildChatProtocol: () => 'test' }));
vi.mock('@/lib/crm-query-builder', () => ({ buildSegmentAudienceQuery: vi.fn(), combineSegmentCriteria: vi.fn() }));
vi.mock('@/lib/whatsapp/contact-identity', () => ({
  extractWhatsappDigits: (value: string) => value.replace(/\D/g, ''),
  normalizeWhatsappJid: (value: string) => `${value.replace(/\D/g, '')}@s.whatsapp.net`,
  findOrCreateWhatsappContact: async (client: { query: typeof mocks.query }, input: { workspaceId: string; phoneOrJid: string }) => {
    const result = await client.query('SELECT id FROM contacts WHERE workspace_id = $1 AND phone_number_jid = $2', [input.workspaceId, input.phoneOrJid]);
    return { contact: result.rows[0] };
  },
}));

const workspaceId = '11111111-1111-1111-1111-111111111111';
const mariaId = '22222222-2222-2222-2222-222222222222';
const joaoId = '33333333-3333-3333-3333-333333333333';
let database: PGlite;
const template: CampaignTemplate = {
  name: 'cobranca', language: 'pt_BR',
  components: [{ type: 'BODY', text: 'Olá {{1}}, valor {{2}}.' }],
  bodyParameterColumns: ['Cliente', 'Valor'],
  bodyParameterValues: ['', ''],
};

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    CREATE TABLE contacts (id uuid PRIMARY KEY, workspace_id uuid, name text, phone_number_jid text, marketing_opt_out_at timestamptz);
    CREATE TABLE evolution_api_instances (workspace_id uuid, instance_name text, type text);
    CREATE TABLE campaigns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid, created_by_id uuid, name text, message text,
      instance_name text, status text, delivery_channel text, destination_id text, template_payload jsonb,
      media_payload jsonb, schedule_config jsonb, scheduled_end_at timestamptz, interactive_payload jsonb,
      started_at timestamptz, opted_out_count integer DEFAULT 0, updated_at timestamptz
    );
    CREATE TABLE campaign_recipients (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid, contact_id uuid, status text,
      scheduled_at timestamptz, max_attempts integer, UNIQUE (campaign_id, contact_id)
    );
  `);
  const migration = readFileSync('prisma/migrations/20261023150000_campaign_recipient_csv_data/migration.sql', 'utf8');
  await database.exec(migration);
  await database.exec(migration);
  mocks.query.mockImplementation((text: string, values?: unknown[]) => database.query(text, values));
  mocks.connect.mockResolvedValue({ query: mocks.query, release: vi.fn() });
});

beforeEach(async () => {
  await database.exec('TRUNCATE campaign_recipients, campaigns, contacts, evolution_api_instances');
  await database.query('INSERT INTO evolution_api_instances VALUES ($1, $2, $3)', [workspaceId, 'zap1', 'wa_cloud']);
  await database.query('INSERT INTO contacts(id, workspace_id, name, phone_number_jid) VALUES ($1, $2, $3, $4), ($5, $2, $6, $7)',
    [mariaId, workspaceId, 'Maria CRM', '5561984133192@s.whatsapp.net', joaoId, 'João CRM', '5561995215930@s.whatsapp.net']);
});

afterAll(async () => { await database.close(); });

function csvRecipients(value = '25,50') {
  return parseCampaignContactsCsv(`Cliente;Telefone;Valor\nMaria;61984133192;10,00\nJoão;61995215930;${value}`)
    .contacts.map(contact => ({ ...contact, id: `csv-${contact.id}` }));
}

function create(contacts: Parameters<typeof createCampaign>[3] = csvRecipients(), selectedTemplate = template) {
  return createCampaign(workspaceId, { channel: 'whatsapp_cloud', instanceName: 'zap1', template: selectedTemplate },
    'Olá {{1}}, valor {{2}}.', contacts, [], { consentConfirmed: true });
}

describe('campaign CSV persistence', () => {
  it('snapshots each CSV row independently and restores the same template after a reload', async () => {
    const contacts = csvRecipients();
    const result = await create(contacts);
    expect(result.error).toBeUndefined();
    contacts[0].csvData.Valor = 'changed after creation';
    const { rows } = await database.query<{ csv_data: Record<string, string>; template_payload: CampaignTemplate }>(
      'SELECT cr.csv_data, c.template_payload FROM campaign_recipients cr JOIN campaigns c ON c.id = cr.campaign_id ORDER BY cr.contact_id');
    expect(rows.map(row => renderCampaignTemplatePreview(row.template_payload, { csvData: row.csv_data })))
      .toEqual(['Olá Maria, valor 10,00.', 'Olá João, valor 25,50.']);
  });

  it('rolls back the entire creation when a mapped cell has no value or fallback', async () => {
    expect((await create(csvRecipients(''))).error).toContain('Coluna "Valor"');
    expect((await database.query('SELECT * FROM campaigns')).rows).toEqual([]);
    expect((await database.query('SELECT * FROM campaign_recipients')).rows).toEqual([]);
  });

  it('supports a mixed CRM and CSV audience using personalized fallbacks', async () => {
    const contacts = [csvRecipients()[0], { id: `crm-${joaoId}`, name: 'João CRM', phone_number_jid: '5561995215930@s.whatsapp.net', csvData: {} }];
    expect((await create(contacts)).error).toContain('Coluna');
    const mixedTemplate = { ...template, bodyParameterValues: ['{{primeiro_nome}}', 'Consulte seu saldo'] };
    const result = await create(contacts, mixedTemplate);
    expect(result.error).toBeUndefined();
    const { rows } = await database.query<{ csv_data: Record<string, string> }>('SELECT csv_data FROM campaign_recipients WHERE contact_id = $1', [joaoId]);
    expect(rows[0].csv_data).toEqual({});
    expect(renderCampaignTemplatePreview(mixedTemplate, { contactName: 'João CRM', csvData: rows[0].csv_data }))
      .toBe('Olá João, valor Consulte seu saldo.');
  });

  it('keeps existing recipients compatible and prevents non-object snapshots', async () => {
    await database.query('INSERT INTO campaign_recipients(contact_id) VALUES ($1)', [mariaId]);
    expect((await database.query<{ csv_data: object }>('SELECT csv_data FROM campaign_recipients')).rows[0].csv_data).toEqual({});
    await expect(database.query("INSERT INTO campaign_recipients(csv_data) VALUES ('[]')")).rejects.toThrow();
  });
});
