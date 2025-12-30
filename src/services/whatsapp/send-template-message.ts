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

export const sendTemplateMessage = withDebug(
    'send_template_message',
    async function sendTemplateMessage(
        apiConfig: ApiConfig,
        instanceName: string,
        payload: SendTemplatePayload
    ): Promise<any> {
        const { api_url, api_key } = apiConfig;
        const { number, name, language, components } = payload;

        const body = {
            number,
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
    },
    {
        contextResolver: (apiConfig, instanceName, payload) => ({
            payload: { instanceName, templateName: payload.name, recipient: payload.number }
        })
    }
);
