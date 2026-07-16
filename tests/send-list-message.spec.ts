import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchEvolutionAPIMock } = vi.hoisted(() => ({
  fetchEvolutionAPIMock: vi.fn(),
}));

vi.mock('@/lib/whatsapp/evolution-api-client', () => ({
  fetchEvolutionAPI: fetchEvolutionAPIMock,
}));

import { sendListMessage } from '@/services/whatsapp/send-list-message';

describe('sendListMessage', () => {
  beforeEach(() => {
    fetchEvolutionAPIMock.mockReset();
    fetchEvolutionAPIMock.mockResolvedValue({ id: 'api-msg-1' });
  });

  it('calls the Evolution sendList endpoint with a normalized number', async () => {
    await sendListMessage(
      { api_url: 'https://whatsapp-api.klyraai.com.br', api_key: 'key-1' },
      'zap7',
      {
        number: '556195215930@s.whatsapp.net',
        title: 'List Title',
        description: 'List description',
        footerText: 'Footer text',
        buttonText: 'Click Here',
        delay: 1200,
        quoted: {
          key: {
            id: 'MESSAGE_ID',
          },
          message: {
            conversation: 'CONTENT_MESSAGE',
          },
        },
        mentionsEveryOne: false,
        mentioned: ['5511999999999@s.whatsapp.net'],
        sections: [
          {
            title: 'Section 01',
            rows: [
              {
                title: 'Option 01',
                description: 'First option',
                rowId: 'row-001',
              },
            ],
          },
        ],
      }
    );

    expect(fetchEvolutionAPIMock).toHaveBeenCalledWith(
      '/message/sendList/zap7',
      { api_url: 'https://whatsapp-api.klyraai.com.br', api_key: 'key-1' },
      {
        method: 'POST',
        body: JSON.stringify({
          number: '556195215930',
          title: 'List Title',
          description: 'List description',
          footerText: 'Footer text',
          buttonText: 'Click Here',
          delay: 1200,
          quoted: {
            key: {
              id: 'MESSAGE_ID',
            },
            message: {
              conversation: 'CONTENT_MESSAGE',
            },
          },
          mentionsEveryOne: false,
          mentioned: ['5511999999999@s.whatsapp.net'],
          sections: [
            {
              title: 'Section 01',
              rows: [
                {
                  title: 'Option 01',
                  description: 'First option',
                  rowId: 'row-001',
                },
              ],
            },
          ],
        }),
      }
    );
  });
});
