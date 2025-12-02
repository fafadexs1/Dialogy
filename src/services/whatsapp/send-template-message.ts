import { withDebug } from '@/lib/observability/logger';

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

        // Ensure URL ends with /
        const baseUrl = api_url.endsWith('/') ? api_url : `${api_url}/`;
        const url = `${baseUrl}message/sendTemplate/${instanceName}`;

        const body = {
            number,
            name,
            language,
            components
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': api_key,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Evolution API Error (${response.status}): ${errorText}`);
        }

        return await response.json();
    },
    {
        contextResolver: (apiConfig, instanceName, payload) => ({
            payload: { instanceName, templateName: payload.name, recipient: payload.number }
        })
    }
);
