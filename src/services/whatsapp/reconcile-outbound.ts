import { fetchEvolutionAPI, type EvolutionApiClientConfig } from '@/lib/whatsapp/evolution-api-client';
import { buildWhatsappLookupJids } from '@/lib/whatsapp/contact-identity';

/**
 * Reconciliacao de envio: descobre se uma mensagem que "falhou" chegou a sair.
 *
 * Um timeout ou queda de rede e ambiguo -- a mensagem pode ter sido entregue e
 * so a resposta ter se perdido. Reenviar as cegas duplicaria a mensagem para o
 * cliente, e por isso o retry de whatsapp_send e desligado.
 *
 * Aqui perguntamos a Evolution o que ela realmente enviou para aquele numero na
 * janela de tempo do envio. Com essa resposta o retry deixa de ser cego:
 *
 *   'sent'    -> saiu; nao reenviar, apenas registrar o id
 *   'missing' -> comprovadamente nao saiu; reenviar e seguro
 *   'unknown' -> nao deu para verificar; manter o comportamento conservador
 *
 * O 'unknown' e o caso importante: qualquer duvida cai nele, e duvida nunca
 * autoriza reenvio.
 */

export type OutboundReconciliation =
    | { status: 'sent'; keyId: string | null }
    | { status: 'missing' }
    | { status: 'unknown'; reason: string };

// Margem para compensar diferenca de relogio entre a Dialogy e a Evolution.
const CLOCK_SKEW_MS = 60 * 1000;

function normalizeForComparison(value: unknown): string {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * A Evolution guarda o texto em campos diferentes conforme o tipo da mensagem.
 */
function extractOutboundText(record: any): string {
    const message = record?.message ?? {};
    return (
        message.conversation ??
        message.extendedTextMessage?.text ??
        message.imageMessage?.caption ??
        message.videoMessage?.caption ??
        message.documentMessage?.caption ??
        message.templateMessage?.hydratedTemplate?.hydratedContentText ??
        message.interactiveMessage?.body?.text ??
        ''
    );
}

export async function reconcileOutboundMessage(params: {
    apiConfig: EvolutionApiClientConfig;
    instanceName: string;
    number: string;
    content: string;
    sentAfter: Date;
}): Promise<OutboundReconciliation> {
    const { apiConfig, instanceName, number, content, sentAfter } = params;

    const expected = normalizeForComparison(content);
    if (!expected) {
        return { status: 'unknown', reason: 'Conteudo vazio, nao ha como correlacionar.' };
    }

    // O numero pode ter sido enviado em qualquer uma das formas do nono digito,
    // entao procuramos por todas as variantes conhecidas.
    const candidateJids = buildWhatsappLookupJids(number);
    if (candidateJids.length === 0) {
        return { status: 'unknown', reason: 'Numero sem JID resolvivel.' };
    }

    const gte = new Date(sentAfter.getTime() - CLOCK_SKEW_MS).toISOString();
    const lte = new Date(Date.now() + CLOCK_SKEW_MS).toISOString();

    for (const remoteJid of candidateJids) {
        let response: any;
        try {
            response = await fetchEvolutionAPI(`/chat/findMessages/${instanceName}`, apiConfig, {
                method: 'POST',
                body: JSON.stringify({
                    where: {
                        key: { remoteJid, fromMe: true },
                        messageTimestamp: { gte, lte },
                    },
                }),
            });
        } catch (error: any) {
            // Nao conseguimos verificar: qualquer conclusao aqui seria um chute.
            return {
                status: 'unknown',
                reason: `Falha ao consultar a Evolution: ${error?.message || 'erro desconhecido'}`,
            };
        }

        const records = response?.messages?.records;
        if (!Array.isArray(records)) {
            return { status: 'unknown', reason: 'Resposta da Evolution em formato inesperado.' };
        }

        const match = records.find((record: any) => normalizeForComparison(extractOutboundText(record)) === expected);
        if (match) {
            return { status: 'sent', keyId: match?.key?.id ?? null };
        }
    }

    // Consultamos com sucesso todas as variantes e a mensagem nao esta la.
    return { status: 'missing' };
}
