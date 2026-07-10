import { WorkflowDefinitionSchema, WorkflowExecutionSchema } from './schemas';
import type {
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowExecution,
} from './types';

export class WorkflowOptimisticLockError extends Error {
  readonly code = 'WORKFLOW_OPTIMISTIC_LOCK_CONFLICT';
  readonly retryable = true;

  constructor(executionId: string, expectedVersion: number) {
    super(`Execution ${executionId} changed after version ${expectedVersion}.`);
    this.name = 'WorkflowOptimisticLockError';
  }
}

export class WorkflowExecutionLockError extends Error {
  readonly code = 'WORKFLOW_EXECUTION_LOCKED';
  readonly retryable = true;

  constructor(executionId: string) {
    super(`Execution ${executionId} is locked by another worker.`);
    this.name = 'WorkflowExecutionLockError';
  }
}

export interface WorkflowPersistence {
  saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void>;
  getWorkflowDefinition(workflowId: string, version: string): Promise<WorkflowDefinition | null>;
  createExecution(execution: WorkflowExecution): Promise<WorkflowExecution>;
  getExecution(executionId: string): Promise<WorkflowExecution | null>;
  getExecutionByResumeToken(resumeToken: string): Promise<WorkflowExecution | null>;
  saveExecution(execution: WorkflowExecution, expectedVersion: number): Promise<WorkflowExecution>;
  acquireExecutionLock(
    executionId: string,
    workerId: string,
    leaseMs: number,
  ): Promise<WorkflowExecution | null>;
  renewExecutionLock(executionId: string, workerId: string, leaseMs: number): Promise<boolean>;
  releaseExecutionLock(executionId: string, workerId: string): Promise<void>;
  appendEvent(event: WorkflowEvent): Promise<void>;
  listEvents(executionId: string, afterSequence?: number): Promise<WorkflowEvent[]>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryWorkflowPersistence implements WorkflowPersistence {
  private readonly definitions = new Map<string, WorkflowDefinition>();
  private readonly executions = new Map<string, WorkflowExecution>();
  private readonly events = new Map<string, WorkflowEvent[]>();

  private definitionKey(workflowId: string, version: string) {
    return `${workflowId}:${version}`;
  }

  async saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void> {
    const parsed = WorkflowDefinitionSchema.parse(definition);
    const key = this.definitionKey(parsed.id, parsed.version);
    const existing = this.definitions.get(key);
    if (
      existing
      && JSON.stringify(existing) !== JSON.stringify(parsed)
      && (existing.status === 'published' || parsed.status === 'published')
    ) {
      throw new Error(`Published workflow definition ${parsed.id}@${parsed.version} is immutable.`);
    }
    this.definitions.set(key, clone(parsed));
  }

  async getWorkflowDefinition(workflowId: string, version: string): Promise<WorkflowDefinition | null> {
    const definition = this.definitions.get(this.definitionKey(workflowId, version));
    return definition ? clone(definition) : null;
  }

  async createExecution(execution: WorkflowExecution): Promise<WorkflowExecution> {
    if (this.executions.has(execution.executionId)) {
      throw new Error(`Execution ${execution.executionId} already exists.`);
    }
    const parsed = WorkflowExecutionSchema.parse({ ...execution, version: 0 });
    this.executions.set(parsed.executionId, clone(parsed));
    return clone(parsed);
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | null> {
    const execution = this.executions.get(executionId);
    return execution ? clone(execution) : null;
  }

  async getExecutionByResumeToken(resumeToken: string): Promise<WorkflowExecution | null> {
    for (const execution of this.executions.values()) {
      if (execution.resumeToken === resumeToken && execution.status === 'waiting') {
        return clone(execution);
      }
    }
    return null;
  }

  async saveExecution(
    execution: WorkflowExecution,
    expectedVersion: number,
  ): Promise<WorkflowExecution> {
    const current = this.executions.get(execution.executionId);
    if (!current || current.version !== expectedVersion) {
      throw new WorkflowOptimisticLockError(execution.executionId, expectedVersion);
    }
    const parsed = WorkflowExecutionSchema.parse({
      ...execution,
      version: expectedVersion + 1,
    });
    this.executions.set(parsed.executionId, clone(parsed));
    return clone(parsed);
  }

  async acquireExecutionLock(
    executionId: string,
    workerId: string,
    leaseMs: number,
  ): Promise<WorkflowExecution | null> {
    const current = this.executions.get(executionId);
    if (!current) return null;
    const now = Date.now();
    const lockExpiresAt = current.lockExpiresAt ? new Date(current.lockExpiresAt).getTime() : 0;
    if (current.lockedBy && current.lockedBy !== workerId && lockExpiresAt > now) return null;
    const next = WorkflowExecutionSchema.parse({
      ...current,
      lockedBy: workerId,
      lockExpiresAt: new Date(now + leaseMs).toISOString(),
      updatedAt: new Date(now).toISOString(),
      version: current.version + 1,
    });
    this.executions.set(executionId, clone(next));
    return clone(next);
  }

  async renewExecutionLock(executionId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const current = this.executions.get(executionId);
    if (!current || current.lockedBy !== workerId) return false;
    current.lockExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    current.updatedAt = new Date().toISOString();
    this.executions.set(executionId, clone(current));
    return true;
  }

  async releaseExecutionLock(executionId: string, workerId: string): Promise<void> {
    const current = this.executions.get(executionId);
    if (!current || current.lockedBy !== workerId) return;
    delete current.lockedBy;
    delete current.lockExpiresAt;
    current.updatedAt = new Date().toISOString();
    this.executions.set(executionId, clone(current));
  }

  async appendEvent(event: WorkflowEvent): Promise<void> {
    const current = this.events.get(event.executionId) || [];
    if (current.some((candidate) => candidate.id === event.id)) return;
    current.push(clone(event));
    current.sort((left, right) => left.sequence - right.sequence);
    this.events.set(event.executionId, current);
  }

  async listEvents(executionId: string, afterSequence = -1): Promise<WorkflowEvent[]> {
    return (this.events.get(executionId) || [])
      .filter((event) => event.sequence > afterSequence)
      .map(clone);
  }
}
