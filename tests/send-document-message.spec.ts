import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchEvolutionAPIMock, uploadTempMediaMock } = vi.hoisted(() => ({
  fetchEvolutionAPIMock: vi.fn(),
  uploadTempMediaMock: vi.fn(),
}));

vi.mock('@/lib/whatsapp/evolution-api-client', () => ({
  fetchEvolutionAPI: fetchEvolutionAPIMock,
}));

vi.mock('@/services/whatsapp/upload-temp-media', () => ({
  uploadTempMedia: uploadTempMediaMock,
}));

import { sendDocumentMessage } from '@/services/whatsapp/send-document-message';

describe('sendDocumentMessage', () => {
  beforeEach(() => {
    fetchEvolutionAPIMock.mockReset();
    uploadTempMediaMock.mockReset();
  });

  it('normalizes an extensionless remote PDF before sending it to Evolution', async () => {
    uploadTempMediaMock.mockResolvedValue({
      publicUrl: 'https://storage.example/temp-media/id/fatura-898373.pdf',
      filePath: 'id/fatura-898373.pdf',
    });
    fetchEvolutionAPIMock.mockResolvedValue({ key: { id: 'wamid-test' } });

    await expect(sendDocumentMessage(
      { api_url: 'https://evolution.example', api_key: 'key' },
      'zap1',
      {
        number: '5561995215930@s.whatsapp.net',
        media: 'https://sgp.example/boleto/token/',
        mimetype: 'application/pdf',
        filename: 'fatura-898373.pdf',
        caption: 'Fatura em PDF',
      },
    )).resolves.toMatchObject({ key: { id: 'wamid-test' } });

    expect(uploadTempMediaMock).toHaveBeenCalledWith({
      media: 'https://sgp.example/boleto/token/',
      mimetype: 'application/pdf',
      fileName: 'fatura-898373.pdf',
    });
    const [, , request] = fetchEvolutionAPIMock.mock.calls[0];
    expect(JSON.parse(request.body)).toMatchObject({
      mediatype: 'document',
      mimetype: 'application/pdf',
      media: 'https://storage.example/temp-media/id/fatura-898373.pdf',
      fileName: 'fatura-898373.pdf',
    });
  });
});
