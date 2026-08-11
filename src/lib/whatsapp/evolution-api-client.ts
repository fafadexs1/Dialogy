import { resilientFetch } from '@/lib/http/resilient-fetch';
import { buildAlternateBrazilianDigits, extractWhatsappDigits } from '@/lib/whatsapp/contact-identity';
import { getPreferredSendDigits, rememberSendDigits } from '@/lib/whatsapp/number-form-memory';

export type EvolutionApiClientConfig = {
  api_url: string;
  api_key: string;
};

function getEvolutionApiTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.EVOLUTION_API_TIMEOUT_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
}

const SEND_ENDPOINT_PATTERN = /^\/message\/send/i;

/**
 * Antes de enviar, a Evolution consulta o WhatsApp para saber se o número
 * existe (whatsapp.baileys.service -> sendMessageWithTyping). Essa consulta é
 * feita ao vivo pelo websocket do Baileys e responde `exists: false` tanto para
 * "número não existe" quanto para "não consegui verificar agora" — e também
 * quando o JID guardado está na forma errada do nono dígito.
 *
 * Nesses casos a mensagem NÃO chega a ser enviada (o 400 vem antes do envio),
 * então reenviar com a forma alternativa do número é seguro: não duplica.
 */
function parseSendBody(endpoint: string, options: RequestInit): { parsed: any; number: string } | null {
  if (!SEND_ENDPOINT_PATTERN.test(endpoint)) return null;
  if (typeof options.body !== 'string') return null;

  let parsed: any;
  try {
    parsed = JSON.parse(options.body);
  } catch {
    return null;
  }

  const number = typeof parsed?.number === 'string' ? parsed.number : null;
  if (!number) return null;

  return { parsed, number };
}

function buildBrazilianNumberFallback(
  send: { parsed: any; number: string } | null,
  status: number,
  errorBody: string
): { number: string; body: string } | null {
  if (status !== 400) return null;
  if (!send) return null;
  if (!/"exists"\s*:\s*false/i.test(errorBody)) return null;

  const digits = extractWhatsappDigits(send.number);
  const alternate = digits ? buildAlternateBrazilianDigits(digits) : null;
  if (!alternate || alternate === digits) return null;

  return { number: alternate, body: JSON.stringify({ ...send.parsed, number: alternate }) };
}

export async function fetchEvolutionAPI(
  endpoint: string,
  apiConfig: EvolutionApiClientConfig,
  options: RequestInit = {}
): Promise<any> {
  if (!apiConfig.api_url || !apiConfig.api_key) {
    throw new Error('A configuracao da API (URL e Chave) e necessaria.');
  }

  const baseUrl = apiConfig.api_url.endsWith('/')
    ? apiConfig.api_url.slice(0, -1)
    : apiConfig.api_url;
  const url = `${baseUrl}${endpoint}`;

  const perform = (body: BodyInit | null | undefined) =>
    resilientFetch(
      url,
      {
        ...options,
        body,
        headers: {
          'Content-Type': 'application/json',
          apikey: apiConfig.api_key,
          ...options.headers,
        },
      },
      {
        timeoutMs: getEvolutionApiTimeoutMs(),
        idempotent: options.method === 'GET' || options.method === 'HEAD',
        serviceKey: `evolution:${baseUrl}`,
      },
    );

  try {
    const send = parseSendBody(endpoint, options);

    // Se ja aprendemos qual forma esse numero aceita, sai direto nela em vez de
    // depender do fallback.
    let requestBody = options.body;
    const originalNumber = send?.number ?? null;
    let attemptedNumber = originalNumber;

    if (send) {
      const preferred = await getPreferredSendDigits(send.number);
      if (preferred && preferred !== extractWhatsappDigits(send.number)) {
        console.log(
          `[EVO_API_FETCH] Usando a forma memorizada do numero ${send.number} -> ${preferred}.`
        );
        attemptedNumber = preferred;
        requestBody = JSON.stringify({ ...send.parsed, number: preferred });
      }
    }

    const response = await perform(requestBody);

    if (!response.ok) {
      let errorBody = await response.text();

      const fallback = buildBrazilianNumberFallback(
        send ? { parsed: send.parsed, number: attemptedNumber! } : null,
        response.status,
        errorBody
      );

      if (fallback) {
        console.warn(
          `[EVO_API_FETCH] Numero recusado com exists=false em ${endpoint}. Repetindo com a forma alternativa do nono digito: ${fallback.number}`
        );

        const retryResponse = await perform(fallback.body);
        if (retryResponse.ok) {
          console.log(
            `[EVO_API_FETCH] Envio aceito na segunda tentativa com o numero ${fallback.number}. Memorizando essa forma.`
          );
          // Prova dupla: a forma anterior falhou e esta funcionou.
          await rememberSendDigits(originalNumber, fallback.number, 'send_fallback');

          const retryText = await retryResponse.text();
          return retryText ? JSON.parse(retryText) : null;
        }

        errorBody = `${errorBody} | fallback ${fallback.number}: ${await retryResponse.text()}`;
      }

      throw new Error(`Evolution API Error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    if (send && attemptedNumber) {
      await rememberSendDigits(originalNumber, attemptedNumber, 'send');
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    console.error(`[EVO_API_FETCH] Erro de rede ou sistema ao chamar a API Evolution. URL: ${url}. Erro:`, error);
    throw error;
  }
}
