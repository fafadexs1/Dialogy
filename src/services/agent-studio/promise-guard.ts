/**
 * Promise guard (docs/PLAN-ia-autonoma-transferir-encerrar.md, 3.4): the AI must not say it did, or is doing,
 * something the system did not do in this turn. Pure text-against-facts check, no model.
 *
 * Covers the claims that were seen in production and that cost the most when false:
 *   - "encaminhei / vou te transferir"          requires a confirmed transfer;
 *   - "vou encerrar / encerrei o atendimento"   requires the close to be decided by the gate;
 *   - "reservei / agendei / alterei / cancelei" requires a successful write in this turn;
 *   - "enviei o boleto / a fatura"              requires a successful operation in this turn.
 * It does NOT judge commercial facts (prices, coverage, deadlines): that needs source grounding and is a separate step.
 *
 * STUDIO_PROMISE_GUARD = off | observe | enforce. Default `observe`: violations are recorded in the ledger and the
 * reply is sent unchanged, so the rate can be measured before anything is rewritten.
 */

export type StudioPromiseGuardMode = 'off' | 'observe' | 'enforce';
export function studioPromiseGuardMode(): StudioPromiseGuardMode {
  const value = (process.env.STUDIO_PROMISE_GUARD || 'observe').trim().toLowerCase();
  return value === 'off' || value === 'enforce' ? value : 'observe';
}

export type StudioPromiseFacts = {
  /** The transfer was confirmed in this turn. */
  transferred: boolean;
  /** The chat is being closed in this turn (explicit gate passed, or legacy resolved session). */
  closing: boolean;
  /** A write operation succeeded in this turn. */
  successfulWrites: number;
  /** Any operation (read or write) succeeded in this turn. */
  successfulOperations: number;
};

export type StudioPromiseViolation = { kind: 'transfer' | 'close' | 'action' | 'delivery' };

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const CLAIMS: Array<{ kind: StudioPromiseViolation['kind']; pattern: RegExp; supported: (facts: StudioPromiseFacts) => boolean }> = [
  { kind: 'transfer', supported: (f) => f.transferred,
    pattern: /\b(?:transferi|encaminhei|ja (?:te )?(?:transferi|encaminhei)|estou (?:te )?(?:transferindo|encaminhando)|(?:vou|irei) (?:te )?(?:transferir|encaminhar)|(?:seu atendimento )?(?:foi|esta sendo) (?:transferido|encaminhado)|passei (?:o|seu) atendimento|estou passando (?:voce|seu atendimento))\b/ },
  { kind: 'close', supported: (f) => f.closing,
    pattern: /\b(?:(?:vou|irei) (?:te )?(?:encerrar|finalizar|fechar) (?:o|seu|esse|este) atendimento|estou (?:encerrando|finalizando|fechando) (?:o|seu|esse|este) atendimento|(?:encerrei|finalizei|fechei) (?:o|seu|esse|este) atendimento|(?:o |seu )?atendimento (?:foi|esta sendo|sera) (?:encerrado|finalizado|fechado)|vou encerrar por aqui)\b/ },
  { kind: 'action', supported: (f) => f.successfulWrites > 0,
    pattern: /\b(?:reservei|agendei|cancelei|alterei|atualizei|liberei|ativei|desbloqueei|contratei|troquei|renovei|registrei|abri (?:um |uma |o |a )?(?:chamado|protocolo|ordem)|gerei (?:a |o |uma |um )?(?:segunda via|boleto|fatura|protocolo|chamado)|(?:ja )?(?:esta|foi|ficou) (?:reservad|agendad|cancelad|alterad|atualizad|liberad|ativad|desbloquead|contratad|trocad|renovad|registrad)[oa])\b/ },
  { kind: 'delivery', supported: (f) => f.successfulOperations > 0,
    pattern: /\b(?:enviei|mandei) (?:para voce |pra voce )?(?:o|a|um|uma) (?:boleto|fatura|comprovante|link|segunda via|contrato|codigo pix|qr code)\b/ },
];

// Phrasings that are questions or offers, not claims: "posso agendar?", "quer que eu reserve?"
const OFFER = /\?|\b(?:posso|podemos|quer que eu|gostaria que eu|deseja que eu|se quiser|caso queira|assim que|depois que|quando)\b/;

const FALLBACK: Record<StudioPromiseViolation['kind'], string> = {
  transfer: 'Estou confirmando o melhor caminho para seguir com o seu atendimento e já te retorno.',
  close: 'Antes de finalizar, me diga se posso ajudar em mais alguma coisa.',
  action: 'Ainda estou confirmando esse passo e já te retorno com o resultado.',
  delivery: 'Ainda estou confirmando o envio e já te retorno.',
};

const splitSentences = (text: string) => text.split(/(?<=[.!?…])\s+|\n+/).map((part) => part.trim()).filter(Boolean);

export function guardStudioPromises(input: { response: string; facts: StudioPromiseFacts }): { response: string; violations: StudioPromiseViolation[]; changed: boolean } {
  const sentences = splitSentences(input.response);
  const kept: string[] = [];
  const violations: StudioPromiseViolation[] = [];
  for (const sentence of sentences) {
    const text = normalize(sentence);
    const broken = OFFER.test(text) ? null : CLAIMS.find((claim) => claim.pattern.test(text) && !claim.supported(input.facts));
    if (broken) { violations.push({ kind: broken.kind }); continue; }
    kept.push(sentence);
  }
  if (!violations.length) return { response: input.response, violations, changed: false };
  const response = kept.length ? kept.join(' ') : FALLBACK[violations[0].kind];
  return { response, violations, changed: true };
}
