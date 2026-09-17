import { withDebug } from '@/lib/observability/logger';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import { preserveWhatsappRecipient } from '@/lib/whatsapp/bsuid';
import {
    assertValidTemplateComponents,
    requireProviderMessageId,
} from '@/services/whatsapp/template-send-contract';

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
    return preserveWhatsappRecipient(value);
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
        assertValidTemplateComponents(components);

        const phoneNumber = sanitizePhoneNumber(number);
        if (!phoneNumber) {
            throw new Error('Numero de telefone invalido para o envio do template.');
        }

        const body = {
            number: phoneNumber,
            name,
            language,
            components
        };

        const response = await fetchEvolutionAPI(
            `/message/sendTemplate/${instanceName}`,
            { api_url, api_key },
            {
                method: 'POST',
                body: JSON.stringify(body),
            }
        );

        requireProviderMessageId(response);
        return response;
    },
    {
        contextResolver: (apiConfig, instanceName, payload) => ({
            payload: { instanceName, templateName: payload.name, recipient: payload.number }
        })
    }
);
