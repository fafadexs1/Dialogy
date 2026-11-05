import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), access: vi.fn(), query: vi.fn(), deliver: vi.fn(), target: vi.fn(), rate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/server/inbox/access', () => ({ requireChatAccess: mocks.access }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/lib/ratelimit', () => ({ consumeRateLimit: mocks.rate }));
vi.mock('@/services/whatsapp/deliver-catalog', () => ({ deliverWhatsappCatalog: mocks.deliver, getCatalogTarget: mocks.target }));
import { sendWhatsappCatalogAction, getWhatsappCatalogAvailability } from '@/actions/whatsapp-catalog';

const input = { chatId: '4ed75223-7ca1-47da-9121-167b350b99b7', requestId: '08fcad03-993e-47fa-ad4c-bd627409a873', catalog: { body: 'Produtos', cards: [{ title: 'Produto', body: 'R$ 99', imageUrl: 'https://example.com/photo.jpg', buttons: [{ type: 'reply', displayText: 'Quero', id: 'product-1' }] }] } };

describe('catalog server action authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mocks.access.mockResolvedValue({ ok: true });
    mocks.query.mockResolvedValue({ rows: [{ workspace_id: 'ws-1' }] });
    mocks.rate.mockReturnValue({ ok: true });
    mocks.deliver.mockResolvedValue({ success: true });
    mocks.target.mockResolvedValue({ instance_name: 'zap1' });
  });
  it('derives the sender and workspace from the authenticated chat', async () => {
    expect((await sendWhatsappCatalogAction(input)).success).toBe(true);
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ senderUserId: 'user-1', workspaceId: 'ws-1' }));
    expect(mocks.access).toHaveBeenCalledWith('user-1', input.chatId);
  });
  it('blocks unauthenticated users and users without chat access', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await sendWhatsappCatalogAction(input)).success).toBe(false);
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mocks.access.mockResolvedValue({ ok: false, error: 'Sem permissão' });
    expect((await sendWhatsappCatalogAction(input)).success).toBe(false);
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('enforces the rate limit and rejects malformed identifiers', async () => {
    mocks.rate.mockReturnValue({ ok: false });
    expect((await sendWhatsappCatalogAction(input)).success).toBe(false);
    expect((await sendWhatsappCatalogAction({ ...input, requestId: 'invalid' })).success).toBe(false);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it('reports connection incompatibility before the user fills the catalog', async () => {
    mocks.target.mockRejectedValue(new Error('Conexão oficial exige template aprovado.'));
    expect(await getWhatsappCatalogAvailability(input.chatId)).toEqual({ available: false, error: 'Conexão oficial exige template aprovado.' });
  });
});
