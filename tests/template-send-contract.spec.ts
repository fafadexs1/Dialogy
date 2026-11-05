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
    normalizeTemplateOrderDetailsAmounts,
    parseCurrencyStringToCents,
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

    it('converts decimal numeric and string monetary values to integer cents with offset 100', async () => {
        fetchEvolutionApiMock.mockResolvedValue({ key: { id: 'wamid.test-2' } });

        const components: any[] = [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: 'GILVAN ALVES FERREIRA' },
                    { type: 'text', text: '26597' },
                    { type: 'text', text: '17/10/2026' },
                    { type: 'text', text: '123.38' },
                    { type: 'text', text: '26597' },
                ],
            },
            {
                type: 'button',
                sub_type: 'order_details',
                index: '0',
                parameters: [
                    {
                        type: 'action',
                        action: {
                            order_details: {
                                reference_id: 'fatura_26597',
                                type: 'digital-goods',
                                payment_type: 'br',
                                payment_settings: [
                                    {
                                        type: 'pix_dynamic_code',
                                        pix_dynamic_code: {
                                            code: '00020101021226900014br.gov.bcb.pix2568pix.santander.com.br/qr/v2/cobv/327bdad3-5ccf-46c2-b2a7-46ab63d2bf795204000053039865406123.385802BR5925VELPRO TELECOMUNICACOES L6015VALPARAISO DE G62070503***6304ABCD',
                                            merchant_name: 'VELPRO TELECOM',
                                            key: '00000000000000',
                                            key_type: 'CNPJ',
                                        },
                                    },
                                ],
                                currency: 'BRL',
                                total_amount: { value: 123.38, offset: 100 },
                                order: {
                                    status: 'pending',
                                    items: [
                                        {
                                            retailer_id: 'fatura_26597',
                                            name: 'Fatura 26597',
                                            amount: { value: 123.38, offset: 100 },
                                            quantity: 1,
                                        },
                                    ],
                                    subtotal: { value: 123.38, offset: 100 },
                                    tax: { value: 0, offset: 100 },
                                },
                            },
                        },
                    },
                ],
            },
        ];

        await sendTemplateMessage(apiConfig, 'zap1', {
            number: '5561992672288@s.whatsapp.net',
            name: 'fatura_velpro_clientes_2026_maio',
            language: 'pt_BR',
            components,
        });

        const sentBody = JSON.parse(fetchEvolutionApiMock.mock.calls[0][2].body);
        const sentOrderDetails = sentBody.components[1].parameters[0].action.order_details;

        expect(sentOrderDetails.total_amount).toEqual({ value: 12338, offset: 100 });
        expect(sentOrderDetails.order.subtotal).toEqual({ value: 12338, offset: 100 });
        expect(sentOrderDetails.order.items[0].amount).toEqual({ value: 12338, offset: 100 });
        expect(sentOrderDetails.order.tax).toEqual({ value: 0, offset: 100 });
    });

    it('preserves cent integers and whole-reais amounts encoded in cents', () => {
        expect(parseCurrencyStringToCents(123.38)).toBe(12338);
        expect(parseCurrencyStringToCents(92.72)).toBe(9272);
        expect(parseCurrencyStringToCents('119,90')).toBe(11990);
        expect(parseCurrencyStringToCents(12338)).toBe(12338);

        const normalizedWholeReais = normalizeTemplateOrderDetailsAmounts([
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: 'CLIENTE TESTE' },
                    { type: 'text', text: '26597' },
                    { type: 'text', text: '17/10/2026' },
                    { type: 'text', text: '100.00' },
                ],
            },
            {
                type: 'button',
                sub_type: 'order_details',
                parameters: [
                    {
                        type: 'action',
                        action: {
                            order_details: {
                                total_amount: { value: 10000, offset: 100 },
                                order: {
                                    subtotal: { value: 10000, offset: 100 },
                                    tax: { value: 0, offset: 100 },
                                    items: [{ amount: { value: 10000, offset: 100 }, quantity: 1 }],
                                },
                            },
                        },
                    },
                ],
            },
        ]);

        const od = normalizedWholeReais[1].parameters[0].action.order_details;
        expect(od.total_amount).toEqual({ value: 10000, offset: 100 });
        expect(od.order.subtotal).toEqual({ value: 10000, offset: 100 });
        expect(od.order.tax).toEqual({ value: 0, offset: 100 });
        expect(od.order.items[0].amount).toEqual({ value: 10000, offset: 100 });
    });

    it('rejects a PIX nominal value that differs from the order without rewriting it', () => {
        expect(() => normalizeTemplateOrderDetailsAmounts([
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: 'LUIZ GUILHERME CARVALHO DE ARAUJO' },
                    { type: 'text', text: '28589' },
                    { type: 'text', text: '17/10/2026' },
                    { type: 'text', text: '124.42' },
                    { type: 'text', text: '28589' },
                ],
            },
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
                                        pix_dynamic_code: {
                                            code: '00020101021226900014br.gov.bcb.pix2568pix.santander.com.br/qr/v2/cobv/f159d97e-2073-4786-beb5-40b17e6e65c55204000053039865406119.905802BR5925VELPRO TELECOMUNICACOES L6015VALPARAISO DE G62070503***63049758',
                                        },
                                    },
                                ],
                                total_amount: { value: 124.42, offset: 100 },
                                order: {
                                    subtotal: { value: 124.42, offset: 100 },
                                    items: [{ amount: { value: 124.42, offset: 100 }, quantity: 1 }],
                                },
                            },
                        },
                    },
                ],
            },
        ])).toThrow(/código PIX difere/);
    });
    it('blocks the actual incident before calling Evolution', async () => {
        const components: any[] = [
            { type: 'body', parameters: [{ text: 'LUCAS' }, { text: '3647' }, { text: '15/10/2026' }, { text: '79.99' }, { text: '3647' }] },
            { type: 'button', sub_type: 'order_details', parameters: [{ type: 'action', action: { order_details: {
                total_amount: { value: 9990, offset: 100 },
                order: { subtotal: { value: 9990, offset: 100 }, items: [{ amount: { value: 9990, offset: 100 }, quantity: 1 }] },
            } } }] },
        ];
        await expect(sendTemplateMessage(apiConfig, 'zap1', { number: '5561995819094', name: 'fatura', language: 'pt_BR', components }))
            .rejects.toThrow(/valor do texto.*difere/);
        expect(fetchEvolutionApiMock).not.toHaveBeenCalled();
    });

    it('rejects inconsistent item totals', () => {
        const components: any[] = [{ type: 'button', parameters: [{ action: { order_details: {
            total_amount: { value: 7999, offset: 100 }, order: { subtotal: { value: 7999, offset: 100 }, items: [{ amount: { value: 9990, offset: 100 }, quantity: 1 }] },
        } } }] }];
        expect(() => normalizeTemplateOrderDetailsAmounts(components)).toThrow(/soma dos itens/);
    });

    it.each([
        ['79.99', 79.99, 7999], ['79,99', '79,99', 7999], ['79.99', 7999, 7999],
        ['81.99', 81.99, 8199], ['81,99', '81,99', 8199], ['81.99', '8199', 8199],
        ['100.00', 10000, 10000],
    ])('sends exactly the invoice amount %s through repeated normalization', async (body, value, cents) => {
        fetchEvolutionApiMock.mockResolvedValue({ key: { id: 'wamid.correct-amount' } });
        const amount = (Number(cents) / 100).toFixed(2);
        const pix = `00020154${String(amount.length).padStart(2, '0')}${amount}63040000`;
        const components: any[] = [
            { type: 'body', parameters: [{ type: 'text', text: body }] },
            { type: 'button', sub_type: 'order_details', parameters: [{ type: 'action', action: { order_details: {
                total_amount: { value, offset: 100 },
                order: { subtotal: { value, offset: 100 }, tax: { value: 0, offset: 100 }, items: [{ amount: { value, offset: 100 }, quantity: 1 }] },
                payment_settings: [{ type: 'pix_dynamic_code', pix_dynamic_code: { code: pix } }],
            } } }] },
        ];
        const normalized = normalizeTemplateOrderDetailsAmounts(components);
        expect(normalizeTemplateOrderDetailsAmounts(normalized)).toEqual(normalized);
        await sendTemplateMessage(apiConfig, 'zap1', { number: '5561995819094', name: 'fatura', language: 'pt_BR', components: normalized });
        const sent = JSON.parse(fetchEvolutionApiMock.mock.calls[0][2].body).components;
        const details = sent[1].parameters[0].action.order_details;
        expect(sent[0].parameters[0].text).toBe(body);
        expect(details.total_amount.value).toBe(cents);
        expect(details.order.subtotal.value).toBe(cents);
        expect(details.order.items[0].amount.value).toBe(cents);
        expect(details.payment_settings[0].pix_dynamic_code.code).toBe(pix);
        expect(components[1].parameters[0].action.order_details.total_amount.value).toBe(value);
    });

    it.each([undefined, null, '', 'inválido', -1, 79.999, '79.999'])('rejects invalid money %s instead of filling it from the body', (value) => {
        expect(() => normalizeTemplateOrderDetailsAmounts([
            { type: 'body', parameters: [{ text: '79.99' }] },
            { type: 'button', parameters: [{ action: { order_details: { total_amount: { value, offset: 100 } } } }] },
        ])).toThrow(/monetário.*inválido/);
    });

    it('never changes 100 cents to 100 reais using the body as a hint', () => {
        expect(() => normalizeTemplateOrderDetailsAmounts([
            { type: 'body', parameters: [{ text: '100.00' }] },
            { type: 'button', parameters: [{ action: { order_details: { total_amount: { value: 100, offset: 100 } } } }] },
        ])).toThrow(/valor do texto.*difere/);
    });


    describe('whole-reais autocorrect (SGP sends 450.00 as JSON 450)', () => {
        const pix = (amount: string) =>
            `00020152040000530398654${String(amount.length).padStart(2, '0')}${amount}5802BR5906VELPRO62070503***63047E7A`;
        const build = (body: string, value: number, pixAmount: string) => [
            { type: 'body', parameters: [{ type: 'text', text: 'NOME' }, { type: 'text', text: body }] },
            { type: 'button', parameters: [{ action: { order_details: {
                total_amount: { value, offset: 100 },
                payment_settings: [{ type: 'pix_dynamic_code', pix_dynamic_code: { code: pix(pixAmount) } }],
                order: { subtotal: { value, offset: 100 }, tax: { value: 0, offset: 100 },
                    items: [{ name: 'Fatura', amount: { value, offset: 100 }, quantity: 1 }] },
            } } }] },
        ];

        it('converts whole-reais integers to cents when the PIX confirms value * 100', () => {
            const od = normalizeTemplateOrderDetailsAmounts(build('450.00', 450, '450.00'))[1].parameters[0].action.order_details;
            expect([od.total_amount.value, od.order.subtotal.value, od.order.items[0].amount.value]).toEqual([45000, 45000, 45000]);
            expect(od.order.tax.value).toBe(0);
        });

        it('keeps values already in cents', () => {
            const od = normalizeTemplateOrderDetailsAmounts(build('450.00', 45000, '450.00'))[1].parameters[0].action.order_details;
            expect(od.total_amount.value).toBe(45000);
        });

        it('still rejects an amount that matches neither cents nor reais', () => {
            expect(() => normalizeTemplateOrderDetailsAmounts(build('450.00', 300, '450.00'))).toThrow(/difere/);
        });

        it('still rejects when the body disagrees with the corrected total', () => {
            expect(() => normalizeTemplateOrderDetailsAmounts(build('999.00', 450, '450.00'))).toThrow(/valor do texto.*difere/);
        });
    });
});
