import { toJsonSchema, validateSchema } from 'genkit/schema';
import { AgentDecisionSchema, AgentNodeConfigSchema } from './schemas';
import type { ModelFallbackChain, ModelMessage } from './model-adapter';
import type {
  AgentDecision,
  AgentNodeConfig,
  NodeExecutionResult,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowExecution,
  WorkflowNode,
} from './types';
import type { ToolRegistry } from './tools';
import { hashValue, isRecord, renderTemplate, stableStringify } from './utils';
import { responseRequestsMoreCustomerInput } from '@/services/autopilot/close-intent';
import { toolInputSchemaForPrompt } from './tool-arguments';

export type AgentRuntimeContext = {
  config: AgentNodeConfig;
  execution: WorkflowExecution;
  workflow: WorkflowDefinition;
  node: WorkflowNode;
  modelChain: ModelFallbackChain;
  tools: ToolRegistry;
  memory?: Record<string, unknown>;
  knowledge?: Array<Record<string, unknown>>;
  signal: AbortSignal;
  emit: (event: Omit<WorkflowEvent, 'id' | 'sequence' | 'createdAt'>) => Promise<void>;
};

type DecisionHistoryEntry = {
  signature: string;
  stateSignature: string;
};

function buildToolDescription(registry: ToolRegistry) {
  return registry.list().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: toolInputSchemaForPrompt(
      tool.inputJsonSchema || toJsonSchema({ schema: tool.inputSchema }) || {},
    ),
    riskLevel: tool.riskLevel,
    requiresConfirmation: tool.requiresConfirmation,
  }));
}

export function buildAgentSystemPrompt(context: AgentRuntimeContext): string {
  const config = context.config;
  const templateSource = {
    ...context.execution.variables,
    input: context.execution.input,
    variables: context.execution.variables,
    context: context.execution.context,
    sessionId: context.execution.sessionId,
    conversationId: context.execution.conversationId,
  };
  const render = (value: string) => renderTemplate(value, templateSource);
  return [
    `Você é ${render(config.name)}, um agente especializado em ${render(config.role)}.`,
    `Idioma de atendimento: ${config.language}.`,
    '',
    'PERSONA',
    config.persona ? render(config.persona) : 'Adote uma comunicação clara, respeitosa e coerente com o papel definido.',
    '',
    'OBJETIVO',
    render(config.objective),
    '',
    'CRITÉRIOS DE CONCLUSÃO',
    config.completionCriteria.map((item, index) => `${index + 1}. ${render(item)}`).join('\n'),
    '',
    'INSTRUÇÕES',
    config.instructions.map((item, index) => `${index + 1}. ${render(item)}`).join('\n') || 'Siga o objetivo e os critérios de conclusão.',
    '',
    'CONTEXTO ATUAL',
    stableStringify({
      input: context.execution.input,
      context: context.execution.context,
      availableContext: config.availableContext,
    }),
    '',
    'ESTADO DA TAREFA',
    stableStringify(context.execution.variables),
    '',
    'MEMÓRIA RELEVANTE',
    stableStringify(context.memory || {}),
    '',
    'CONHECIMENTO RECUPERADO',
    stableStringify(context.knowledge || []),
    '',
    'FERRAMENTAS DISPONÍVEIS',
    stableStringify(buildToolDescription(context.tools)),
    '',
    'REGRAS DE EXECUÇÃO',
    '1. Use apenas fatos do contexto, memória, conhecimento e resultados confirmados de ferramentas.',
    '2. Para consultar ou alterar sistemas externos, retorne tool_call; não execute nem invente o resultado.',
    '3. Use somente as ferramentas listadas e forneça todos os argumentos exigidos.',
    '4. Não repita uma ferramenta com os mesmos argumentos quando o resultado terminal já estiver disponível. Se uma consulta retornar pending, queued, sent, running ou processing, consulte novamente até obter um estado terminal ou atingir o limite.',
    '5. Peça ao usuário apenas informações realmente ausentes.',
    '6. Só retorne final quando os critérios de conclusão forem atendidos.',
    '7. Nunca afirme que uma ação foi concluída antes da confirmação da ferramenta.',
    '8. Não exponha raciocínio interno, cadeia de pensamento ou análise detalhada.',
    '9. purposeSummary deve explicar brevemente por que a ferramenta é necessária.',
    '10. Responda exclusivamente no contrato estruturado solicitado.',
    '11. Nunca pergunte qual opção, item, horário, produto, serviço ou alternativa o cliente prefere antes de apresentar as escolhas. Referências como "desses", "dessas", "deles", "delas", "esse" e "qual mais interessou" precisam ter um referente claro na conversa ou na própria resposta.',
    '12. Ao retornar handoff, use summary somente como contexto interno objetivo para a equipe e customerMessage como a mensagem visível ao cliente. Agradeça ou confirme o encaminhamento em customerMessage, nunca apenas em summary.',
  ].join('\n');
}

function hasValueAtPath(source: Record<string, unknown>, path: string): boolean {
  const segments = path.split('.');
  let current: unknown = source;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return current !== undefined && current !== null && current !== '';
}

function normalizeFieldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function knownFieldsFromState(state: Record<string, unknown>): Record<string, unknown> {
  const candidates = [
    state.knownFields,
    isRecord(state.memory) ? state.memory.knownFields : null,
    isRecord(state.context) ? state.context.knownFields : null,
  ];
  return candidates.reduce<Record<string, unknown>>((merged, candidate) => (
    isRecord(candidate) ? { ...merged, ...candidate } : merged
  ), {});
}

function hasKnownField(
  requestedField: string,
  availableState: Record<string, unknown>,
): boolean {
  if (hasValueAtPath(availableState, requestedField)) return true;
  const requested = normalizeFieldName(requestedField.split('.').pop() || requestedField);
  const knownFields = knownFieldsFromState(availableState);
  const normalizedKnown = new Map(
    Object.entries(knownFields)
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
      .map(([key, value]) => [normalizeFieldName(key), String(value)]),
  );
  if (normalizedKnown.has(requested)) return true;

  const aliases: Array<{ pattern: RegExp; key: string }> = [
    { pattern: /\b(nome|nome completo|titular)\b/, key: 'name' },
    { pattern: /\b(cpf|cnpj|documento|identificador)\b/, key: 'customer identifier' },
    { pattern: /\b(telefone|whatsapp|celular|numero de contato)\b/, key: 'phone' },
    { pattern: /\b(email|e mail)\b/, key: 'email' },
    { pattern: /\b(endereco|logradouro|rua|localidade|residencia)\b/, key: 'address' },
    { pattern: /\b(produto|servico|plano|preferencia|opcao)\b/, key: 'product or service preference' },
  ];
  const alias = aliases.find((item) => item.pattern.test(requested));
  if (alias && normalizedKnown.has(alias.key)) return true;

  const address = normalizedKnown.get('address') || '';
  if (/\b(cep|codigo postal|postal code|zip)\b/.test(requested)) {
    return /\b\d{5}-?\d{3}\b/.test(address);
  }
  if (/\b(complemento|apartamento|apto|bloco|casa|numero da residencia)\b/.test(requested)) {
    return /\b(complemento|apartamento|apto|bloco|casa|numero|n\s*\d)\b/i.test(address);
  }
  return false;
}

function availableFieldState(context: AgentRuntimeContext): Record<string, unknown> {
  return {
    input: context.execution.input,
    context: context.execution.context,
    variables: context.execution.variables,
    memory: context.memory || {},
    knownFields: isRecord(context.memory?.knownFields) ? context.memory.knownFields : {},
  };
}

function requestedKnownFieldsFromResponse(
  response: string,
  availableState: Record<string, unknown>,
): string[] {
  const normalized = normalizeFieldName(response);
  const requestCue = '(?:qual|informe|envie|passe|forneca|preciso|necessito|confirme|digite|diga|pode me dizer|pode me passar|por favor)';
  const fields: Array<{ label: string; pattern: string }> = [
    { label: 'name', pattern: '(?:nome|nome completo|titular)' },
    { label: 'customer_identifier', pattern: '(?:cpf|cnpj|documento|identificador)' },
    { label: 'phone', pattern: '(?:telefone|whatsapp|celular|numero de contato)' },
    { label: 'email', pattern: '(?:email|e mail)' },
    { label: 'CEP', pattern: '(?:cep|codigo postal|postal code|zip)' },
    { label: 'address', pattern: '(?:endereco|logradouro|rua|localidade|residencia)' },
    { label: 'address complement', pattern: '(?:complemento|apartamento|apto|bloco|casa|numero da residencia)' },
    { label: 'product or service preference', pattern: '(?:produto|servico|plano|preferencia|opcao)' },
  ];

  return fields
    .filter((field) => hasKnownField(field.label, availableState))
    .filter((field) => (
      new RegExp(`\\b${requestCue}\\b.{0,80}\\b${field.pattern}\\b`).test(normalized)
      || new RegExp(`\\b${field.pattern}\\b.{0,40}\\b(?:por favor|novamente|de novo|qual|informe|envie|passe|confirme)\\b`).test(normalized)
    ))
    .map((field) => field.label);
}

type UnsupportedChoiceReference = {
  phrase: string;
  subject: string | null;
};

function normalizeConversationalText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function choiceSubjectFromMatch(match: RegExpMatchArray): string | null {
  const subject = String(match[1] || '')
    .replace(/\b(?:mais|que|te|lhe|voce|prefere|preferiu|interessou|interessa|agradou|agrada|escolhe|escolheria|chamou)\b.*$/i, '')
    .trim();
  return subject || null;
}

function findChoiceReference(value: string): (UnsupportedChoiceReference & { index: number }) | null {
  const normalized = normalizeConversationalText(value);
  const patterns = [
    /\b(?:qual|quais|algum|alguma|alguns|algumas)\s+(?:desses|dessas|destes|destas|deles|delas)(?:\s+([a-z][a-z -]{0,40}?))?(?=\s+(?:mais|que|te|lhe|voce|prefere|preferiu|interessou|interessa|agradou|agrada|escolhe|escolheria|chamou)\b|[?!.,]|$)/i,
    /\bqual(?:\s+d[oa]s?)?\s+([a-z][a-z -]{0,30}?)\s+(?:mais\s+)?(?:te\s+|lhe\s+)?(?:interessou|interessa|agradou|agrada|prefere|preferiu|escolhe|escolheria|chamou)(?=[?!.,\s]|$)/i,
    /\b(?:esse|essa|esses|essas|este|esta|estes|estas)\s+([a-z][a-z -]{0,30}?)\s+(?:te\s+|lhe\s+)?(?:interessou|interessa|agradou|agrada|serve|atende)(?=[?!.,\s]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match || match.index === undefined) continue;
    return {
      phrase: match[0].trim(),
      subject: choiceSubjectFromMatch(match),
      index: match.index,
    };
  }
  return null;
}

function singularChoiceToken(value: string): string {
  if (value.length > 4 && value.endsWith('oes')) return value.slice(0, -3);
  if (value.length > 4 && value.endsWith('es')) return value.slice(0, -2);
  if (value.length > 3 && value.endsWith('s')) return value.slice(0, -1);
  return value;
}

function textMentionsChoiceSubject(value: string, subject: string | null): boolean {
  if (!subject) return true;
  const stopWords = new Set(['a', 'as', 'o', 'os', 'de', 'do', 'da', 'dos', 'das', 'opcao', 'opcoes', 'alternativa', 'alternativas']);
  const tokens = normalizeFieldName(subject)
    .split(' ')
    .filter((token) => token.length > 1 && !stopWords.has(token));
  if (tokens.length === 0) return true;
  const normalized = ` ${normalizeFieldName(value)} `;
  return tokens.some((token) => {
    const stem = singularChoiceToken(token);
    return new RegExp(`\\b${stem}[a-z0-9]*\\b`, 'i').test(normalized);
  });
}

function looksLikeChoicePresentation(value: string, subject: string | null): boolean {
  if (!value.trim() || !textMentionsChoiceSubject(value, subject)) return false;
  const normalized = normalizeConversationalText(value);
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const listLines = lines.filter((line) => /^(?:[-*•‣◦⁃] |\d{1,2}[.)-]\s|[^\p{L}\p{N}\s]{1,3}\s)/u.test(line));
  const commaCount = (value.match(/[,;]/g) || []).length;
  const hasJoinedAlternatives = commaCount >= 1 && /\b(?:e|ou)\b/.test(normalized);
  const hasLabeledAlternatives = /:\s*[^\n]{1,80}\b(?:e|ou)\b/.test(normalized);
  const repeatedValues = (
    (value.match(/R\$\s*\d/gi) || []).length >= 2
    || (value.match(/\b\d{1,2}(?::\d{2}|h\b)/gi) || []).length >= 2
  );
  return listLines.length >= 2
    || lines.length >= 3
    || commaCount >= 2
    || hasJoinedAlternatives
    || hasLabeledAlternatives
    || repeatedValues;
}

function unsupportedChoiceReference(
  response: string,
  memory?: Record<string, unknown>,
): UnsupportedChoiceReference | null {
  const reference = findChoiceReference(response);
  if (!reference) return null;

  const responseBeforeReference = response.slice(0, reference.index);
  if (looksLikeChoicePresentation(responseBeforeReference, reference.subject)) return null;

  const recentMessages = Array.isArray(memory?.recentMessages)
    ? memory.recentMessages.filter(isRecord)
    : [];
  const priorAssistantPresentation = recentMessages.some((message) => (
    message.fromMe === true
    && typeof message.content === 'string'
    && looksLikeChoicePresentation(message.content, reference.subject)
  ));
  if (priorAssistantPresentation) return null;

  return { phrase: reference.phrase, subject: reference.subject };
}

/**
 * Identifies a complete customer-facing choice turn: the alternatives are
 * available in the response (or in a recent assistant turn) and the response
 * asks the customer to select one of them. This is intentionally domain
 * agnostic so a known broad category (for example, a service family) cannot be
 * mistaken for the concrete option the customer still needs to choose.
 */
function presentedChoiceRequest(
  response: string,
  memory?: Record<string, unknown>,
): UnsupportedChoiceReference | null {
  const reference = findChoiceReference(response);
  if (!reference) return null;

  const responseBeforeReference = response.slice(0, reference.index);
  if (looksLikeChoicePresentation(responseBeforeReference, reference.subject)) {
    return { phrase: reference.phrase, subject: reference.subject };
  }

  const recentMessages = Array.isArray(memory?.recentMessages)
    ? memory.recentMessages.filter(isRecord)
    : [];
  const priorAssistantPresentation = recentMessages.some((message) => (
    message.fromMe === true
    && typeof message.content === 'string'
    && looksLikeChoicePresentation(message.content, reference.subject)
  ));
  return priorAssistantPresentation
    ? { phrase: reference.phrase, subject: reference.subject }
    : null;
}

function relevantState(context: AgentRuntimeContext, toolState: Record<string, unknown>) {
  return {
    variables: context.execution.variables,
    context: context.execution.context,
    toolState,
  };
}

function decisionSignature(
  decision: AgentDecision,
  context: AgentRuntimeContext,
  toolState: Record<string, unknown>,
) {
  return hashValue({
    action: decision.type,
    toolName: decision.type === 'tool_call' ? decision.toolName : undefined,
    normalizedArguments: decision.type === 'tool_call' ? decision.arguments : undefined,
    relevantState: relevantState(context, toolState),
  });
}

function toolArgumentSignature(decision: Extract<AgentDecision, { type: 'tool_call' }>) {
  return hashValue({
    toolName: decision.toolName,
    normalizedArguments: decision.arguments,
  });
}

const TRANSIENT_TOOL_STATUSES = new Set([
  'accepted',
  'enqueued',
  'enqueued_with_sync',
  'in_progress',
  'pending',
  'processing',
  'queued',
  'running',
  'scheduled',
  'sent',
]);

function hasTransientToolStatus(value: unknown, depth = 0): boolean {
  if (depth > 6 || value == null) return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasTransientToolStatus(item, depth + 1));
  }
  if (!isRecord(value)) return false;
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizeFieldName(key).replace(/ /g, '_');
    if (
      (normalizedKey === 'status'
        || normalizedKey.endsWith('_status')
        || normalizedKey === 'state'
        || normalizedKey === 'phase')
      && TRANSIENT_TOOL_STATUSES.has(
        String(item || '').trim().toLowerCase().replace(/[\s-]+/g, '_'),
      )
    ) {
      return true;
    }
    if ((Array.isArray(item) || isRecord(item)) && hasTransientToolStatus(item, depth + 1)) {
      return true;
    }
  }
  return false;
}

function hasPendingToolOperation(toolState: Record<string, unknown>): boolean {
  return Object.values(toolState).some((value) => hasTransientToolStatus(value));
}

function detectsAlternation(history: DecisionHistoryEntry[]): boolean {
  if (history.length < 4) return false;
  const recent = history.slice(-4);
  const alternates = recent[0]?.signature === recent[2]?.signature
    && recent[1]?.signature === recent[3]?.signature
    && recent[0]?.signature !== recent[1]?.signature;
  const unchangedState = new Set(recent.map((entry) => entry.stateSignature)).size === 1;
  return alternates && unchangedState;
}

function validateStructuredFinalOutput(
  config: AgentNodeConfig,
  decision: Extract<AgentDecision, { type: 'final' }>,
): string | null {
  if (!config.requireStructuredFinalOutput) return null;
  if (!decision.structuredOutput) return 'Structured final output is required.';
  if (!config.finalOutputSchema) return 'A final output schema is required by the agent configuration.';
  const validation = validateSchema(decision.structuredOutput, {
    jsonSchema: config.finalOutputSchema,
  });
  if (!validation.valid) {
    return `Structured final output failed validation: ${stableStringify(validation.errors || [])}`;
  }
  return null;
}

function limitResult(
  context: AgentRuntimeContext,
  reason: string,
  partialResponse?: string,
  toolState?: Record<string, unknown>,
): NodeExecutionResult {
  if (toolState && hasPendingToolOperation(toolState)) {
    return {
      status: 'route',
      selectedOutput: 'limit_reached',
      output: {
        reason,
        response: 'A solicitação foi enviada ao equipamento e ainda está sendo processada. Não é necessário repetir o pedido; a alteração será aplicada assim que o processamento terminar.',
        completionStatus: 'partial',
      },
    };
  }
  switch (context.config.onLimitReached) {
    case 'return_partial':
      return {
        status: 'route',
        selectedOutput: 'limit_reached',
        output: {
          reason,
          response: partialResponse || '',
          completionStatus: 'partial',
        },
      };
    case 'ask_user':
      return {
        status: 'route',
        selectedOutput: 'needs_input',
        output: {
          type: 'needs_input',
          question: 'Preciso de uma informação adicional para continuar com segurança.',
          missingFields: [],
          reason,
        },
      };
    case 'handoff':
      return {
        status: 'route',
        selectedOutput: 'handoff',
        output: {
          type: 'handoff',
          reason,
          summary: partialResponse
            ? `Transferência automática por ${reason}. Contexto para continuidade: ${partialResponse}`
            : `Transferência automática por ${reason}. O agente atingiu o limite operacional configurado.`,
          customerMessage: 'Obrigado pelas informações. Vou encaminhar seu atendimento para nossa equipe continuar por aqui.',
        },
      };
    default:
      return {
        status: 'error',
        selectedOutput: 'error',
        error: {
          code: reason,
          message: 'Agent execution reached a configured limit.',
          retryable: false,
        },
      };
  }
}

export async function executeAgentNode(
  rawContext: AgentRuntimeContext,
): Promise<NodeExecutionResult> {
  const config = AgentNodeConfigSchema.parse(rawContext.config);
  const context: AgentRuntimeContext = { ...rawContext, config };
  const messages: ModelMessage[] = [{
    role: 'system',
    content: buildAgentSystemPrompt(context),
  }, {
    role: 'user',
    content: `Execute o objetivo usando esta entrada:\n${stableStringify(context.execution.input)}`,
  }];
  const decisionCounts = new Map<string, number>();
  const toolArgumentCounts = new Map<string, number>();
  const decisionHistory: DecisionHistoryEntry[] = [];
  const toolState: Record<string, unknown> = {};
  const toolCalls = [];
  let modelCalls = 0;
  let lastPartialResponse = '';
  let strategyRedirects = 0;
  let partialFinalCorrectionIssued = false;

  for (let turn = 1; turn <= config.maxTurns; turn += 1) {
    if (context.signal.aborted) {
      return {
        status: 'error',
        error: {
          code: 'AGENT_CANCELLED',
          message: 'Agent execution was cancelled.',
          retryable: false,
        },
      };
    }
    if (modelCalls >= context.workflow.settings.maxModelCalls) {
      await context.emit({
        type: 'agent.limit_reached',
        executionId: context.execution.executionId,
        workflowId: context.workflow.id,
        nodeId: context.node.id,
        safeSummary: 'Limite global de chamadas ao modelo atingido',
        data: { reason: 'MAX_MODEL_CALLS_REACHED' },
      });
      return {
        ...limitResult(context, 'MAX_MODEL_CALLS_REACHED', lastPartialResponse, toolState),
        toolCalls,
        metrics: {
          durationMs: 0,
          model: undefined,
          toolCalls: toolCalls.length,
          attempts: turn,
        },
      };
    }

    await context.emit({
      type: 'agent.thinking.started',
      executionId: context.execution.executionId,
      workflowId: context.workflow.id,
      nodeId: context.node.id,
      safeSummary: 'Analisando a solicitação',
      data: { turn },
    });

    let fallbackResult;
    try {
      modelCalls += 1;
      fallbackResult = await context.modelChain.generateStructured({
        messages,
        schema: AgentDecisionSchema,
        schemaName: 'dialogy_agent_decision',
        timeoutMs: config.modelTimeoutMs,
        signal: context.signal,
      });
    } finally {
      await context.emit({
        type: 'agent.thinking.finished',
        executionId: context.execution.executionId,
        workflowId: context.workflow.id,
        nodeId: context.node.id,
        safeSummary: 'Análise concluída',
        data: { turn },
      });
    }

    const decision = AgentDecisionSchema.parse(fallbackResult.output);
    const signature = decisionSignature(decision, context, toolState);
    const stateSignature = hashValue(relevantState(context, toolState));
    decisionHistory.push({ signature, stateSignature });
    const occurrence = (decisionCounts.get(signature) || 0) + 1;
    decisionCounts.set(signature, occurrence);

    if (occurrence > context.workflow.settings.maxRepeatedDecisionSignatures + 1) {
      return {
        ...limitResult(context, 'REPEATED_DECISION_SIGNATURE', lastPartialResponse, toolState),
        toolCalls,
        metrics: {
          durationMs: 0,
          model: fallbackResult.selected.config.model,
          toolCalls: toolCalls.length,
          attempts: turn,
        },
      };
    }
    if (detectsAlternation(decisionHistory)) {
      return {
        ...limitResult(context, 'ALTERNATING_DECISION_LOOP', lastPartialResponse, toolState),
        toolCalls,
        metrics: {
          durationMs: 0,
          model: fallbackResult.selected.config.model,
          toolCalls: toolCalls.length,
          attempts: turn,
        },
      };
    }

    const customerFacingDecisionText = decision.type === 'final'
      ? decision.response
      : decision.type === 'needs_input'
        ? decision.question
        : null;
    const unsupportedReference = customerFacingDecisionText
      ? unsupportedChoiceReference(customerFacingDecisionText, context.memory)
      : null;
    if (unsupportedReference) {
      messages.push({
        role: 'assistant',
        content: stableStringify(decision),
      }, {
        role: 'user',
        content: `A resposta contém uma referência sem antecedente ("${unsupportedReference.phrase}"). As escolhas ainda não foram apresentadas ao cliente. Corrija a resposta completa: primeiro apresente as opções relevantes usando apenas fatos confirmados do contexto ou conhecimento e somente depois, se necessário, pergunte qual ele prefere. Não envie uma pergunta que pressuponha conteúdo omitido.`,
      });
      continue;
    }

    if (decision.type === 'final') {
      lastPartialResponse = decision.response;
      const presentedChoice = decision.completionStatus === 'partial'
        ? presentedChoiceRequest(decision.response, context.memory)
        : null;
      if (presentedChoice) {
        return {
          status: 'route',
          selectedOutput: 'needs_input',
          output: {
            type: 'needs_input',
            question: decision.response,
            missingFields: ['selected_option'],
            statePatch: decision.statePatch,
          },
          statePatch: decision.statePatch,
          toolCalls,
          metrics: {
            durationMs: 0,
            model: fallbackResult.selected.config.model,
            toolCalls: toolCalls.length,
            attempts: turn,
          },
        };
      }
      const repeatedKnownFields = requestedKnownFieldsFromResponse(
        decision.response,
        availableFieldState(context),
      );
      if (repeatedKnownFields.length > 0) {
        messages.push({
          role: 'assistant',
          content: stableStringify(decision),
        }, {
          role: 'user',
          content: `A resposta voltou a pedir campos já conhecidos: ${repeatedKnownFields.join(', ')}. Use esses valores e peça somente dados realmente ausentes.`,
        });
        continue;
      }
      const invalidFinal = validateStructuredFinalOutput(config, decision);
      if (invalidFinal) {
        messages.push({
          role: 'assistant',
          content: stableStringify(decision),
        }, {
          role: 'user',
          content: `${invalidFinal} Corrija a saída e retorne novamente o contrato completo.`,
        });
        continue;
      }
      if (
        decision.completionStatus === 'partial'
        && !partialFinalCorrectionIssued
        && turn < config.maxTurns
      ) {
        partialFinalCorrectionIssued = true;
        const asksForMoreInput = responseRequestsMoreCustomerInput(decision.response);
        messages.push({
          role: 'assistant',
          content: stableStringify(decision),
        }, {
          role: 'user',
          content: asksForMoreInput
            ? 'A resposta estÃ¡ pedindo mais dados, portanto nÃ£o pode ser uma saÃ­da final parcial. Retorne type=needs_input com apenas os missingFields realmente ausentes. Se nenhum dado falta e todos os critÃ©rios foram cumpridos, retorne type=final com completionStatus=completed. Se depender de atendimento humano, retorne type=handoff.'
            : 'A resposta foi apresentada como final, mas completionStatus=partial deixa o estado ambÃ­guo. Reavalie os critÃ©rios: se foram cumpridos, retorne type=final com completionStatus=completed; se falta dado do cliente, retorne type=needs_input com missingFields exatos; se depender de atendimento humano, retorne type=handoff. NÃ£o agradeÃ§a nem declare conclusÃ£o enquanto o objetivo estiver parcial.',
        });
        continue;
      }
      return {
        status: 'completed',
        selectedOutput: decision.completionStatus === 'completed' ? 'completed' : 'limit_reached',
        output: decision,
        statePatch: decision.statePatch,
        toolCalls,
        metrics: {
          durationMs: 0,
          model: fallbackResult.selected.config.model,
          toolCalls: toolCalls.length,
          attempts: turn,
        },
      };
    }

    if (decision.type === 'needs_input') {
      if (decision.missingFields.length === 0) {
        if (turn >= config.maxTurns && hasPendingToolOperation(toolState)) {
          return {
            ...limitResult(context, 'PENDING_TOOL_OPERATION', lastPartialResponse, toolState),
            toolCalls,
            metrics: {
              durationMs: 0,
              model: fallbackResult.selected.config.model,
              toolCalls: toolCalls.length,
              attempts: turn,
            },
          };
        }
        messages.push({
          role: 'assistant',
          content: stableStringify(decision),
        }, {
          role: 'user',
          content: 'missingFields está vazio, portanto não há informação a pedir ao cliente. Se uma operação estiver pendente, consulte novamente o status. Se terminou, retorne type=final. Se depender de intervenção humana, retorne type=handoff.',
        });
        continue;
      }
      const availableState = availableFieldState(context);
      const alreadyAvailable = decision.missingFields.filter((field) => hasKnownField(field, availableState));
      if (alreadyAvailable.length > 0) {
        const actuallyMissing = decision.missingFields.filter((field) => !alreadyAvailable.includes(field));
        messages.push({
          role: 'assistant',
          content: stableStringify(decision),
        }, {
          role: 'user',
          content: `Os campos declarados como ausentes já estão disponíveis: ${alreadyAvailable.join(', ')}. Use o contexto existente. Se ainda precisar perguntar, limite-se a: ${actuallyMissing.join(', ') || 'nenhum campo'}.`,
        });
        continue;
      }
      return {
        status: 'route',
        selectedOutput: 'needs_input',
        output: decision,
        toolCalls,
        metrics: {
          durationMs: 0,
          model: fallbackResult.selected.config.model,
          toolCalls: toolCalls.length,
          attempts: turn,
        },
      };
    }

    if (decision.type === 'handoff') {
      return {
        status: 'route',
        selectedOutput: 'handoff',
        output: decision,
        toolCalls,
        metrics: {
          durationMs: 0,
          model: fallbackResult.selected.config.model,
          toolCalls: toolCalls.length,
          attempts: turn,
        },
      };
    }

    if (toolCalls.length >= config.maxToolCalls || toolCalls.length >= context.workflow.settings.maxToolCalls) {
      return {
        ...limitResult(context, 'MAX_TOOL_CALLS_REACHED', lastPartialResponse, toolState),
        toolCalls,
        metrics: {
          durationMs: 0,
          model: fallbackResult.selected.config.model,
          toolCalls: toolCalls.length,
          attempts: turn,
        },
      };
    }

    const argumentSignature = toolArgumentSignature(decision);
    const toolOccurrence = (toolArgumentCounts.get(argumentSignature) || 0) + 1;
    toolArgumentCounts.set(argumentSignature, toolOccurrence);
    const definition = context.tools.get(decision.toolName);
    const isSafePendingPoll = Boolean(
      definition?.allowRepeatedCallsWhilePending
      && hasTransientToolStatus(toolState[argumentSignature]),
    );
    if (!isSafePendingPoll && toolOccurrence > config.maxRepeatedToolCalls + 1) {
      return {
        ...limitResult(context, 'REPEATED_TOOL_CALL_LIMIT', lastPartialResponse, toolState),
        toolCalls,
        metrics: {
          durationMs: 0,
          model: fallbackResult.selected.config.model,
          toolCalls: toolCalls.length,
          attempts: turn,
        },
      };
    }
    if (!isSafePendingPoll && toolOccurrence === config.maxRepeatedToolCalls + 1) {
      strategyRedirects += 1;
      messages.push({
        role: 'assistant',
        content: stableStringify(decision),
      }, {
        role: 'user',
        content: `A ferramenta ${decision.toolName} já foi solicitada repetidamente com os mesmos argumentos. Não a execute novamente; escolha uma estratégia diferente.`,
      });
      if (strategyRedirects > 1) {
        return {
          ...limitResult(context, 'REPEATED_TOOL_CALL_LIMIT', lastPartialResponse, toolState),
          toolCalls,
          metrics: {
            durationMs: 0,
            model: fallbackResult.selected.config.model,
            toolCalls: toolCalls.length,
            attempts: turn,
          },
        };
      }
      continue;
    }

    const toolResult = await context.tools.executeSafely({
      toolName: decision.toolName,
      arguments: decision.arguments,
      purposeSummary: decision.purposeSummary,
      execution: context.execution,
      workflow: context.workflow,
      node: context.node,
      signal: context.signal,
      timeoutMs: config.toolTimeoutMs,
      emit: context.emit,
    });
    toolCalls.push(toolResult.record);
    toolState[argumentSignature] = toolResult.output || {
      error: toolResult.record.error,
      status: toolResult.record.status,
    };
    messages.push({
      role: 'assistant',
      content: stableStringify(decision),
    }, {
      role: 'tool',
      name: decision.toolName,
      toolCallId: toolResult.record.id,
      content: stableStringify({
        status: toolResult.record.status,
        output: toolResult.output,
        error: toolResult.record.error,
      }),
    });

    if (toolResult.record.status === 'success') continue;
    if (
      toolResult.record.error?.code === 'INVALID_TOOL_ARGUMENTS'
      && turn < config.maxTurns
      && Boolean(context.tools.get(decision.toolName)?.inputJsonSchema)
    ) {
      messages.push({
        role: 'user',
        content: stableStringify({
          instruction: 'Corrija os argumentos e retorne uma nova tool_call. Use exatamente os nomes e tipos do schema. Nao peca novamente dados que ja estao no contexto.',
          toolName: decision.toolName,
          validationError: toolResult.record.error.message,
          expectedInputSchema: toolInputSchemaForPrompt(
            definition?.inputJsonSchema || toJsonSchema({ schema: definition?.inputSchema }) || {},
          ),
        }),
      });
      continue;
    }
    switch (config.fallbackOnToolError) {
      case 'continue_without_tool':
        messages.push({
          role: 'user',
          content: 'A ferramenta falhou. Continue somente se puder responder com segurança sem inventar o resultado.',
        });
        break;
      case 'ask_user':
        return {
          status: 'route',
          selectedOutput: 'needs_input',
          output: {
            type: 'needs_input',
            question: 'Não consegui concluir a consulta automática. Você pode fornecer mais detalhes?',
            missingFields: [],
          },
          toolCalls,
          metrics: {
            durationMs: 0,
            model: fallbackResult.selected.config.model,
            toolCalls: toolCalls.length,
            attempts: turn,
          },
        };
      case 'route_to_error':
        return {
          status: 'error',
          selectedOutput: 'error',
          error: toolResult.record.error || {
            code: 'TOOL_EXECUTION_FAILED',
            message: `Tool ${decision.toolName} failed.`,
            retryable: false,
          },
          toolCalls,
          metrics: {
            durationMs: 0,
            model: fallbackResult.selected.config.model,
            toolCalls: toolCalls.length,
            attempts: turn,
          },
        };
      case 'retry':
        break;
    }
  }

  return {
    ...limitResult(context, 'MAX_AGENT_TURNS_REACHED', lastPartialResponse, toolState),
    toolCalls,
    metrics: {
      durationMs: 0,
      toolCalls: toolCalls.length,
      attempts: config.maxTurns,
    },
  };
}
