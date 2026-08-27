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
