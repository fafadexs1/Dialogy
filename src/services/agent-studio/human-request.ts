/**
 * "A customer asking for a person beats everything" (docs/GOLD-DATASET-rotulagem.md, rule 3), as plain code.
 * High precision on purpose: the cost of a false positive is one transfer, but a missed request is the worst
 * thing the AI can do. Ambiguous phrasings ("pode chamar o técnico", "preciso de uma pessoa para instalar") are NOT matched.
 *
 * Each agent opts in from the Studio (concludeStage.automation.transferWhenCustomerAsksForPerson).
 */

const normalize = (value: string) => value
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const HUMAN = '(?:humano|atendente|atendentes|atendente humano|pessoa de verdade|pessoa real|gente de verdade|supervisor|supervisora|gerente)';

const PATTERNS: RegExp[] = [
  // "quero falar com um atendente", "gostaria de um humano", "preciso de um atendente"
  new RegExp(`\\b(?:quero|queria|preciso|precisava|gostaria|prefiro|exijo)\\b.{0,30}\\b${HUMAN}\\b`),
  // "me passa pra um atendente", "transfere para uma pessoa de verdade", "chama um atendente"
  new RegExp(`\\b(?:me passa|me passe|passa|passe|transfere|transfira|transferir|encaminha|encaminhe|encaminhar|chama|chame|chamar|coloca|coloque|manda|mande)\\b.{0,30}\\b${HUMAN}\\b`),
  // "falar com alguém", "falar com uma pessoa", "conversar com o responsável"
  /\b(?:falar|conversar|atendimento)\b.{0,12}\bcom\b.{0,10}\b(?:alguem|uma pessoa|pessoa|um humano|o responsavel|a responsavel)\b/,
  /\batendimento (?:humano|por pessoa|com pessoa)\b/,
  /\b(?:pessoa de verdade|gente de verdade|atendente de verdade|humano de verdade)\b/,
  // "não quero falar com robô"
  /\bnao (?:quero|preciso|aguento) (?:mais )?(?:falar |conversar )?(?:com |de )?(?:robo|bot|maquina|atendimento automatico|inteligencia artificial)\b/,
  // English / Spanish, same as the older control detector
  /\b(?:human agent|real person|talk to (?:a )?(?:human|person|agent|support)|speak to (?:a )?(?:human|someone|person|agent))\b/,
  /\b(?:hablar con (?:un |una |el )?|quiero (?:un |una )|necesito (?:un |una ))(?:agente|persona|humano)\b/,
  /\bnao (?:aguento|suporto) (?:mais )?(?:esse |essa |este |esta |o |a )?(?:robo|bot|maquina)\b/,
];

/** Questions about people are not requests ("vocês têm atendente aos domingos?", "o atendente foi grosseiro"). */
const NOT_A_REQUEST = /\b(?:o|a|esse|essa|aquele|aquela|seu|sua) (?:atendente|gerente|supervisor|supervisora)\b.{0,30}\b(?:foi|era|estava|me|nao|ja)\b|\b(?:tem|tem algum|voces tem|ha|existe)\b.{0,20}\b(?:atendente|humano)\b/;

export function detectHumanRequest(message: string): boolean {
  if (!message) return false;
  const text = normalize(message);
  if (!text || text.length > 300) return false;
  if (NOT_A_REQUEST.test(text) && !/\b(?:quero|preciso|gostaria|queria|me passa|chama|transfere|falar com)\b/.test(text)) return false;
  return PATTERNS.some((pattern) => pattern.test(text));
}
