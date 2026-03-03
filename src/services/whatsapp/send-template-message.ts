import { withDebug } from '@/lib/observability/logger';
import { fetchEvolutionAPI } from '@/actions/evolution-api';

interface TemplateComponent {
    type: string;
    sub_type?: string;
    index?: string;
    parameters: any[];
}

interface SendTemplatePayload {
    number: string;
    name: string;
    language: string;
    components: TemplateComponent[];
}

interface ApiConfig {
    api_url: string;
    api_key: string;
}

function sanitizePhoneNumber(value: string): string {
    return value.replace(/@.*$/, '').replace(/\D/g, '');
}

function getBrazilianNumberVariants(value: string): { withoutNinthDigit: string; withNinthDigit: string } | null {
    const cleanNumber = sanitizePhoneNumber(value);

    let nationalNumber: string | null = null;
    if (cleanNumber.startsWith('55') && (cleanNumber.length === 12 || cleanNumber.length === 13)) {
        nationalNumber = cleanNumber.slice(2);
    } else if (cleanNumber.length === 10 || cleanNumber.length === 11) {
        nationalNumber = cleanNumber;
    } else {
        return null;
    }

    const ddd = nationalNumber.slice(0, 2);
    if (!/^\d{2}$/.test(ddd)) {
        return null;
    }

    if (nationalNumber.length === 11) {
        // 2-digit DDD + 9-digit mobile number. Only convert if the extra digit is actually 9.
        if (nationalNumber[2] !== '9') {
            return null;
        }

        return {
            withoutNinthDigit: `55${ddd}${nationalNumber.slice(3)}`,
            withNinthDigit: `55${nationalNumber}`,
        };
    }

    return {
        withoutNinthDigit: `55${nationalNumber}`,
        withNinthDigit: `55${ddd}9${nationalNumber.slice(2)}`,
    };
}

function buildTemplateSendCandidates(number: string): string[] {
    const candidates: string[] = [];

    const addCandidate = (candidate?: string | null) => {
        if (!candidate) return;
        const normalized = candidate.trim();
        if (!normalized) return;
        if (!candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    };

    const brazilianVariants = getBrazilianNumberVariants(number);
    if (brazilianVariants) {
        // Business rule: prioritize sending without the extra mobile "9" first.
        addCandidate(brazilianVariants.withoutNinthDigit);
        addCandidate(brazilianVariants.withNinthDigit);
    }

    addCandidate(sanitizePhoneNumber(number));
    addCandidate(number);

    return candidates;
}

export const sendTemplateMessage = withDebug(
    'send_template_message',
    async function sendTemplateMessage(
        apiConfig: ApiConfig,
        instanceName: string,
        payload: SendTemplatePayload
    ): Promise<any> {
        const { api_url, api_key } = apiConfig;
        const { number, name, language, components } = payload;

        const sendRequest = async (phoneNumber: string) => {
            const body = {
                number: phoneNumber,
                name,
                language,
                components
            };
            return fetchEvolutionAPI(
                `/message/sendTemplate/${instanceName}`,
                { api_url, api_key },
                {
                    method: 'POST',
                    body: JSON.stringify(body),
                }
            );
        };

        const candidates = buildTemplateSendCandidates(number);
        let firstError: unknown = null;

        for (let attempt = 0; attempt < candidates.length; attempt++) {
            const candidate = candidates[attempt];

            try {
                if (attempt > 0) {
                    console.log(`[TEMPLATE_FALLBACK] Retrying sendTemplate (${attempt + 1}/${candidates.length}) with number: ${candidate}`);
                }
                return await sendRequest(candidate);
            } catch (error) {
                if (!firstError) {
                    firstError = error;
                }
                console.warn(`[TEMPLATE_FALLBACK] Attempt ${attempt + 1}/${candidates.length} failed for number ${candidate}`);
            }
        }

        throw firstError ?? new Error(`Falha ao enviar template para o numero ${number}.`);
    },
    {
        contextResolver: (apiConfig, instanceName, payload) => ({
            payload: { instanceName, templateName: payload.name, recipient: payload.number }
        })
    }
);
