import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchEvolutionApiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/whatsapp/evolution-api-client', () => ({
    fetchEvolutionAPI: fetchEvolutionApiMock,
}));

vi.mock('@/lib/observability/logger', () => ({
    withDebug: (_name: string, operation: unknown) => operation,
}));

import { sendTemplateMessage } from '@/services/whatsapp/send-template-message';
import {
    assertValidTemplateComponents,
    InvalidTemplatePayloadError,
    ProviderAcceptanceNotConfirmedError,
    requireProviderMessageId,
} from '@/services/whatsapp/template-send-contract';

const apiConfig = {
    api_url: 'https://evolution.example',
    api_key: 'secret',
};

function pixComponents(code: string) {
    return [
        {
            type: 'button',
            sub_type: 'order_details',
            parameters: [
                {
                    type: 'action',
                    action: {
                        order_details: {
                            payment_settings: [
                                {
                                    type: 'pix_dynamic_code',
                                    pix_dynamic_code: { code },
                                },
                            ],
                        },
                    },
                },
            ],
        },
    ];
}

describe('template send contract', () => {
    beforeEach(() => {
        fetchEvolutionApiMock.mockReset();
    });

    it('rejects an empty PIX code before calling Evolution', async () => {
        await expect(sendTemplateMessage(apiConfig, 'zap1', {
            number: '5561992672288@s.whatsapp.net',
            name: 'fatura_velpro_clientes_2026_maio',
            language: 'pt_BR',
            components: pixComponents(''),
        })).rejects.toBeInstanceOf(InvalidTemplatePayloadError);

        expect(fetchEvolutionApiMock).not.toHaveBeenCalled();
    });

    it('accepts a non-empty PIX code', () => {
        expect(() => assertValidTemplateComponents(pixComponents('000201010212...'))).not.toThrow();
    });

    it('rejects a resolved provider error without retrying another phone format', async () => {
        fetchEvolutionApiMock.mockResolvedValue({
            message: 'Invalid parameter',
            code: 100,
            error_data: { details: 'pix_dynamic_code.code must not be empty' },
        });

        await expect(sendTemplateMessage(apiConfig, 'zap1', {
            number: '5561992672288@s.whatsapp.net',
            name: 'fatura_velpro_clientes_2026_maio',
            language: 'pt_BR',
            components: pixComponents('000201010212...'),
        })).rejects.toBeInstanceOf(ProviderAcceptanceNotConfirmedError);

        expect(fetchEvolutionApiMock).toHaveBeenCalledTimes(1);
    });

    it('only confirms provider acceptance when a WAMID exists', async () => {
        fetchEvolutionApiMock.mockResolvedValue({ key: { id: 'wamid.test-1' } });

        const response = await sendTemplateMessage(apiConfig, 'zap1', {
            number: '5561992672288@s.whatsapp.net',
            name: 'fatura_velpro_clientes_2026_maio',
            language: 'pt_BR',
            components: pixComponents('000201010212...'),
        });

        expect(requireProviderMessageId(response)).toBe('wamid.test-1');
    });
});
