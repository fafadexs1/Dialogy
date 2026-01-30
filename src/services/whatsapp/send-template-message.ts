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

/**
 * Generate alternate Brazilian phone number format
 * Brazilian mobile numbers can have 8 or 9 digits after DDD
 * Format: 55 + DDD(2 digits) + number(8 or 9 digits)
 * 
 * If number has 9 digits after DDD (13 total after 55), remove the leading 9
 * If number has 8 digits after DDD (12 total after 55), add a leading 9
 * 
 * @param number - Phone number in format 55XXXXXXXXXXX
 * @returns Alternate format or null if not applicable
 */
function getAlternateBrazilianNumber(number: string): string | null {
    // Clean the number - remove any non-digit characters and @s.whatsapp.net suffix
    const cleanNumber = number.replace(/@s\.whatsapp\.net/g, '').replace(/\D/g, '');

    // Only process Brazilian numbers (starting with 55)
    if (!cleanNumber.startsWith('55')) {
        return null;
    }

    // Get the part after country code (55)
    const withoutCountryCode = cleanNumber.slice(2);

    // Brazilian format: DDD (2 digits) + number (8-9 digits)
    // Total length after 55: 10 digits (8-digit number) or 11 digits (9-digit number)

    if (withoutCountryCode.length === 11) {
        // Has 9 digits in number (55 + DD + 9 + 8 digits = 13 total)
        // Try removing the 9th digit (first digit after DDD)
        const ddd = withoutCountryCode.slice(0, 2);
        const afterNine = withoutCountryCode.slice(3); // Skip DDD (2) + 9 (1)

        // Only remove if the 3rd digit is actually a 9
        if (withoutCountryCode[2] === '9') {
            return `55${ddd}${afterNine}`;
        }
    } else if (withoutCountryCode.length === 10) {
        // Has 8 digits in number (55 + DD + 8 digits = 12 total)
        // Try adding a 9 after DDD
        const ddd = withoutCountryCode.slice(0, 2);
        const restOfNumber = withoutCountryCode.slice(2);
        return `55${ddd}9${restOfNumber}`;
    }

    return null;
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

        try {
            // First attempt with original number
            const result = await sendRequest(number);
            return result;
        } catch (firstError: any) {
            // Check if this is a Brazilian number and we can try alternate format
            const alternateNumber = getAlternateBrazilianNumber(number);

            if (alternateNumber) {
                console.log(`[TEMPLATE_FALLBACK] First attempt failed for ${number}, trying alternate format: ${alternateNumber}`);

                try {
                    const retryResult = await sendRequest(alternateNumber);
                    console.log(`[TEMPLATE_FALLBACK] Success with alternate number: ${alternateNumber}`);
                    return retryResult;
                } catch (secondError: any) {
                    console.error(`[TEMPLATE_FALLBACK] Both attempts failed. Original: ${number}, Alternate: ${alternateNumber}`);
                    // Throw the original error as it's more relevant
                    throw firstError;
                }
            }

            // Not a Brazilian number or no alternate format available
            throw firstError;
        }
    },
    {
        contextResolver: (apiConfig, instanceName, payload) => ({
            payload: { instanceName, templateName: payload.name, recipient: payload.number }
        })
    }
);
