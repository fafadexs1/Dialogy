import { resilientFetch } from '@/lib/http/resilient-fetch';

export interface MercadoLivreAccountRecord {
    id: string;
    workspace_id: string;
    user_id: number; // ML User ID (numeric)
    access_token: string;
    refresh_token: string;
}

export class MercadoLivreMessagingService {
    constructor(private account: MercadoLivreAccountRecord) { }

    private get baseUrl(): string {
        return 'https://api.mercadolibre.com';
    }

    private async request(path: string, method: 'GET' | 'POST', body?: Record<string, any>) {
        const url = `${this.baseUrl}${path}`;
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.account.access_token}`,
            'Content-Type': 'application/json',
        };

        const res = await resilientFetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
            console.error('[ML Service] Error:', JSON.stringify(json, null, 2));
            throw new Error(json.message || json.error || 'Falha na requisição ao Mercado Livre');
        }

        return json;
    }

    async answerQuestion(questionId: string, text: string) {
        // https://developers.mercadolibre.com.ar/en_US/questions-and-answers#Response-to-questions
        return this.request('/answers', 'POST', {
            question_id: Number(questionId) || questionId, // API documentation says question_id is a number (Long), but mostly passed as ID
            text
        });
    }

    async sendMessage(packId: string | null, buyerId: string, text: string) {
        // https://developers.mercadolibre.com.ar/en_US/messaging-integration
        // To send a message, we usually need the 'pack_id' (order id) or we can use the generic messages endpoint if available.
        // However, the standard way is: POST /messages/packs/{pack_id}/sellers/{seller_id}

        if (!packId) {
            throw new Error('Para enviar mensagens pós-venda (não perguntas), o ID do pacote/pedido é necessário.');
        }

        const path = `/messages/packs/${packId}/sellers/${this.account.user_id}`;

        return this.request(`${path}?access_token=${this.account.access_token}`, 'POST', {
            from: {
                user_id: String(this.account.user_id),
            },
            to: {
                user_id: String(buyerId),
            },
            text
        });
    }

    async getMessage(messageId: string) {
        return this.request(`/messages/${messageId}`, 'GET');
    }

    async getQuestion(questionId: string) {
        return this.request(`/questions/${questionId}`, 'GET');
    }
}
