import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { NodeRuntimeInput } from '@/services/workflow-runtime';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
import { sendNexusGoogleAdsLead, loadNexusGoogleAdsOptions } from '@/modules/nexus/services/google-ads-lead';
import { enqueueContactConversionExport } from '@/services/google-ads/conversion-queue';
import { createWorkflowNode, createDefaultNodeHandlerRegistry, WorkflowExecutor, InMemoryWorkflowPersistence } from '@/services/workflow-runtime';
import { createStandaloneNexusWorkflow } from '@/modules/nexus/services/standalone-workflows';
import { executeNexusIntegration } from '@/modules/nexus/services/integration-executors';
import { connect } from './workflow-runtime-fixtures';

const database = new PGlite();
const workspace = '00000000-0000-4000-8000-000000000001';
const foreign = '00000000-0000-4000-8000-000000000002';
const config = { customerId: '1234567890', eventName: 'lead_qualified', conversionActionId: '100' };
function input(contactId = 'contact-a', overrides = {}) {
  return { workflow: { workspaceId: workspace }, node: { id: 'ads', type: 'integration.google_ads_lead', config: { ...config, ...overrides } },
    execution: { input: { contactId }, context: {}, variables: {} } } as unknown as NodeRuntimeInput;
}

describe('explicit Google Ads lead action', () => {
  beforeAll(async () => {
    mocks.query.mockImplementation(async (sql, args) => { const result = await database.query(sql, args); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; });
    await database.exec(`
      CREATE TABLE workspaces (id uuid PRIMARY KEY, google_ads_customer_id text, google_ads_conversion_action_lead_qualified text, google_ads_conversion_action_sale_won text, google_ads_conversion_action_whatsapp_message text);
      CREATE TABLE workspace_integrations (workspace_id uuid, provider text, config jsonb, is_active boolean);
      CREATE TABLE contacts (id text PRIMARY KEY, workspace_id uuid);
      CREATE TABLE chats (id text, contact_id text, workspace_id uuid);
      CREATE TABLE ad_attributions (id text PRIMARY KEY, workspace_id text, contact_id text, chat_id text, message_id text, ad_click_id text, export_eligible boolean, attributed_at timestamptz DEFAULT now());
      CREATE TABLE conversion_exports (id text DEFAULT gen_random_uuid()::text, workspace_id text, ad_attribution_id text, event_name text, conversion_action_id text, product_destination_id text, google_ads_customer_id text, transaction_id text, conversion_value numeric, currency text, status text, kind text, deal_id text, order_id text, payload jsonb);
      CREATE UNIQUE INDEX conversions_unique ON conversion_exports (workspace_id, event_name, transaction_id) WHERE kind = 'conversion';
      INSERT INTO workspaces VALUES ('${workspace}', '123-456-7890', '100', NULL, NULL), ('${foreign}', '9999999999', '900', NULL, NULL);
      INSERT INTO workspace_integrations VALUES ('${workspace}', 'gads', '{"refreshToken":"test-only"}', true), ('${foreign}', 'gads', '{"refreshToken":"foreign-test"}', true);
      INSERT INTO contacts VALUES ('contact-a', '${workspace}'), ('contact-b', '${foreign}'), ('no-attribution', '${workspace}');
      INSERT INTO ad_attributions VALUES ('attr-a', '${workspace}', 'contact-a', 'chat-a', 'msg-a', 'click-a', true, now()), ('attr-b', '${foreign}', 'contact-b', 'chat-b', 'msg-b', 'click-b', true, now());
    `);
  });
  afterAll(async () => { await database.close(); });

  it('exposes only configured workspace destinations without secrets', async () => {
    const options = await loadNexusGoogleAdsOptions(workspace);
    expect(options).toEqual({ customerId: '1234567890', connected: true, conversions: [{ eventName: 'lead_qualified', label: 'Lead qualificado', conversionActionId: '100' }] });
  });
  it('registers a configurable executable action', () => {
    expect(createWorkflowNode('integration.google_ads_lead', { id: 'ads', position: { x: 0, y: 0 } }).name).toBe('Enviar lead para o Google Ads');
    expect(createDefaultNodeHandlerRegistry().get('integration.google_ads_lead')).toBeDefined();
  });
  it('queues only on explicit execution and does not claim Google delivery', async () => {
    expect((await database.query('SELECT * FROM conversion_exports')).rows).toHaveLength(0);
    const workflow = createStandaloneNexusWorkflow({ id: 'flow-ads', workspaceId: workspace, name: 'Lead para Ads', template: 'crm_option', crmOption: { fieldId: 'contract', value: 'Assinou' } });
    const action = createWorkflowNode('integration.google_ads_lead', { id: 'send-lead', position: { x: 200, y: 0 }, config });
    const error = createWorkflowNode('error.handler', { id: 'error', position: { x: 200, y: 200 }, config: { mode: 'fail' } });
    const end = workflow.nodes.find((node) => node.id === 'crm_end')!;
    workflow.connections = [connect(workflow.nodes[0], 'event', action, 'main'), connect(action, 'success', end, 'main'), connect(action, 'error', error, 'error', 'error'), connect(error, 'failed', end, 'main')];
    workflow.nodes.push(action, error);
    const executor = new WorkflowExecutor(new InMemoryWorkflowPersistence(), createDefaultNodeHandlerRegistry({ executeIntegration: executeNexusIntegration }));
    const execution = await executor.start({ workflow, input: { contactId: 'contact-a' } });
    expect(execution.status).toBe('completed');
    expect(execution.variables.googleAdsResult).toEqual({ status: 'queued', enqueued: true, delivered: false });
    const rows = (await database.query('SELECT workspace_id, google_ads_customer_id, conversion_action_id, status FROM conversion_exports')).rows;
    expect(rows).toEqual([{ workspace_id: workspace, google_ads_customer_id: '1234567890', conversion_action_id: '100', status: 'pending' }]);
  });
  it('does not duplicate a conversion when the block runs again', async () => {
    expect(await sendNexusGoogleAdsLead(input())).toMatchObject({ status: 'already_queued', enqueued: false });
    expect((await database.query('SELECT * FROM conversion_exports')).rows).toHaveLength(1);
  });
  it('rejects foreign contacts, accounts and conversions', async () => {
    await expect(sendNexusGoogleAdsLead(input('contact-b'))).rejects.toThrow('contato desta workspace');
    await expect(sendNexusGoogleAdsLead(input('contact-a', { customerId: '9999999999' }))).rejects.toThrow('workspace');
    await expect(sendNexusGoogleAdsLead(input('contact-a', { conversionActionId: '900' }))).rejects.toThrow('workspace');
    expect((await database.query('SELECT * FROM conversion_exports')).rows).toHaveLength(1);
  });
  it('routes ineligible leads to error rather than reporting success', async () => {
    await expect(sendNexusGoogleAdsLead(input('no-attribution'))).rejects.toThrow('não enfileirado');
  });
  it('pins destination at enqueue time even when workspace configuration changes', async () => {
    const result = await enqueueContactConversionExport({ workspaceId: workspace, contactId: 'contact-a', eventName: 'lead_qualified', expectedCustomerId: '9999999999', expectedConversionActionId: '900' });
    expect(result.enqueued).toBe(false);
    expect((await database.query('SELECT * FROM conversion_exports')).rows).toHaveLength(1);
  });
  it('rejects a disconnected integration', async () => {
    await database.query('UPDATE workspace_integrations SET is_active = false WHERE workspace_id = $1', [workspace]);
    await expect(sendNexusGoogleAdsLead(input())).rejects.toThrow('workspace');
  });
});
