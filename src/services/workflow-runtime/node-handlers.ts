import { z } from 'zod';
import { validateSchema } from 'genkit/schema';
import { executeAgentNode } from './agent-loop';
import type { ModelFallbackChain } from './model-adapter';
import type {
  AgentNodeConfig,
  NodeExecutionResult,
  NodeHandler,
  NodeHandlerRegistry as NodeHandlerRegistryContract,
  NodeRuntimeInput,
  WorkflowExecution,
  WorkflowNode,
} from './types';
import { AgentNodeConfigSchema } from './schemas';
import { evaluateWorkflowGoalCompletion } from './goal-completion';
import type { ToolRegistry } from './tools';
import {
  createId,
  isRecord,
  materializeValue,
  readPath,
  renderTemplate,
  stableStringify,
  withTimeout,
} from './utils';

type AgentDependencyContext = {
  execution: WorkflowExecution;
  node: WorkflowNode;
  modelNode: WorkflowNode;
  toolNodes: WorkflowNode[];
  memoryNode?: WorkflowNode;
  knowledgeNodes: WorkflowNode[];
  guardrailNodes: WorkflowNode[];
};

export type WorkflowHandlerDependencies = {
  resolveModelChain?: (context: AgentDependencyContext) => Promise<ModelFallbackChain>;
  resolveToolRegistry?: (context: AgentDependencyContext) => Promise<ToolRegistry>;
  loadMemory?: (context: AgentDependencyContext) => Promise<Record<string, unknown>>;
  retrieveKnowledge?: (context: AgentDependencyContext) => Promise<Array<Record<string, unknown>>>;
  applyGuardrails?: (
    phase: 'input' | 'output',
    value: Record<string, unknown>,
    context: AgentDependencyContext,
  ) => Promise<Record<string, unknown>>;
  executePrompt?: (input: NodeRuntimeInput) => Promise<NodeExecutionResult>;
  sendResponse?: (
    message: string,
    input: NodeRuntimeInput,
  ) => Promise<Record<string, unknown>>;
  handoff?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  closeConversation?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  loadState?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  saveState?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  executeSubflow?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
};

export class WorkflowNodeHandlerRegistry implements NodeHandlerRegistryContract {
  private readonly handlers = new Map<string, NodeHandler>();

  register(handler: NodeHandler): this {
    if (this.handlers.has(handler.type)) {
      throw new Error(`Node handler ${handler.type} is already registered.`);
    }
    this.handlers.set(handler.type, handler);
    return this;
  }

  get(nodeType: string): NodeHandler | undefined {
    return this.handlers.get(nodeType);
  }

  listTypes(): string[] {
    return [...this.handlers.keys()].sort();
  }
}

function sourceContext(input: NodeRuntimeInput) {
  return {
    input: input.execution.input,
    current: input.input,
    variables: input.execution.variables,
    context: input.execution.context,
    nodeResults: input.execution.nodeResults,
  };
}

function success(
  output: Record<string, unknown>,
  statePatch?: Record<string, unknown>,
  selectedOutput = 'success',
): NodeExecutionResult {
  return {
    status: 'success',
    selectedOutput,
    output,
    statePatch,
  };
}

function compare(left: unknown, operator: string, right: unknown): boolean {
  switch (operator) {
    case 'equals':
    case 'eq':
      return left === right;
    case 'not_equals':
    case 'neq':
      return left !== right;
    case 'contains':
      return typeof left === 'string'
        ? left.includes(String(right ?? ''))
        : Array.isArray(left) && left.includes(right);
    case 'not_contains':
      return !compare(left, 'contains', right);
    case 'starts_with':
      return typeof left === 'string' && left.startsWith(String(right ?? ''));
    case 'ends_with':
      return typeof left === 'string' && left.endsWith(String(right ?? ''));
    case 'greater_than':
    case 'gt':
      return Number(left) > Number(right);
    case 'greater_or_equal':
    case 'gte':
      return Number(left) >= Number(right);
    case 'less_than':
    case 'lt':
      return Number(left) < Number(right);
    case 'less_or_equal':
    case 'lte':
      return Number(left) <= Number(right);
    case 'exists':
      return left !== undefined && left !== null && left !== '';
    case 'not_exists':
      return left === undefined || left === null || left === '';
    case 'matches':
      try {
        return typeof left === 'string' && new RegExp(String(right)).test(left);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function resolveConditionOperand(value: unknown, source: Record<string, unknown>) {
  if (typeof value === 'string' && value.startsWith('$.')) return readPath(source, value);
  return materializeValue(value, source);
}

function triggerHandler(type: string): NodeHandler {
  return {
    type,
    execute: async (input) => success(structuredClone(input.execution.input)),
  };
}

const setHandler: NodeHandler = {
  type: 'data.set',
  configSchema: z.object({
    assignments: z.record(z.unknown()),
  }).passthrough(),
  execute: async (input) => {
    const source = sourceContext(input);
    const assignments = materializeValue(input.node.config.assignments || {}, source);
    if (!isRecord(assignments)) {
      return {
        status: 'error',
        error: {
          code: 'INVALID_ASSIGNMENTS',
          message: 'Set node assignments must produce an object.',
          retryable: false,
        },
      };
    }
    return success({ ...input.input, ...assignments }, assignments);
  },
};

const transformHandler: NodeHandler = {
  type: 'data.transform',
  execute: async (input) => {
    const source = sourceContext(input);
    const mappings = isRecord(input.node.config.mappings) ? input.node.config.mappings : {};
    const transformed = materializeValue(mappings, source);
    const output = isRecord(transformed) ? transformed : {};
    const outputKey = typeof input.node.config.outputKey === 'string'
      ? input.node.config.outputKey.trim()
      : '';
    return success(
      output,
      outputKey ? { [outputKey]: output } : undefined,
    );
  },
};

const ExtractedRecordSchema = z.record(z.unknown());

function modelDependencyContext(input: NodeRuntimeInput): AgentDependencyContext | null {
  const modelNode = input.attachments.model?.[0];
  if (!modelNode) return null;
  return {
    execution: input.execution,
    node: input.node,
    modelNode,
    toolNodes: input.attachments.tool || [],
    memoryNode: input.attachments.memory?.[0],
    knowledgeNodes: input.attachments.knowledge || [],
    guardrailNodes: input.attachments.guardrail || [],
  };
}

function extractHandler(dependencies: WorkflowHandlerDependencies): NodeHandler {
  return {
    type: 'data.extract',
    execute: async (input) => {
      const dependencyContext = modelDependencyContext(input);
      if (!dependencyContext || !dependencies.resolveModelChain) {
        return {
          status: 'error',
          error: {
            code: 'EXTRACT_MODEL_MISSING',
            message: 'A structured extraction node requires a connected model.',
            retryable: false,
          },
        };
      }
      const jsonSchema = isRecord(input.node.config.schema) ? input.node.config.schema : {};
      const maxAttempts = Math.max(1, Math.min(5, Number(input.node.config.maxAttempts || 2)));
      const modelChain = await dependencies.resolveModelChain(dependencyContext);
      let lastValidationErrors: unknown = [];
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const generated = await modelChain.generateStructured({
          messages: [{
            role: 'system',
            content: [
              'Extraia somente os dados presentes na entrada.',
              'Não invente valores ausentes.',
              'Retorne exclusivamente um objeto JSON compatível com o schema fornecido.',
              `Schema: ${stableStringify(jsonSchema)}`,
            ].join('\n'),
          }, {
            role: 'user',
            content: stableStringify(input.input),
          }],
          schema: ExtractedRecordSchema,
          schemaName: `workflow_extract_${input.node.id}`,
          jsonSchema,
          timeoutMs: Number(dependencyContext.modelNode.config.timeoutMs || 60_000),
          signal: input.signal,
        });
        const validation = validateSchema(generated.output, { jsonSchema });
        if (validation.valid) {
          return {
            status: 'route',
            selectedOutput: 'success',
            output: generated.output,
            statePatch: typeof input.node.config.outputKey === 'string' && input.node.config.outputKey.trim()
              ? { [input.node.config.outputKey.trim()]: generated.output }
              : undefined,
            metrics: {
              durationMs: 0,
              model: generated.selected.config.model,
              modelCalls: attempt,
            },
          };
        }
        lastValidationErrors = validation.errors || [];
      }
      return {
        status: 'route',
        selectedOutput: 'invalid_output',
        output: { valid: false, validationErrors: lastValidationErrors },
        metrics: { durationMs: 0, modelCalls: maxAttempts },
      };
    },
  };
}

const templateHandler: NodeHandler = {
  type: 'data.template',
  execute: async (input) => {
    const template = String(input.node.config.template || '');
    const outputKey = String(input.node.config.outputKey || 'text');
    const rendered = renderTemplate(template, sourceContext(input));
    return success({ [outputKey]: rendered }, { [outputKey]: rendered });
  },
};

const ifHandler: NodeHandler = {
  type: 'logic.if',
  execute: async (input) => {
    const source = sourceContext(input);
    const left = resolveConditionOperand(input.node.config.left, source);
    const right = resolveConditionOperand(input.node.config.right, source);
    const matched = compare(left, String(input.node.config.operator || 'equals'), right);
    return {
      status: 'route',
      selectedOutput: matched ? 'true' : 'false',
      output: { matched, left, right },
    };
  },
};

type SwitchCase = {
  output: string;
  operator?: string;
  value?: unknown;
};

const switchHandler: NodeHandler = {
  type: 'logic.switch',
  execute: async (input) => {
    const source = sourceContext(input);
    const actual = resolveConditionOperand(input.node.config.value, source);
    const cases = Array.isArray(input.node.config.cases)
      ? input.node.config.cases.filter(isRecord) as SwitchCase[]
      : [];
    const selected = cases.find((candidate) => (
      compare(actual, candidate.operator || 'equals', resolveConditionOperand(candidate.value, source))
    ));
    const selectedOutput = selected?.output || String(input.node.config.defaultOutput || 'default');
    return {
      status: 'route',
      selectedOutput,
      output: { value: actual, selectedOutput },
    };
  },
};

const goalCompletionHandler: NodeHandler = {
  type: 'logic.goal_completion',
  execute: async (input) => {
    const goalCompletion = evaluateWorkflowGoalCompletion(input);
    return {
      status: 'route',
      selectedOutput: goalCompletion.complete ? 'completed' : 'incomplete',
      output: {
        ...input.input,
        goalCompletion,
      },
    };
  },
};

const AiRouterDecisionSchema = z.object({
  routeId: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

function aiRouterHandler(dependencies: WorkflowHandlerDependencies): NodeHandler {
  return {
    type: 'logic.ai_router',
    execute: async (input) => {
      const dependencyContext = modelDependencyContext(input);
      if (!dependencyContext || !dependencies.resolveModelChain) {
        return {
          status: 'error',
          error: {
            code: 'AI_ROUTER_MODEL_MISSING',
            message: 'An AI router requires a connected model.',
            retryable: false,
          },
        };
      }
      const routes = Array.isArray(input.node.config.routes)
        ? input.node.config.routes.filter(isRecord).map((route) => ({
            id: String(route.id || ''),
            label: String(route.label || route.id || ''),
            description: String(route.description || ''),
            examples: Array.isArray(route.examples) ? route.examples.map(String) : [],
          })).filter((route) => route.id)
        : [];
      if (routes.length === 0) {
        return {
          status: 'error',
          error: { code: 'AI_ROUTER_ROUTES_MISSING', message: 'AI router has no configured routes.', retryable: false },
        };
      }
      const modelChain = await dependencies.resolveModelChain(dependencyContext);
      const generated = await modelChain.generateStructured({
        messages: [{
          role: 'system',
          content: [
            'Selecione exatamente uma das rotas permitidas para a entrada recebida.',
            'Não crie novas rotas e não exponha raciocínio interno.',
            `Rotas: ${stableStringify(routes)}`,
          ].join('\n'),
        }, {
          role: 'user',
          content: stableStringify(input.input),
        }],
        schema: AiRouterDecisionSchema,
        schemaName: `workflow_router_${input.node.id}`,
        timeoutMs: Number(dependencyContext.modelNode.config.timeoutMs || 60_000),
        signal: input.signal,
      });
      const allowedRouteIds = new Set(routes.map((route) => route.id));
      const minimumConfidence = Number(input.node.config.minimumConfidence ?? 0.75);
      const lowConfidenceOutput = String(input.node.config.lowConfidenceOutput || 'low_confidence');
      const defaultOutput = String(input.node.config.defaultOutput || 'default');
      const selectedOutput = generated.output.confidence < minimumConfidence
        ? lowConfidenceOutput
        : allowedRouteIds.has(generated.output.routeId)
          ? generated.output.routeId
          : defaultOutput;
      return {
        status: 'route',
        selectedOutput,
        output: {
          routeId: selectedOutput,
          proposedRouteId: generated.output.routeId,
          confidence: generated.output.confidence,
        },
        metrics: {
          durationMs: 0,
          model: generated.selected.config.model,
          modelCalls: 1,
        },
      };
    },
  };
}

const mergeHandler: NodeHandler = {
  type: 'logic.merge',
  execute: async (input) => success(structuredClone(input.input)),
};

const parallelHandler: NodeHandler = {
  type: 'logic.parallel',
  execute: async (input) => {
    const configuredOutputs = Array.isArray(input.node.config.outputs)
      ? input.node.config.outputs.map(String).filter(Boolean)
      : [];
    const availableOutputs = input.node.outputPorts
      .filter((port) => port.connectionType === 'main' && port.id !== 'error')
      .map((port) => port.id);
    const selectedOutputs = configuredOutputs.length > 0 ? configuredOutputs : availableOutputs;
    return {
      status: 'route',
      selectedOutputs,
      output: structuredClone(input.input),
    };
  },
};

const waitHandler: NodeHandler = {
  type: 'logic.wait',
  execute: async (input) => ({
    status: 'waiting',
    selectedOutput: 'resumed',
    waitingReason: String(input.node.config.mode || 'event'),
    resumeToken: createId(`resume_${input.execution.executionId}_${input.node.id}`),
    output: {
      waitingSince: new Date().toISOString(),
      resumeEvent: input.node.config.resumeEvent,
    },
  }),
};

const loopHandler: NodeHandler = {
  type: 'logic.loop',
  execute: async (input) => {
    const loopState = isRecord(input.execution.variables.__loops)
      ? input.execution.variables.__loops
      : {};
    const current = Number(loopState[input.node.id] || 0);
    const maxIterations = Number(input.node.config.maxIterations || 1);
    const exitCondition = input.node.config.exitCondition;
    let shouldExit = false;
    if (isRecord(exitCondition)) {
      const source = sourceContext(input);
      shouldExit = compare(
        resolveConditionOperand(exitCondition.left, source),
        String(exitCondition.operator || 'equals'),
        resolveConditionOperand(exitCondition.right, source),
      );
    } else if (typeof exitCondition === 'string') {
      shouldExit = renderTemplate(exitCondition, sourceContext(input)).trim().toLowerCase() === 'true';
    }
    if (shouldExit) {
      return {
        status: 'route',
        selectedOutput: 'done',
        output: { iterations: current, reason: 'exit_condition' },
      };
    }
    if (current >= maxIterations) {
      return {
        status: 'route',
        selectedOutput: 'limit_reached',
        output: { iterations: current, reason: 'max_iterations' },
      };
    }
    return {
      status: 'route',
      selectedOutput: 'iterate',
      statePatch: {
        __loops: {
          ...loopState,
          [input.node.id]: current + 1,
        },
      },
      output: { iteration: current + 1 },
    };
  },
};

function buildAgentDependencyContext(input: NodeRuntimeInput): AgentDependencyContext | null {
  return modelDependencyContext(input);
}

function agentHandler(dependencies: WorkflowHandlerDependencies): NodeHandler {
  return {
    type: 'ai.agent',
    configSchema: AgentNodeConfigSchema as z.ZodType<Record<string, unknown>>,
    execute: async (input) => {
      const dependencyContext = buildAgentDependencyContext(input);
      if (!dependencyContext || !dependencies.resolveModelChain || !dependencies.resolveToolRegistry) {
        return {
          status: 'error',
          error: {
            code: 'AGENT_DEPENDENCY_MISSING',
            message: 'Agent model and tool runtime dependencies are not configured.',
            retryable: false,
          },
        };
      }
      const guardedInput = dependencies.applyGuardrails
        ? await dependencies.applyGuardrails('input', input.input, dependencyContext)
        : input.input;
      const execution = {
        ...input.execution,
        input: {
          ...input.execution.input,
          current: guardedInput,
        },
      };
      const [modelChain, tools, memory, knowledge] = await Promise.all([
        dependencies.resolveModelChain(dependencyContext),
        dependencies.resolveToolRegistry(dependencyContext),
        dependencies.loadMemory?.(dependencyContext) || Promise.resolve({}),
        dependencies.retrieveKnowledge?.(dependencyContext) || Promise.resolve([]),
      ]);
      const agentConfig = AgentNodeConfigSchema.parse(input.node.config);
      const result = await withTimeout(
        (agentSignal) => executeAgentNode({
          config: agentConfig as AgentNodeConfig,
          execution,
          workflow: input.workflow,
          node: input.node,
          modelChain,
          tools,
          memory,
          knowledge,
          signal: agentSignal,
          emit: input.emit,
        }),
        agentConfig.timeoutMs,
        input.signal,
        'AGENT_TIMEOUT',
      );
      result.metrics = {
        durationMs: result.metrics?.durationMs || 0,
        ...result.metrics,
        modelCalls: result.metrics?.attempts || 0,
      };
      if (result.output && dependencies.applyGuardrails) {
        result.output = await dependencies.applyGuardrails('output', result.output, dependencyContext);
      }
      return result;
    },
  };
}

function dependencyHandler(
  type: string,
  dependency: ((input: NodeRuntimeInput) => Promise<Record<string, unknown>>) | undefined,
  missingCode: string,
): NodeHandler {
  return {
    type,
    execute: async (input) => {
      if (!dependency) {
        return {
          status: 'error',
          error: {
            code: missingCode,
            message: `Runtime dependency for ${type} is not configured.`,
            retryable: false,
          },
        };
      }
      return success(await dependency(input));
    },
  };
}

export function createDefaultNodeHandlerRegistry(
  dependencies: WorkflowHandlerDependencies = {},
): WorkflowNodeHandlerRegistry {
  const registry = new WorkflowNodeHandlerRegistry();
  [
    'trigger.received_message',
    'trigger.webhook',
    'trigger.internal_event',
    'trigger.schedule',
    'trigger.manual',
  ].forEach((type) => registry.register(triggerHandler(type)));

  registry
    .register(setHandler)
    .register(transformHandler)
    .register(extractHandler(dependencies))
    .register(templateHandler)
    .register(ifHandler)
    .register(goalCompletionHandler)
    .register(switchHandler)
    .register(aiRouterHandler(dependencies))
    .register(mergeHandler)
    .register(parallelHandler)
    .register(waitHandler)
    .register(loopHandler)
    .register(agentHandler(dependencies))
    .register({
      type: 'ai.prompt',
      execute: dependencies.executePrompt || (async () => ({
        status: 'error',
        error: {
          code: 'PROMPT_RUNTIME_NOT_CONFIGURED',
          message: 'Prompt runtime dependency is not configured.',
          retryable: false,
        },
      })),
    })
    .register(dependencyHandler('logic.subflow', dependencies.executeSubflow, 'SUBFLOW_RUNTIME_NOT_CONFIGURED'))
    .register(dependencyHandler('state.load', dependencies.loadState, 'STATE_STORE_NOT_CONFIGURED'))
    .register(dependencyHandler('state.save', dependencies.saveState, 'STATE_STORE_NOT_CONFIGURED'))
    .register({
      type: 'output.respond',
      execute: async (input) => {
        if (!dependencies.sendResponse) {
          return {
            status: 'error',
            error: {
              code: 'RESPONSE_DELIVERY_NOT_CONFIGURED',
              message: 'Response delivery dependency is not configured.',
              retryable: false,
            },
          };
        }
        const source = sourceContext(input);
        const message = renderTemplate(String(input.node.config.message || '{{current.response}}'), source);
        const delivery = await dependencies.sendResponse(message, input);
        if (delivery.success === false) {
          return {
            status: 'error',
            error: {
              code: 'RESPONSE_DELIVERY_FAILED',
              message: typeof delivery.error === 'string'
                ? delivery.error
                : 'The response provider did not accept the message.',
              retryable: true,
            },
          };
        }
        return success({ ...input.input, message, delivery });
      },
    })
    .register({
      type: 'output.handoff',
      execute: async (input) => {
        if (!dependencies.handoff) {
          return {
            status: 'error',
            error: {
              code: 'HANDOFF_NOT_CONFIGURED',
              message: 'Handoff dependency is not configured.',
              retryable: false,
            },
          };
        }
        return success(await dependencies.handoff(input), undefined, 'completed');
      },
    })
    .register({
      type: 'output.close_conversation',
      execute: async (input) => {
        if (!dependencies.closeConversation) {
          return {
            status: 'error',
            error: {
              code: 'CONVERSATION_CLOSE_NOT_CONFIGURED',
              message: 'Conversation close dependency is not configured.',
              retryable: false,
            },
          };
        }
        return success({
          ...input.input,
          ...await dependencies.closeConversation(input),
        }, undefined, 'completed');
      },
    })
    .register({
      type: 'output.end',
      execute: async (input) => ({
        status: 'completed',
        output: {
          ...input.input,
          ...(isRecord(input.node.config.output)
            ? materializeValue(input.node.config.output, sourceContext(input)) as Record<string, unknown>
            : {}),
        },
      }),
    })
    .register({
      type: 'error.handler',
      execute: async (input) => {
        const mode = String(input.node.config.mode || 'fail');
        if (mode === 'recover') {
          return success({
            recovered: true,
            previousError: input.input.error,
          }, undefined, 'recovered');
        }
        return {
          status: 'error',
          selectedOutput: 'failed',
          error: {
            code: 'HANDLED_WORKFLOW_ERROR',
            message: String(input.node.config.publicMessage || 'Workflow execution failed.'),
            retryable: false,
            details: isRecord(input.input.error) ? input.input.error : undefined,
          },
        };
      },
    });

  return registry;
}
