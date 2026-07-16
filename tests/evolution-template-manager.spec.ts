import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEvolutionApiConfigMock, resilientFetchMock, queryMock } = vi.hoisted(() => ({
  getEvolutionApiConfigMock: vi.fn(),
  resilientFetchMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    connect: vi.fn(),
    query: queryMock,
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/security/access', () => ({
  requireWorkspaceAccess: vi.fn().mockResolvedValue({ id: 'user-1' }),
  requireWorkspacePermission: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

vi.mock('@/services/telegram/bot-api', () => ({
  buildTelegramWebhookUrl: vi.fn(),
  deleteTelegramWebhook: vi.fn(),
  getTelegramWebhookInfo: vi.fn(),
  normalizeTelegramBotToken: vi.fn(),
  setTelegramWebhook: vi.fn(),
  validateTelegramBotToken: vi.fn(),
}));

vi.mock('@/lib/whatsapp/evolution-config', () => ({
  buildEvolutionWebhookUrl: vi.fn(),
  getEvolutionApiConfig: getEvolutionApiConfigMock,
}));

vi.mock('@/lib/http/resilient-fetch', () => ({
  resilientFetch: resilientFetchMock,
}));

import { createWhatsappTemplate } from '@/actions/evolution-api';

describe('createWhatsappTemplate', () => {
  const apiConfig = {
    api_url: 'https://evolution.example.com/',
    api_key: 'secret-key',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    getEvolutionApiConfigMock.mockReset();
    resilientFetchMock.mockReset();
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [{ workspace_id: 'workspace-1' }], rowCount: 1 });
    getEvolutionApiConfigMock.mockResolvedValue(apiConfig);
    resilientFetchMock.mockResolvedValue(new Response('{}', { status: 200, statusText: 'OK' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('creates templates with the current Evolution API endpoint', async () => {
    const payload = { name: 'pedido_confirmado', components: [] };

    const result = await createWhatsappTemplate('zap7', payload);

    expect(result).toEqual({ success: true });
    expect(resilientFetchMock).toHaveBeenCalledTimes(1);
    expect(resilientFetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/template/create/zap7',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      expect.any(Object),
    );
  });

  it('falls back to the legacy add endpoint when create is unavailable', async () => {
    const payload = { name: 'pedido_confirmado', components: [] };
    resilientFetchMock
      .mockResolvedValueOnce(new Response('{"status":404,"error":"Not Found"}', { status: 404, statusText: 'Not Found' }))
      .mockResolvedValueOnce(new Response('{}', { status: 200, statusText: 'OK' }));

    const result = await createWhatsappTemplate('zap7', payload);

    expect(result).toEqual({ success: true });
    expect(resilientFetchMock).toHaveBeenCalledTimes(2);
    expect(resilientFetchMock.mock.calls[0][0]).toBe('https://evolution.example.com/template/create/zap7');
    expect(resilientFetchMock.mock.calls[1][0]).toBe('https://evolution.example.com/template/add/zap7');
  });
});
