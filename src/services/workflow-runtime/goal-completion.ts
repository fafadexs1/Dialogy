import type { NodeRuntimeInput } from './types';
import { isRecord, stableStringify } from './utils';
import { responseRequestsMoreCustomerInput } from '@/services/autopilot/close-intent';

export const GOAL_COMPLETION_EVALUATOR = 'workflow_runtime' as const;
export const GOAL_COMPLETION_EVIDENCE_VERSION = 1 as const;

export type GoalCompletionEvidence = {
  complete: boolean;
  evaluatedBy: typeof GOAL_COMPLETION_EVALUATOR;
  evidenceVersion: typeof GOAL_COMPLETION_EVIDENCE_VERSION;
  workflowId: string;
  workflowVersion: string;
  executionId: string;
  evaluatorNodeId: string;
  requiredFields: string[];
  satisfiedFields: string[];
  missingFields: string[];
  requiredOperations: string[];
  satisfiedOperations: string[];
  missingOperations: string[];
  completionSignalPresent: boolean;
  blockers: string[];
};

const FIELD_ALIASES: readonly string[][] = [
  ['name', 'nome', 'full_name', 'fullname', 'contact_name', 'customer_name'],
  ['customer_identifier', 'cpf', 'cnpj', 'document', 'documento', 'tax_id'],
  ['phone', 'telefone', 'celular', 'whatsapp', 'mobile'],
  ['email', 'e_mail'],
  ['postal_code', 'postalcode', 'cep', 'zip', 'zip_code', 'zipcode'],
  ['address', 'endereco', 'logradouro', 'street'],
  ['address_complement', 'complement', 'complemento'],
  ['city', 'cidade', 'municipio'],
  ['state', 'estado', 'uf'],
  ['product_or_service_preference', 'product', 'produto', 'service', 'servico', 'plan', 'plano', 'preference', 'preferencia'],
];

function normalizeFieldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const canonicalFieldByAlias = new Map<string, string>();
for (const aliases of FIELD_ALIASES) {
  const canonical = normalizeFieldName(aliases[0] || '');
  for (const alias of aliases) canonicalFieldByAlias.set(normalizeFieldName(alias), canonical);
}

export function canonicalWorkflowFieldName(value: string): string {
  const normalized = normalizeFieldName(value);
  return canonicalFieldByAlias.get(normalized) || normalized;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function addRecordValues(target: Map<string, unknown>, value: unknown) {
  if (!isRecord(value)) return;
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!hasMeaningfulValue(fieldValue)) continue;
    const canonical = canonicalWorkflowFieldName(key);
    if (canonical === 'address' && typeof fieldValue === 'string') {
      const postalCode = fieldValue.match(/\b\d{5}-?\d{3}\b/)?.[0];
      if (postalCode && !target.has('postal_code')) target.set('postal_code', postalCode);
      const complement = fieldValue.match(/\b(?:complemento|apartamento|apto|bloco|casa|sala|unidade)\b[^;,]*/i)?.[0];
      if (complement && !target.has('address_complement')) target.set('address_complement', complement);
      const addressWithoutPostalCode = fieldValue
        .replace(/\bcep\b\s*[:=-]?\s*/gi, ' ')
        .replace(/\b\d{5}-?\d{3}\b/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
      // A CEP is useful postal evidence, but it is not a complete address.
      if (addressWithoutPostalCode && !target.has(canonical)) target.set(canonical, fieldValue);
      continue;
    }
    if (canonical && !target.has(canonical)) target.set(canonical, fieldValue);
  }
}

export function hasKnownWorkflowField(
  field: string,
  knownFields: Record<string, unknown>,
): boolean {
  const values = new Map<string, unknown>();
  addRecordValues(values, knownFields);
  return values.has(canonicalWorkflowFieldName(field));
}

function collectKnownFields(input: NodeRuntimeInput): Map<string, unknown> {
  const knownFields = new Map<string, unknown>();
  const records = [
    input.execution.input.knownFields,
    input.execution.context.knownFields,
  ];
  for (const record of records) addRecordValues(knownFields, record);
  return knownFields;
}

function uniqueConfiguredStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
}

function successfulOperationResult(input: NodeRuntimeInput, operation: string): boolean {
  if (operation.startsWith('system:')) {
    const operationName = operation.slice('system:'.length).trim();
    return Boolean(
      operationName
      && isRecord(input.execution.input.systemOperations)
      && input.execution.input.systemOperations[operationName] === true
    );
  }
  const separator = operation.lastIndexOf(':');
  const nodeId = separator > 0 ? operation.slice(0, separator) : operation;
  const requiredOutput = separator > 0 ? operation.slice(separator + 1) : '';
  const result = input.execution.nodeResults[nodeId];
  if (!result || result.error) return false;
  if (requiredOutput) return result.selectedOutput === requiredOutput;
  return result.status === 'success' || result.status === 'completed';
}

function hasCompletionSignal(input: NodeRuntimeInput): boolean {
  if (
    input.input.completionStatus === 'completed'
    || input.input.goalCompleted === true
    || (isRecord(input.input.goalCompletion) && input.input.goalCompletion.complete === true)
    || input.execution.input.completionStatus === 'completed'
    || input.execution.input.goalCompleted === true
  ) return true;
  // Do not inherit a completion signal from an unrelated earlier branch. A
  // goal evaluator must receive the signal through its current input (or the
  // execution input for direct/manual workflows).
  return false;
}

function hasPendingInput(input: NodeRuntimeInput): boolean {
  if (input.input.type === 'needs_input') return true;
  if (typeof input.input.question === 'string' && input.input.question.trim()) return true;
  if (typeof input.input.response === 'string' && responseRequestsMoreCustomerInput(input.input.response)) return true;
  for (const key of ['missingFields', 'pendingFields', 'requiredFieldsPending']) {
    const value = input.input[key];
    if (Array.isArray(value) && value.length > 0) return true;
  }
  return false;
}

export function evaluateWorkflowGoalCompletion(input: NodeRuntimeInput): GoalCompletionEvidence {
  const requiredFields = uniqueConfiguredStrings(input.node.config.requiredFields);
  const requiredOperations = uniqueConfiguredStrings(input.node.config.requiredOperations);
  const requireCompletionSignal = input.node.config.requireCompletionSignal !== false;
  const allowFieldlessCompletion = input.node.config.allowFieldlessCompletion === true;
  const knownFields = collectKnownFields(input);

  const satisfiedFields = requiredFields.filter((field) => knownFields.has(canonicalWorkflowFieldName(field)));
  const missingFields = requiredFields.filter((field) => !knownFields.has(canonicalWorkflowFieldName(field)));
  const satisfiedOperations = requiredOperations.filter((operation) => successfulOperationResult(input, operation));
  const missingOperations = requiredOperations.filter((operation) => !successfulOperationResult(input, operation));
  const completionSignalPresent = hasCompletionSignal(input);
  const blockers: string[] = [];

  if (requiredFields.length === 0 && requiredOperations.length === 0 && !allowFieldlessCompletion) {
    blockers.push('required_fields_not_configured');
  }
  if (missingFields.length > 0) blockers.push('required_fields_missing');
  if (missingOperations.length > 0) blockers.push('required_operations_incomplete');
  if (requireCompletionSignal && !completionSignalPresent) blockers.push('completion_signal_missing');
  if (hasPendingInput(input)) blockers.push('pending_customer_input');

  return {
    complete: blockers.length === 0,
    evaluatedBy: GOAL_COMPLETION_EVALUATOR,
    evidenceVersion: GOAL_COMPLETION_EVIDENCE_VERSION,
    workflowId: input.workflow.id,
    workflowVersion: input.workflow.version,
    executionId: input.execution.executionId,
    evaluatorNodeId: input.node.id,
    requiredFields,
    satisfiedFields,
    missingFields,
    requiredOperations,
    satisfiedOperations,
    missingOperations,
    completionSignalPresent,
    blockers,
  };
}

export function isValidWorkflowGoalCompletionEvidence(
  value: unknown,
  input: NodeRuntimeInput,
): value is GoalCompletionEvidence {
  if (!isRecord(value)) return false;
  if (
    value.complete !== true
    || value.evaluatedBy !== GOAL_COMPLETION_EVALUATOR
    || value.evidenceVersion !== GOAL_COMPLETION_EVIDENCE_VERSION
    || value.workflowId !== input.workflow.id
    || value.workflowVersion !== input.workflow.version
    || value.executionId !== input.execution.executionId
    || typeof value.evaluatorNodeId !== 'string'
  ) return false;

  const evaluatorNode = input.workflow.nodes.find((node) => node.id === value.evaluatorNodeId);
  const evaluatorResult = input.execution.nodeResults[value.evaluatorNodeId];
  if (
    evaluatorNode?.type !== 'logic.goal_completion'
    || evaluatorResult?.selectedOutput !== 'completed'
    || !isRecord(evaluatorResult.output?.goalCompletion)
  ) return false;

  const persistedEvidence = evaluatorResult.output.goalCompletion;
  return (
    persistedEvidence.complete === true
    && persistedEvidence.executionId === input.execution.executionId
    && persistedEvidence.evaluatorNodeId === value.evaluatorNodeId
    && Array.isArray(persistedEvidence.blockers)
    && persistedEvidence.blockers.length === 0
    && stableStringify(persistedEvidence) === stableStringify(value)
  );
}
