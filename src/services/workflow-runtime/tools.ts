import { z } from 'zod';
import type {
  ToolCallRecord,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowExecution,
  WorkflowNode,
} from './types';
import type { RetryPolicy } from './types';
import {
  createId,
  delay,
  hashValue,
  normalizeRuntimeError,
  stableStringify,
  withTimeout,
} from './utils';

export type ToolRiskLevel = 'low' | 'medium' | 'high';

export type ToolRuntimeContext = {
  execution: WorkflowExecution;
  workflow: WorkflowDefinition;
  node: WorkflowNode;
  signal: AbortSignal;
  idempotencyKey: string;
};

export type ToolDefinition<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  /** Original provider schema shown to the model. Zod transforms/refinements
   * are not reliably reversible to JSON Schema. */
  inputJsonSchema?: Record<string, unknown>;
  outputSchema: z.ZodType<TOutput>;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  idempotent: boolean;
  /** Whether a successful result may be reused for identical calls in the
   * same execution. Read-only status/polling tools must disable this because
   * their result changes while an external operation is progressing. */
  cacheResult?: boolean;
  /** Allows the agent loop to repeat this safe call while its latest output
   * explicitly reports a transient state such as pending or processing. */
  allowRepeatedCallsWhilePending?: boolean;
  riskLevel: ToolRiskLevel;
  requiresConfirmation: boolean;
  permissionScope?: string;
  maxOutputBytes?: number;
  execute: (input: TInput, context: ToolRuntimeContext) => Promise<TOutput>;
};

export type ToolPermissionRequest = {
  definition: ToolDefinition;
  arguments: Record<string, unknown>;
  execution: WorkflowExecution;
  node: WorkflowNode;
  decisionSignature: string;
};

export type ToolPermissionEvaluator = (
  request: ToolPermissionRequest,
) => boolean | Promise<boolean>;

export type ExecuteToolInput = {
  toolName: string;
  arguments: Record<string, unknown>;
  purposeSummary?: string;
  execution: WorkflowExecution;
  workflow: WorkflowDefinition;
  node: WorkflowNode;
  signal: AbortSignal;
  timeoutMs?: number;
  emit: (event: Omit<WorkflowEvent, 'id' | 'sequence' | 'createdAt'>) => Promise<void>;
};

export type ExecuteToolResult = {
  record: ToolCallRecord;
  output?: Record<string, unknown>;
};

const defaultPermissionEvaluator: ToolPermissionEvaluator = ({ definition }) => (
  !definition.requiresConfirmation && !definition.permissionScope
);

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition<any, any>>();
  private readonly idempotencyCache = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly permissionEvaluator: ToolPermissionEvaluator = defaultPermissionEvaluator,
  ) {}

  register<
    TInput extends Record<string, unknown>,
    TOutput extends Record<string, unknown>,
  >(definition: ToolDefinition<TInput, TOutput>): this {
    if (!definition.name.trim()) throw new Error('Tool name is required.');
    if (!definition.description.trim()) throw new Error(`Tool ${definition.name} needs a description.`);
    if (this.definitions.has(definition.name)) {
      throw new Error(`Tool ${definition.name} is already registered.`);
    }
    this.definitions.set(definition.name, definition);
    return this;
  }

  get(name: string): ToolDefinition<any, any> | undefined {
    return this.definitions.get(name);
  }

  list(): ToolDefinition<any, any>[] {
    return [...this.definitions.values()];
  }

  async executeSafely(input: ExecuteToolInput): Promise<ExecuteToolResult> {
    const definition = this.definitions.get(input.toolName);
    const callId = createId('tool');
    const requestedAt = new Date().toISOString();
    const baseRecord: ToolCallRecord = {
      id: callId,
      toolName: input.toolName,
      arguments: structuredClone(input.arguments),
      purposeSummary: input.purposeSummary,
      status: 'requested',
      startedAt: requestedAt,
      attempt: 1,
    };

    await input.emit({
      type: 'tool.requested',
      executionId: input.execution.executionId,
      workflowId: input.workflow.id,
      nodeId: input.node.id,
      toolName: input.toolName,
      safeSummary: input.purposeSummary || `Ferramenta ${input.toolName} solicitada`,
    });

    if (!definition) {
      return this.reject(input, baseRecord, 'TOOL_NOT_ALLOWED', `Tool ${input.toolName} is not available.`);
    }

    const parsedArguments = definition.inputSchema.safeParse(input.arguments);
    if (!parsedArguments.success) {
      return this.reject(
        input,
        baseRecord,
        'INVALID_TOOL_ARGUMENTS',
        parsedArguments.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
    }
    baseRecord.arguments = structuredClone(parsedArguments.data);

    const decisionSignature = hashValue({
      toolName: input.toolName,
      arguments: parsedArguments.data,
      nodeId: input.node.id,
    });
    const allowed = await this.permissionEvaluator({
      definition,
      arguments: parsedArguments.data,
      execution: input.execution,
      node: input.node,
      decisionSignature,
    });
    if (!allowed) {
      return this.reject(
        input,
        baseRecord,
        'TOOL_PERMISSION_DENIED',
        `Tool ${input.toolName} requires permission or confirmation.`,
      );
    }

    const idempotencyKey = hashValue({
      executionId: input.execution.executionId,
      toolName: input.toolName,
      arguments: parsedArguments.data,
    });
    if (definition.idempotent) {
      // Repeated calls inside the same execution represent the same durable
      // operation. Reuse the record id as well as the output so persistence
      // updates the existing row instead of violating the unique idempotency
      // index with a second successful row.
      baseRecord.id = `tool_${idempotencyKey}`;
      baseRecord.idempotencyKey = idempotencyKey;
    }
    const cacheResult = definition.cacheResult ?? definition.idempotent;
    if (cacheResult && this.idempotencyCache.has(idempotencyKey)) {
      const output = structuredClone(this.idempotencyCache.get(idempotencyKey)!);
      return {
        record: {
          ...baseRecord,
          status: 'success',
          output,
          finishedAt: new Date().toISOString(),
          durationMs: 0,
        },
        output,
      };
    }

    const retry = definition.retryPolicy;
    const startedAtMs = Date.now();
    let lastError: ReturnType<typeof normalizeRuntimeError> | null = null;
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      await input.emit({
        type: 'tool.started',
        executionId: input.execution.executionId,
        workflowId: input.workflow.id,
        nodeId: input.node.id,
        toolName: input.toolName,
        safeSummary: `Executando ${input.toolName}`,
        data: { attempt },
      });
      try {
        const output = await withTimeout(
          (signal) => definition.execute(parsedArguments.data, {
            execution: input.execution,
            workflow: input.workflow,
            node: input.node,
            signal,
            idempotencyKey,
          }),
          input.timeoutMs || definition.timeoutMs,
          input.signal,
          'TOOL_TIMEOUT',
        );
        const parsedOutput = definition.outputSchema.parse(output);
        const serialized = stableStringify(parsedOutput);
        if (definition.maxOutputBytes && Buffer.byteLength(serialized, 'utf8') > definition.maxOutputBytes) {
          const error = new Error(`Tool output exceeds ${definition.maxOutputBytes} bytes.`) as Error & {
            code?: string;
          };
          error.code = 'TOOL_OUTPUT_TOO_LARGE';
          throw error;
        }
        if (cacheResult) {
          this.idempotencyCache.set(idempotencyKey, structuredClone(parsedOutput));
        }
        const finishedAt = new Date().toISOString();
        await input.emit({
          type: 'tool.completed',
          executionId: input.execution.executionId,
          workflowId: input.workflow.id,
          nodeId: input.node.id,
          toolName: input.toolName,
          safeSummary: `${input.toolName} concluída`,
          data: { attempt, durationMs: Date.now() - startedAtMs },
        });
        return {
          record: {
            ...baseRecord,
            status: 'success',
            output: parsedOutput,
            attempt,
            finishedAt,
            durationMs: Date.now() - startedAtMs,
          },
          output: parsedOutput,
        };
      } catch (error) {
        lastError = normalizeRuntimeError(error, 'TOOL_EXECUTION_FAILED');
        const retryable = lastError.retryable
          || retry.retryableErrorCodes.includes(lastError.code);
        if (!retryable || attempt >= retry.maxAttempts) break;
        const waitMs = Math.min(
          retry.maxDelayMs,
          retry.initialDelayMs * (retry.backoffMultiplier ** (attempt - 1)),
        );
        await delay(waitMs, input.signal);
      }
    }

    const finishedAt = new Date().toISOString();
    await input.emit({
      type: 'tool.failed',
      executionId: input.execution.executionId,
      workflowId: input.workflow.id,
      nodeId: input.node.id,
      toolName: input.toolName,
      safeSummary: `${input.toolName} falhou`,
      data: { code: lastError?.code, durationMs: Date.now() - startedAtMs },
    });
    return {
      record: {
        ...baseRecord,
        status: 'error',
        error: lastError || {
          code: 'TOOL_EXECUTION_FAILED',
          message: 'Tool execution failed.',
          retryable: false,
        },
        finishedAt,
        durationMs: Date.now() - startedAtMs,
      },
    };
  }

  private async reject(
    input: ExecuteToolInput,
    record: ToolCallRecord,
    code: string,
    message: string,
  ): Promise<ExecuteToolResult> {
    await input.emit({
      type: 'tool.rejected',
      executionId: input.execution.executionId,
      workflowId: input.workflow.id,
      nodeId: input.node.id,
      toolName: input.toolName,
      safeSummary: `Ferramenta ${input.toolName} rejeitada`,
      data: { code },
    });
    return {
      record: {
        ...record,
        status: 'rejected',
        error: { code, message, retryable: false },
        finishedAt: new Date().toISOString(),
        durationMs: 0,
      },
    };
  }
}
