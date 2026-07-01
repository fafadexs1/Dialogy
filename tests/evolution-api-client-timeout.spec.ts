import { afterEach, describe, expect, it, vi } from 'vitest';

const resilientFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/http/resilient-fetch', () => ({
  resilientFetch: resilientFetchMock,
}));

import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';

describe('Evolution API client timeout', () => {
  afterEach(() => {
    delete process.env.EVOLUTION_API_TIMEOUT_MS;
    resilientFetchMock.mockReset();
  });

  it('bounds provider calls and does not classify POST as idempotent', async () => {
    process.env.EVOLUTION_API_TIMEOUT_MS = '1234';
    resilientFetchMock.mockResolvedValue(new Response(
      JSON.stringify({ key: { id: 'provider-1' } }),
      { status: 200 },
    ));

    await fetchEvolutionAPI(
      '/message/sendText/instance-1',
      {
        api_url: 'https://evolution.example',
        api_key: 'secret',
      },
      {
        method: 'POST',
        body: JSON.stringify({ number: '5500000000000', text: 'Oi' }),
      },
    );

    expect(resilientFetchMock).toHaveBeenCalledWith(
      'https://evolution.example/message/sendText/instance-1',
      expect.objectContaining({ method: 'POST' }),
      expect.objectContaining({
        timeoutMs: 1234,
        idempotent: false,
        serviceKey: 'evolution:https://evolution.example',
      }),
    );
  });
});
