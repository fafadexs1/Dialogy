import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), config: vi.fn(), billing: vi.fn(), send: vi.fn(), safeUrl: vi.fn(), archive: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/lib/whatsapp/evolution-config', () => ({ getEvolutionApiConfig: mocks.config }));
vi.mock('@/lib/billing-logic', () => ({ getWorkspaceBillingStatus: mocks.billing, isBillingBlocked: (status: string) => status === 'past_due' }));
vi.mock('@/services/whatsapp/send-catalog-message', () => ({ sendCatalogMessage: mocks.send }));
vi.mock('@/services/autopilot/automation-rules', () => ({ resolveSafeAutopilotWebhookTarget: mocks.safeUrl }));
vi.mock('@/services/messages/archive-outbound-media', () => ({ archiveOutboundMediaSafely: mocks.archive, isTemporaryMediaUrl: (url: string) => url.includes('/temp-media/') }));

import { deliverWhatsappCatalog } from '@/services/whatsapp/deliver-catalog';

const catalog = { body: 'Produtos', cards: [{ title: 'Suéter', body: 'R$ 129,90', imageUrl: 'https://cdn.example.com/product.jpg', buttons: [{ type: 'reply', displayText: 'Quero', id: 'sueter' }] }] };
const input = { chatId: 'chat-1', workspaceId: 'ws-1', requestId: 'request-1', senderUserId: 'user-1', catalog };
let instanceType = 'baileys';
let chatStatus = 'atendimentos';
let existing: Record<string, unknown> | null = null;
let conflict = false;

describe('catalog delivery safety and persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instanceType = 'baileys'; chatStatus = 'atendimentos'; existing = null; conflict = false;
    mocks.config.mockResolvedValue({ api_url: 'https://evolution.example.com', api_key: 'key' });
    mocks.billing.mockResolvedValue('active'); mocks.safeUrl.mockResolvedValue({});
    mocks.send.mockResolvedValue('provider-1'); mocks.archive.mockResolvedValue({ url: '/api/storage/object?key=archive' });
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM chats c')) return { rows: [{ workspace_id: 'ws-1', status: chatStatus, instance_type: instanceType, instance_name: 'zap1', phone_number_jid: '5511999999999' }] };
      if (sql.includes('INSERT INTO messages')) return { rows: conflict ? [] : [{ id: params[0] }] };
      if (sql.startsWith('SELECT * FROM messages')) return { rows: existing ? [existing] : [] };
      if (sql.includes("api_message_status = 'SENT'")) return { rows: [{ id: 'request-1', message_id_from_api: params[1], created_at: new Date() }] };
      return { rows: [] };
    });
  });

  it('reserves the send before contacting WhatsApp and persists provider acceptance', async () => {
    const result = await deliverWhatsappCatalog(input);
    expect(result.success).toBe(true);
    expect(result.message?.message_id_from_api).toBe('provider-1');
    expect(mocks.query.mock.invocationCallOrder[1]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]);
    expect(mocks.query.mock.calls[0][1]).toEqual(['chat-1', 'ws-1']);
  });
  it.each(['wa_cloud', 'telegram'])('blocks unsupported connection %s before an external send', async (type) => {
    instanceType = type;
    expect((await deliverWhatsappCatalog(input)).success).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('blocks closed chats, overdue billing and unsafe photo sources', async () => {
    chatStatus = 'encerrados';
    expect((await deliverWhatsappCatalog(input)).success).toBe(false);
    chatStatus = 'atendimentos'; mocks.billing.mockResolvedValue('past_due');
    expect((await deliverWhatsappCatalog(input)).success).toBe(false);
    mocks.billing.mockResolvedValue('active'); mocks.safeUrl.mockRejectedValue(new Error('URL não pública'));
    expect((await deliverWhatsappCatalog(input)).success).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('does not duplicate an already reserved attempt', async () => {
    conflict = true;
    existing = { id: 'request-1', metadata: { interactiveType: 'carousel' }, api_message_status: 'PENDING', created_at: new Date() };
    const result = await deliverWhatsappCatalog(input);
    expect(result.warning).toContain('já foi iniciado');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('keeps uncertain network outcomes separate from provider rejection', async () => {
    mocks.send.mockRejectedValue(new Error('Network timeout'));
    expect((await deliverWhatsappCatalog(input)).warning).toContain('confirmação não chegou');
    expect(mocks.query.mock.calls.at(-1)?.[1]?.[1]).toBe('UNKNOWN');
    mocks.send.mockRejectedValue(new Error('Evolution API Error: 400 Bad Request'));
    expect((await deliverWhatsappCatalog({ ...input, requestId: 'request-2' })).success).toBe(false);
    expect(mocks.query.mock.calls.at(-1)?.[1]?.[1]).toBe('FAILED');
  });
  it('archives uploaded photos for history while passing the public URL to the provider', async () => {
    const uploaded = { ...catalog, cards: [{ ...catalog.cards[0], imageUrl: 'https://storage.example.com/temp-media/photo.jpg' }] };
    await deliverWhatsappCatalog({ ...input, catalog: uploaded });
    expect(mocks.archive).toHaveBeenCalled();
    const saved = mocks.query.mock.calls.find(([sql]) => sql === 'UPDATE messages SET metadata = $2 WHERE id = $1');
    expect(saved?.[1][1].interactivePayload.cards[0].imageUrl).toBe('/api/storage/object?key=archive');
    expect(mocks.send.mock.calls[0][3].cards[0].imageUrl).toBe(uploaded.cards[0].imageUrl);
  });
});
