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
import { hashValue, stableStringify } from './utils';

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
    inputSchema: toJsonSchema({ schema: tool.inputSchema }) || {},
    riskLevel: tool.riskLevel,
    requiresConfirmation: tool.requiresConfirmation,
  }));
}

export function buildAgentSystemPrompt(context: AgentRuntimeContext): string {
  const config = context.config;
  return [
    `Você é ${config.name}, um agente especializado em ${config.role}.`,
    '',
    'OBJETIVO',
    config.objective,
    '',
    'CRITÉRIOS DE CONCLUSÃO',
    config.completionCriteria.map((item, index) => `${index + 1}. ${item}`).join('\n'),
    '',
    'INSTRUÇÕES',
    config.instructions.map((item, index) => `${index + 1}. ${item}`).join('\n') || 'Siga o objetivo e os critérios de conclusão.',
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
    '4. Não repita uma ferramenta com os mesmos argumentos quando o resultado já estiver disponível.',
    '5. Peça ao usuário apenas informações realmente ausentes.',
    '6. Só retorne final quando os critérios de conclusão forem atendidos.',
    '7. Nunca afirme que uma ação foi concluída antes da confirmação da ferramenta.',
    '8. Não exponha raciocínio interno, cadeia de pensamento ou análise detalhada.',
    '9. purposeSummary deve explicar brevemente por que a ferramenta é necessária.',
    '10. Responda exclusivamente no contrato estruturado solicitado.',
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
): NodeExecutionResult {
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
        status: 'waiting',
        selectedOutput: 'needs_input',
        waitingReason: reason,
        resumeToken: `agent:${context.execution.executionId}:${context.node.id}:limit`,
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
          summary: partialResponse || 'O agente atingiu o limite operacional configurado.',
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
        ...limitResult(context, 'MAX_MODEL_CALLS_REACHED', lastPartialResponse),
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
        ...limitResult(context, 'REPEATED_DECISION_SIGNATURE', lastPartialResponse),
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
        ...limitResult(context, 'ALTERNATING_DECISION_LOOP', lastPartialResponse),
        toolCalls,
        metrics: {
          durationMs: 0,
          model: fallbackResult.selected.config.model,
          toolCalls: toolCalls.length,
          attempts: turn,
        },
      };
    }

    if (decision.type === 'final') {
      lastPartialResponse = decision.response;
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
      const availableState = {
        input: context.execution.input,
        context: context.execution.context,
        variables: context.execution.variables,
      };
      const alreadyAvailable = decision.missingFields.filter((field) => hasValueAtPath(availableState, field));
      if (alreadyAvailable.length > 0 && alreadyAvailable.length === decision.missingFields.length) {
        messages.push({
          role: 'assistant',
          content: stableStringify(decision),
        }, {
          role: 'user',
          content: `Os campos declarados como ausentes já estão disponíveis: ${alreadyAvailable.join(', ')}. Use o contexto existente e escolha outra ação.`,
        });
        continue;
      }
      return {
        status: 'waiting',
        selectedOutput: 'needs_input',
        waitingReason: 'AGENT_NEEDS_INPUT',
        resumeToken: `agent:${context.execution.executionId}:${context.node.id}:${turn}`,
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
        ...limitResult(context, 'MAX_TOOL_CALLS_REACHED', lastPartialResponse),
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
    if (toolOccurrence > config.maxRepeatedToolCalls + 1) {
      return {
        ...limitResult(context, 'REPEATED_TOOL_CALL_LIMIT', lastPartialResponse),
        toolCalls,
        metrics: {
          durationMs: 0,
          model: fallbackResult.selected.config.model,
          toolCalls: toolCalls.length,
          attempts: turn,
        },
      };
    }
    if (toolOccurrence === config.maxRepeatedToolCalls + 1) {
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
          ...limitResult(context, 'REPEATED_TOOL_CALL_LIMIT', lastPartialResponse),
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
    switch (config.fallbackOnToolError) {
      case 'continue_without_tool':
        messages.push({
          role: 'user',
          content: 'A ferramenta falhou. Continue somente se puder responder com segurança sem inventar o resultado.',
        });
        break;
      case 'ask_user':
        return {
          status: 'waiting',
          selectedOutput: 'needs_input',
          waitingReason: 'TOOL_FAILED_NEEDS_INPUT',
          resumeToken: `agent:${context.execution.executionId}:${context.node.id}:tool-error`,
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
    ...limitResult(context, 'MAX_AGENT_TURNS_REACHED', lastPartialResponse),
    toolCalls,
    metrics: {
      durationMs: 0,
      toolCalls: toolCalls.length,
      attempts: config.maxTurns,
    },
  };
}
