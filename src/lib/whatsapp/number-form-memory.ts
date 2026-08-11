import {
    buildAlternateBrazilianDigits,
    extractWhatsappDigits,
    normalizeWhatsappPhoneNumber,
} from '@/lib/whatsapp/contact-identity';

/**
 * Memoria de qual forma do numero (com ou sem o nono digito) o WhatsApp aceita.
 *
 * O que sabemos com certeza vem de duas fontes:
 *  - 'inbound': o JID que o proprio WhatsApp usou ao entregar uma mensagem;
 *  - 'send' / 'send_fallback': a forma com que um envio foi aceito.
 *
 * Nada aqui pode derrubar um envio: toda falha de leitura/escrita e engolida e
 * o chamador segue com a forma normalizada de sempre.
 */

export type NumberFormSource = 'inbound' | 'send' | 'send_fallback';

// Evita ida ao banco a cada mensagem. A forma aceita muda raramente (troca de
// chip, conta recriada), entao um TTL curto ja cobre o caso sem cache furado.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { sendDigits: string; expiresAt: number }>();

function cacheKey(normalizedDigits: string): string {
    return normalizedDigits;
}

function readCache(normalizedDigits: string): string | null {
    const entry = cache.get(cacheKey(normalizedDigits));
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(cacheKey(normalizedDigits));
        return null;
    }
    return entry.sendDigits;
}

function writeCache(normalizedDigits: string, sendDigits: string): void {
    cache.set(cacheKey(normalizedDigits), { sendDigits, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Só faz sentido lembrar de numeros que tem duas formas possiveis (celular BR).
 * Para o resto, nao existe alternativa e a memoria seria ruido.
 */
function resolveVariantKey(value?: string | null): { normalized: string; alternate: string } | null {
    const normalized = normalizeWhatsappPhoneNumber(value);
    if (!normalized) return null;

    const alternate = buildAlternateBrazilianDigits(normalized);
    if (!alternate || alternate === normalized) return null;

    return { normalized, alternate };
}

export function isKnownNumberVariant(value?: string | null): boolean {
    return resolveVariantKey(value) !== null;
}

/**
 * Retorna a forma que deve ser usada no envio, ou null se ainda nao aprendemos
 * nada sobre esse numero.
 */
export async function getPreferredSendDigits(value?: string | null): Promise<string | null> {
    const variant = resolveVariantKey(value);
    if (!variant) return null;

    const cached = readCache(variant.normalized);
    if (cached) return cached;

    try {
        const { db } = await import('@/lib/db');
        const result = await db.query(
            'SELECT send_digits FROM whatsapp_number_forms WHERE normalized_digits = $1 LIMIT 1',
            [variant.normalized]
        );

        const sendDigits = result.rows[0]?.send_digits;
        if (typeof sendDigits !== 'string' || !sendDigits.trim()) return null;

        // Descarta registro que nao corresponde mais a nenhuma das duas formas
        // (numero editado no banco, por exemplo).
        if (sendDigits !== variant.normalized && sendDigits !== variant.alternate) return null;

        writeCache(variant.normalized, sendDigits);
        return sendDigits;
    } catch (error) {
        console.warn('[WA_NUMBER_FORM] Falha ao ler a forma preferida do numero.', error);
        return null;
    }
}

/**
 * Registra a forma que comprovadamente funcionou. Precedencia:
 *
 *  - 'send_fallback' sempre sobrescreve: e a unica evidencia que prova as duas
 *    coisas ao mesmo tempo, que a forma anterior parou de funcionar e que a
 *    outra funciona. Sem isso a memoria congelaria numa forma quebrada e todo
 *    envio pagaria a ida e volta extra do fallback.
 *  - 'inbound' sobrescreve: o JID que o WhatsApp usou para entregar e a
 *    verdade sobre a conta.
 *  - 'send' apenas semeia quando ainda nao ha registro. A Evolution aceita as
 *    duas formas quando a verificacao esta saudavel, entao um envio aceito nao
 *    prova qual e a forma certa e nao pode derrubar as outras fontes.
 */
export async function rememberSendDigits(
    value: string | null | undefined,
    workedValue: string | null | undefined,
    source: NumberFormSource
): Promise<void> {
    const variant = resolveVariantKey(value);
    if (!variant) return;

    const workedDigits = extractWhatsappDigits(workedValue);
    if (!workedDigits) return;
    if (workedDigits !== variant.normalized && workedDigits !== variant.alternate) return;

    try {
        const { db } = await import('@/lib/db');
        await db.query(
            `INSERT INTO whatsapp_number_forms (normalized_digits, send_digits, source, confirmed_at)
             VALUES ($1, $2, $3, timezone('utc', now()))
             ON CONFLICT (normalized_digits) DO UPDATE
                SET send_digits  = EXCLUDED.send_digits,
                    source       = EXCLUDED.source,
                    confirmed_at = EXCLUDED.confirmed_at
              WHERE EXCLUDED.source <> 'send'`,
            [variant.normalized, workedDigits, source]
        );
        writeCache(variant.normalized, workedDigits);
    } catch (error) {
        console.warn('[WA_NUMBER_FORM] Falha ao gravar a forma do numero.', error);
    }
}
