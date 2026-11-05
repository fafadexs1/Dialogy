/**
 * Closed vocabulary for "why did the AI hand this chat to a person" (docs/PLAN-ia-autonoma-transferir-encerrar.md, 3.2),
 * plus the briefing the human receives. Pure: no database, no model, no customer text beyond what the caller passes in.
 */

export const HANDOFF_REASON_CODES = [
  'cliente_pediu', 'fora_de_escopo', 'risco_sensivel', 'falha_de_ferramenta', 'incerteza_alta',
  'limite_de_turnos', 'operacao_incerta', 'reclamacao_grave', 'configuracao_invalida', 'nao_classificado',
] as const;
export type HandoffReasonCode = typeof HANDOFF_REASON_CODES[number];

export const HANDOFF_REASON_LABELS: Record<HandoffReasonCode, string> = {
  cliente_pediu: 'O cliente pediu uma pessoa',
  fora_de_escopo: 'Fora do que a IA pode resolver',
  risco_sensivel: 'Assunto sensível ou de risco',
  falha_de_ferramenta: 'Falha em uma consulta ou ferramenta',
  incerteza_alta: 'A IA não conseguiu entender o pedido',
  limite_de_turnos: 'A conversa não avançou',
  operacao_incerta: 'Uma operação ficou sem confirmação',
  reclamacao_grave: 'Cliente insatisfeito ou com o problema sem solução',
  configuracao_invalida: 'Configuração do agente precisa de revisão',
  nao_classificado: 'Motivo não classificado',
};

export const isHandoffReasonCode = (value: unknown): value is HandoffReasonCode =>
  typeof value === 'string' && (HANDOFF_REASON_CODES as readonly string[]).includes(value);

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Order matters: the first match wins. A customer asking for a person outranks every technical cause.
const TEXT_RULES: Array<[HandoffReasonCode, RegExp]> = [
  ['cliente_pediu', /(cliente|usuario).{0,40}\b(pediu|pede|solicitou|aceitou|quer|deseja|precisa de)\b.{0,40}(human[oa]|pessoa|atendente|equipe|especialista)|atendimento humano|falar com (uma )?(pessoa|humano|atendente)/],
  ['reclamacao_grave', /reclama|insatisf|ameaca|procon|advogado|processo judicial|cancelar (o )?(contrato|plano|servico)|muito irritad|nao (foi )?resolv|continua sem/],
  ['risco_sensivel', /fraude|golpe|dado sensivel|risco|juridic|seguranca da conta|clonag/],
  ['operacao_incerta', /sem confirmacao|resultado incerto|operacao.{0,30}(anterior|incompleta|incerta)|conferir|conferencia|revisao antes de repetir|nao foi possivel confirmar/],
  ['limite_de_turnos', /limite (de )?(mensagens|repeticoes|acoes|turnos)|sem conclusao|nao avanc|repeticoes|orcamento (de )?(tempo|chamadas)/],
  ['configuracao_invalida', /configuracao|dado proibido|precisa de revisao|nao foi possivel preparar|identificacao da solicitacao esta indisponivel/],
  ['incerteza_alta', /ambigu|nao foi possivel identificar|esclarec|nao (compreend|entend)|nenhum procedimento/],
  ['falha_de_ferramenta', /indisponivel|consulta|falha|erro|nao respond|fonte|integracao|ferramenta|timeout|nao foi possivel (consultar|executar)/],
  ['fora_de_escopo', /fora do (escopo|que)|nao consigo resolver|nao e possivel resolver|nao tenho (como|acesso)|excecao/],
];

/** A code declared by the model wins when valid; otherwise the free text is classified; otherwise `nao_classificado`. */
export function resolveHandoffReasonCode(input: { declared?: unknown; reason?: string | null; customerAskedForHuman?: boolean }): HandoffReasonCode {
  if (input.customerAskedForHuman) return 'cliente_pediu';
  if (isHandoffReasonCode(input.declared) && input.declared !== 'nao_classificado') return input.declared;
  const text = normalize(input.reason || '');
  if (text) for (const [code, pattern] of TEXT_RULES) if (pattern.test(text)) return code;
  return 'nao_classificado';
}

type BriefingRequest = { objective: string; status: string; values?: Record<string, unknown>; choiceLabels?: Record<string, unknown>; unavailable?: string[] };
type BriefingOperation = { title?: string; status: string; readOnly?: boolean };

export type HandoffBriefingInput = {
  reasonCode: HandoffReasonCode;
  reason?: string | null;
  requests: BriefingRequest[];
  operations: BriefingOperation[];
  pendingActionText?: string | null;
  /** True when the AI ran out of budget before finishing. */
  budgetReached?: boolean;
  queued?: { teamName?: string | null; reasonCode?: string | null } | null;
};

const SENSITIVE_KEY = /senha|password|token|cvv|otp|secret|chave|codigo.?(de )?(autent|seguranca)/i;
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const STATUS_LABELS: Record<string, string> = { active: 'em andamento', paused: 'pausado', resolved: 'resolvido', cancelled: 'cancelado' };
const OPERATION_LABELS: Record<string, string> = { succeeded: 'feito', failed: 'falhou', unknown: 'sem confirmação, conferir antes de repetir' };

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() ? clip(value.trim(), 80) : null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * Internal note for the person who takes over. It repeats what the AI knows so the customer is not asked again.
 * Values the customer typed appear, since this note is only visible inside the same workspace; secrets never do.
 */
export function buildHandoffBriefing(input: HandoffBriefingInput): string {
  const lines: string[] = ['Resumo da IA para continuar o atendimento', `Motivo: ${HANDOFF_REASON_LABELS[input.reasonCode]}`];
  const detail = (input.reason || '').trim();
  if (detail) lines.push(`Detalhe: ${clip(detail, 400)}`);
  if (input.queued) lines.push(`Fila: ${input.queued.teamName ? `equipe ${input.queued.teamName}` : 'equipe'} sem ninguém disponível no momento; o cliente foi avisado.`);

  const open = input.requests.filter((request) => request.status === 'active' || request.status === 'paused');
  if (input.requests.length) {
    lines.push('Pedidos do cliente:');
    for (const request of input.requests.slice(0, 8)) lines.push(`- ${clip(request.objective, 160)} (${STATUS_LABELS[request.status] || request.status})`);
  }

  const provided: string[] = [];
  for (const request of input.requests) {
    for (const [key, raw] of Object.entries(request.values || {})) {
      if (SENSITIVE_KEY.test(key)) continue;
      const value = formatValue(request.choiceLabels?.[key] ?? raw);
      if (value) provided.push(`${clip(key, 40)}: ${value}`);
    }
  }
  if (provided.length) lines.push('Dados que o cliente já informou:', ...[...new Set(provided)].slice(0, 12).map((item) => `- ${item}`));

  const done = input.operations.filter((operation) => operation.title && operation.title !== 'Transferir atendimento');
  if (done.length) lines.push('O que a IA já fez:', ...done.slice(-8).map((operation) => `- ${clip(operation.title!, 120)}: ${OPERATION_LABELS[operation.status] || operation.status}${operation.readOnly ? ' (consulta)' : ''}`));

  const pending: string[] = [];
  if (open.length) pending.push(...open.slice(0, 4).map((request) => `Ainda aberto: ${clip(request.objective, 140)}`));
  if (input.pendingActionText?.trim()) pending.push(`Aguardando o cliente confirmar: ${clip(input.pendingActionText.trim(), 200)}`);
  if (input.operations.some((operation) => operation.status === 'unknown' && operation.title !== 'Transferir atendimento')) pending.push('Há uma operação sem confirmação de resultado: confira no sistema externo antes de repetir.');
  if (input.budgetReached) pending.push('A IA atingiu o limite de tempo ou de tentativas antes de concluir.');
  if (pending.length) lines.push('Pendências:', ...pending.map((item) => `- ${item}`));

  return lines.join('\n');
}
