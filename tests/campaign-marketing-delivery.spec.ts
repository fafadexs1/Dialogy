import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processClaimedRecipient } from '@/services/campaigns/worker';

const mocks = vi.hoisted(() => ({ query: vi.fn(), clientQuery: vi.fn(), schedule: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query, connect: async () => ({ query: mocks.clientQuery, release: vi.fn() }) } }));
vi.mock('@/lib/billing-logic', () => ({ getMonthlyChatLimitStatus: async () => ({ allowed: true }) }));
vi.mock('@/lib/whatsapp/evolution-config', () => ({ getEvolutionApiConfig: async () => ({ api_url: 'https://provider.test', api_key: 'test' }) }));
vi.mock('@/services/whatsapp/send-text-message', () => ({ sendTextMessage: mocks.send }));
vi.mock('@/services/chat/marketing-auto-close', () => ({ scheduleMarketingAutoClose: mocks.schedule }));
vi.mock('@/services/chat/auto-close', () => ({ runDueMarketingAutoCloses: vi.fn() }));

const claimed = { id: 'recipient-1', campaign_id: 'campaign-1', contact_id: 'contact-1', message_id: 'message-1', attempt_count: 1, max_attempts: 3 };
const createdAt = new Date('2026-10-23T16:00:00.000Z');
const sentAt = new Date('2026-10-23T16:10:00.000Z');
let alreadySent = false;

beforeEach(() => {
  vi.clearAllMocks();
  alreadySent = false;
  mocks.schedule.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue({ key: { id: 'provider-1' } });
  mocks.clientQuery.mockImplementation(async (text: string) => ({ rows: text.includes('SELECT c.id') ? [{ id: 'chat-1' }] : [], rowCount: 1 }));
  mocks.query.mockImplementation(async (text: string) => {
    if (text.includes('cr.csv_data')) return { rows: [{ ...claimed, csv_data: {}, contact_name: 'Maria', phone_number_jid: '5561999999999@s.whatsapp.net', workspace_id: 'workspace-1', created_by_id: 'user-1', message: 'Olá {{nome}}', instance_name: 'zap1', delivery_channel: 'whatsapp_baileys', campaign_status: 'sending', schedule_config: {} }] };
    if (text.includes('SELECT api_message_status')) return { rows: alreadySent ? [{ api_message_status: 'SENT', message_id_from_api: 'provider-1' }] : [] };
    if (text.includes('SELECT created_at')) return { rows: [{ created_at: createdAt }] };
    if (text.includes("SET status = 'sent'")) return { rows: [{ sent_at: sentAt }], rowCount: 1 };
    if (text.includes('AS total')) return { rows: [{ total: 1, sent: 1, failed: 0, cancelled: 0, active: 0 }] };
    return { rows: [], rowCount: 1 };
  });
});

describe('campaign marketing delivery', () => {
  it('persists the marketing flag and counts the timeout from delivery rather than message creation', async () => {
    await processClaimedRecipient(claimed);
    const insert = mocks.query.mock.calls.find(([text]) => String(text).includes('INSERT INTO messages'));
    expect(JSON.parse(insert![1][7])).toMatchObject({ isMarketing: true, campaignId: claimed.campaign_id, campaignRecipientId: claimed.id });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.schedule).toHaveBeenCalledWith('chat-1', 'workspace-1', sentAt, undefined, claimed.message_id);
  });

  it('recovers scheduling for an already delivered message without sending again', async () => {
    alreadySent = true;
    await processClaimedRecipient(claimed);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.schedule).toHaveBeenCalledWith('chat-1', 'workspace-1', sentAt, undefined, claimed.message_id);
  });

  it('does not schedule closure when the provider rejects the campaign', async () => {
    mocks.send.mockRejectedValueOnce(new Error('Provider rejected'));
    await processClaimedRecipient(claimed);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('keeps a successful delivery marked sent if scheduling fails', async () => {
    mocks.schedule.mockRejectedValueOnce(new Error('Queue unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await processClaimedRecipient(claimed);
      expect(mocks.send).toHaveBeenCalledOnce();
      expect(mocks.query.mock.calls.some(([text]) => String(text).includes("SET status = 'sent'"))).toBe(true);
      expect(mocks.query.mock.calls.some(([text]) => String(text).includes('error_message = $3'))).toBe(false);
    } finally { log.mockRestore(); }
  });
});
