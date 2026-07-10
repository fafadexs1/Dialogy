import type { WorkflowPersistence } from './persistence';
import type { WorkflowEvent } from './types';
import { createId, isRecord } from './utils';

export type WorkflowEventListener = (event: WorkflowEvent) => void | Promise<void>;

export function redactWorkflowValue(value: unknown, key = '', visited = new Set<object>()): unknown {
  if (/(password|token|secret|authorization|api[_-]?key|cpf|cnpj)/i.test(key)) {
    return '[REDACTED]';
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return value;
  visited.add(value);
  if (Array.isArray(value)) return value.map((item) => redactWorkflowValue(item, key, visited));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([childKey, child]) => [childKey, redactWorkflowValue(child, childKey, visited)]),
  );
}

export class WorkflowEventBus {
  private readonly listeners = new Set<WorkflowEventListener>();
  private readonly nextSequenceByExecution = new Map<string, number>();
  private readonly publicationQueue = new Map<string, Promise<unknown>>();

  constructor(private readonly persistence: WorkflowPersistence) {}

  subscribe(listener: WorkflowEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initializeExecution(executionId: string) {
    const events = await this.persistence.listEvents(executionId);
    const lastSequence = events.at(-1)?.sequence ?? -1;
    this.nextSequenceByExecution.set(executionId, lastSequence + 1);
  }

  async publish(
    event: Omit<WorkflowEvent, 'id' | 'sequence' | 'createdAt'>,
  ): Promise<WorkflowEvent> {
    const previous = this.publicationQueue.get(event.executionId) || Promise.resolve();
    const publication = previous
      .catch(() => undefined)
      .then(() => this.publishNow(event));
    this.publicationQueue.set(event.executionId, publication);
    try {
      return await publication;
    } finally {
      if (this.publicationQueue.get(event.executionId) === publication) {
        this.publicationQueue.delete(event.executionId);
      }
    }
  }

  private async publishNow(
    event: Omit<WorkflowEvent, 'id' | 'sequence' | 'createdAt'>,
  ): Promise<WorkflowEvent> {
    if (!this.nextSequenceByExecution.has(event.executionId)) {
      await this.initializeExecution(event.executionId);
    }
    const sequence = this.nextSequenceByExecution.get(event.executionId) || 0;
    this.nextSequenceByExecution.set(event.executionId, sequence + 1);
    const complete: WorkflowEvent = {
      ...event,
      id: createId('evt'),
      sequence,
      data: isRecord(event.data)
        ? redactWorkflowValue(event.data) as Record<string, unknown>
        : undefined,
      createdAt: new Date().toISOString(),
    };
    await this.persistence.appendEvent(complete);
    await Promise.allSettled([...this.listeners].map((listener) => listener(complete)));
    return complete;
  }
}
