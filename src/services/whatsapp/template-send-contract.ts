function cleanString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function describeProviderResponse(response: any): string {
    const detail =
        response?.details?.whatsapp_error
        ?? response?.error_data?.details
        ?? response?.response?.message
        ?? response?.message
        ?? response?.error;

    if (Array.isArray(detail)) {
        return detail.map((item) => cleanString(item)).filter(Boolean).join(' | ');
    }

    if (cleanString(detail)) {
        return cleanString(detail);
    }

    return 'A Evolution respondeu sem confirmar o aceite da mensagem.';
}

export class InvalidTemplatePayloadError extends Error {
    readonly code = 'INVALID_TEMPLATE_PAYLOAD';
    readonly status = 422;

    constructor(message: string) {
        super(message);
        this.name = 'InvalidTemplatePayloadError';
    }
}

export class ProviderAcceptanceNotConfirmedError extends Error {
    readonly code = 'PROVIDER_ACCEPTANCE_NOT_CONFIRMED';
    readonly status = 502;
    readonly providerResponse: unknown;

    constructor(response: unknown) {
        super(describeProviderResponse(response));
        this.name = 'ProviderAcceptanceNotConfirmedError';
        this.providerResponse = response;
    }
}

export function assertValidTemplateComponents(components: unknown): asserts components is any[] {
    if (!Array.isArray(components)) {
        throw new InvalidTemplatePayloadError('Os componentes do template devem ser enviados em uma lista (components).');
    }

    const visit = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }

        if (!value || typeof value !== 'object') {
            return;
        }

        const record = value as Record<string, unknown>;
        if (record.type === 'pix_dynamic_code') {
            const pix = record.pix_dynamic_code;
            const code = pix && typeof pix === 'object'
                ? (pix as Record<string, unknown>).code
                : null;

            if (!cleanString(code)) {
                throw new InvalidTemplatePayloadError(
                    'Código PIX vazio ou ausente (pix_dynamic_code.code). Gere o PIX no sistema de origem e tente novamente.'
                );
            }
        }

        Object.values(record).forEach(visit);
    };

    visit(components);
}

export function parseCurrencyStringToCents(value: unknown): number | null {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0) {
            return null;
        }

        if (Number.isInteger(value)) {
            return value;
        }

        const cents = Math.round(value * 100);
        return Math.abs(value * 100 - cents) < 0.000001 ? cents : null;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const raw = value.trim();
    if (!raw || /^\{[^}]+\}$/.test(raw) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) {
        return null;
    }

    let normalized = raw
        .replace(/[^\d,.-]/g, '')
        .replace(/(?!^)-/g, '');

    if (!normalized || normalized === '-' || normalized === ',' || normalized === '.') {
        return null;
    }

    const commaIndex = normalized.lastIndexOf(',');
    const dotIndex = normalized.lastIndexOf('.');
    const decimalSeparator = commaIndex > dotIndex ? ',' : dotIndex >= 0 ? '.' : '';

    if (decimalSeparator) {
        const separatorIndex = normalized.lastIndexOf(decimalSeparator);
        const integerPart = normalized.slice(0, separatorIndex).replace(/[,.]/g, '') || '0';
        const decimalPart = normalized.slice(separatorIndex + 1).replace(/\D/g, '');

        if (decimalPart.length === 0) {
            normalized = integerPart;
        } else if (decimalPart.length <= 2) {
            normalized = `${integerPart}.${decimalPart.padEnd(2, '0')}`;
        } else {
            return null;
        }
    }

    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount < 0) {
        return null;
    }

    return Math.round(amount * 100);
}

function parseEmvTlv(code: string): Array<{ tag: string; value: string }> | null {
    if (!code.startsWith('000201')) {
        return null;
    }

    const fields: Array<{ tag: string; value: string }> = [];
    let cursor = 0;
    while (cursor < code.length) {
        if (cursor + 4 > code.length) {
            return null;
        }
        const tag = code.slice(cursor, cursor + 2);
        const length = Number.parseInt(code.slice(cursor + 2, cursor + 4), 10);
        if (!Number.isFinite(length) || length < 0 || cursor + 4 + length > code.length) {
            return null;
        }
        const value = code.slice(cursor + 4, cursor + 4 + length);
        fields.push({ tag, value });
        cursor += 4 + length;
    }

    if (fields.length === 0 || fields[fields.length - 1].tag !== '63') {
        return null;
    }

    return fields;
}

function extractPixDynamicCodeCents(orderDetails: any): number | undefined {
    const settings = Array.isArray(orderDetails?.payment_settings) ? orderDetails.payment_settings : [];
    for (const setting of settings) {
        if (setting?.type !== 'pix_dynamic_code') {
            continue;
        }
        const code = cleanString(setting?.pix_dynamic_code?.code);
        if (!code) {
            continue;
        }
        const fields = parseEmvTlv(code);
        const tag54 = fields?.find((field) => field.tag === '54');
        if (tag54) {
            const parsed = parseCurrencyStringToCents(tag54.value);
            if (parsed !== null) {
                return parsed;
            }
        }
    }
    return undefined;
}

function looksLikeExplicitCurrencyText(value: unknown): boolean {
    if (typeof value !== 'string') {
        return false;
    }
    const raw = value.trim();
    if (!raw || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) {
        return false;
    }
    return /(?:R\$|\d+[,.]\d{1,2})/.test(raw);
}

export function normalizeTemplateOrderDetailsAmounts(components: any[]): any[] {
    if (!Array.isArray(components)) {
        return components;
    }

    const clonedComponents = structuredClone(components);
    const bodyComponent = clonedComponents.find(
        (component: any) => String(component?.type || '').toLowerCase() === 'body'
    );
    const bodyParameters = Array.isArray(bodyComponent?.parameters) ? bodyComponent.parameters : [];
    const bodyValues = [...new Set(bodyParameters
        .map((parameter: any) => parameter?.text)
        .filter(looksLikeExplicitCurrencyText)
        .map(parseCurrencyStringToCents)
        .filter((value: number | null): value is number => value !== null))];
    // Only compare with the body when its monetary value is unambiguous.
    const inferredCents = bodyValues.length === 1 ? bodyValues[0] : undefined;

    for (const component of clonedComponents) {
        if (String(component?.type || '').toLowerCase() !== 'button') {
            continue;
        }

        for (const parameter of component.parameters || []) {
            const orderDetails = parameter?.action?.order_details;
            if (!orderDetails || typeof orderDetails !== 'object') {
                continue;
            }

            const pixCents = extractPixDynamicCodeCents(orderDetails);

            // Autocorrect for senders (e.g. SGP) that serialize whole-real amounts as plain numbers
            // (450.00 -> JSON 450) instead of cents (45000). An integer is only reinterpreted as reais
            // when the PIX code amount (the real charge) equals value * 100 exactly. The template body text is
            // never used as a hint: without a matching PIX the integer stays cents and the validations below apply.
            const evidenceCents = pixCents;
            const referenceRaw = orderDetails.total_amount?.value ?? orderDetails.order?.subtotal?.value;
            const referenceInteger = typeof referenceRaw === 'number' && Number.isInteger(referenceRaw)
                ? referenceRaw
                : (typeof referenceRaw === 'string' && /^\d+$/.test(referenceRaw.trim()) ? Number(referenceRaw) : undefined);
            const amountsAreReais = evidenceCents !== undefined && referenceInteger !== undefined
                && referenceInteger > 0 && referenceInteger !== evidenceCents && referenceInteger * 100 === evidenceCents;

            const normalizeAmountValue = (amount: any) => {
                if (amount === undefined || amount === null) return;
                if (typeof amount !== 'object') {
                    throw new InvalidTemplatePayloadError('Valor monetário do pedido inválido. Informe value e offset 100.');
                }
                amount.offset ??= 100;
                // Integer values are already cents unless the reais autocorrect above applies.
                const raw = amount.value;
                const integerString = typeof raw === 'string' && /^\d+$/.test(raw.trim());
                const isInteger = integerString || (typeof raw === 'number' && Number.isInteger(raw));
                const cents = amountsAreReais && isInteger
                    ? Number(raw) * 100
                    : integerString ? Number(raw) : parseCurrencyStringToCents(raw);
                if (!Number.isSafeInteger(cents) || (cents as number) < 0) {
                    throw new InvalidTemplatePayloadError('Valor monetário do pedido inválido. Corrija o valor na origem antes de enviar.');
                }
                amount.value = cents;
            };

            const monetaryAmounts = [orderDetails.total_amount, orderDetails.order?.subtotal, orderDetails.order?.tax,
                orderDetails.order?.shipping, orderDetails.order?.discount,
                ...(Array.isArray(orderDetails.order?.items) ? orderDetails.order.items.map((item: any) => item?.amount) : [])];
            if (monetaryAmounts.some((amount) => amount && amount.offset != null && amount.offset !== 100)) {
                throw new InvalidTemplatePayloadError('Os valores do pedido devem usar offset 100 (centavos).');
            }

            normalizeAmountValue(orderDetails.total_amount);
            normalizeAmountValue(orderDetails.order?.subtotal);
            normalizeAmountValue(orderDetails.order?.tax);
            normalizeAmountValue(orderDetails.order?.shipping);
            normalizeAmountValue(orderDetails.order?.discount);

            if (Array.isArray(orderDetails.order?.items)) {
                for (const item of orderDetails.order.items) {
                    normalizeAmountValue(item?.amount);
                }
            }

            const resolvedTotalCents =
                (typeof orderDetails.total_amount?.value === 'number' && Number.isInteger(orderDetails.total_amount.value)
                    ? orderDetails.total_amount.value
                    : undefined)
                ?? (typeof orderDetails.order?.subtotal?.value === 'number' && Number.isInteger(orderDetails.order.subtotal.value)
                    ? orderDetails.order.subtotal.value
                    : undefined)
                ?? inferredCents;

            if (resolvedTotalCents !== undefined && inferredCents !== undefined && resolvedTotalCents !== inferredCents) {
                throw new InvalidTemplatePayloadError('O valor do texto do template difere do total do pedido. Corrija os valores antes de enviar.');
            }
            if (resolvedTotalCents !== undefined && pixCents !== undefined && resolvedTotalCents !== pixCents) {
                throw new InvalidTemplatePayloadError('O valor do código PIX difere do total do pedido. Gere um PIX com o valor correto antes de enviar.');
            }
            const subtotal = orderDetails.order?.subtotal;
            const items = orderDetails.order?.items;
            if (Array.isArray(items) && items.some((item: any) =>
                !item?.amount || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) {
                throw new InvalidTemplatePayloadError('Item do pedido inválido. Confira o valor e a quantidade antes de enviar.');
            }
            if (Array.isArray(items) && items.length && subtotal && items.every((item: any) =>
                Number.isInteger(item?.amount?.value) && item.amount.offset === subtotal.offset &&
                Number.isInteger(item.quantity) && item.quantity > 0
            ) && items.reduce((sum: number, item: any) => sum + item.amount.value * item.quantity, 0) !== subtotal.value) {
                throw new InvalidTemplatePayloadError('A soma dos itens difere do subtotal do pedido. Corrija os valores antes de enviar.');
            }
            const adjustments = [orderDetails.order?.tax, orderDetails.order?.shipping, orderDetails.order?.discount];
            if (subtotal && orderDetails.total_amount &&
                Number.isInteger(subtotal.value) && Number.isInteger(orderDetails.total_amount.value) &&
                subtotal.offset === orderDetails.total_amount.offset &&
                adjustments.every((amount: any) => !amount || (Number.isInteger(amount.value) && amount.offset === subtotal.offset))) {
                const expected = subtotal.value + (adjustments[0]?.value || 0) + (adjustments[1]?.value || 0) - (adjustments[2]?.value || 0);
                if (expected !== orderDetails.total_amount.value) {
                    throw new InvalidTemplatePayloadError('O subtotal e os ajustes diferem do total do pedido. Corrija os valores antes de enviar.');
                }
            }
        }
    }

    return clonedComponents;
}

export function requireProviderMessageId(response: unknown): string {
    const value = response as any;
    const providerMessageId =
        cleanString(value?.key?.id)
        || cleanString(value?.messages?.[0]?.id)
        || cleanString(value?.message_id);

    if (!providerMessageId) {
        throw new ProviderAcceptanceNotConfirmedError(response);
    }

    return providerMessageId;
}
