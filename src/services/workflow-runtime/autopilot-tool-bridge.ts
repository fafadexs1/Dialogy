import { validateSchema } from 'genkit/schema';
import { z } from 'zod';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  getAgentToolDefinition,
  type AgentToolDefinition,
} from '@/services/agent-tools/catalog';
import { runAgentTools } from '@/services/agent-tools/runtime';
import { selectRequestedSgpInvoice } from '@/services/autopilot/customer-response-preparation';
import type {
  AgentToolAction,
  AgentToolName,
  AgentToolRuntimeContext,
  AgentToolExecutionResult,
} from '@/services/agent-tools/types';
import { ToolRegistry } from './tools';
import { canonicalWorkflowFieldName } from './goal-completion';
import { normalizeToolArgumentsFromJsonSchema } from './tool-arguments';

export type AutopilotToolBridgeDefinition = Pick<
  AgentToolDefinition,
  | 'name'
  | 'description'
  | 'riskLevel'
  | 'idempotent'
  | 'timeoutMs'
  | 'maxAttempts'
  | 'requiresHumanApproval'
  | 'inputSchema'
  | 'outputSchema'
> & {
  name: AgentToolName;
  class?: AgentToolDefinition['class'];
  requiredSlots?: string[];
};

export type NativeToolStatusEvent = {
  runId: string;
  toolName: string;
  status: 'running' | AgentToolExecutionResult['status'];
  result?: AgentToolExecutionResult;
};

function jsonObjectSchema(
  jsonSchema: Record<string, unknown> | null | undefined,
  label: string,
  hydrate?: (value: Record<string, unknown>) => Record<string, unknown>,
) {
  return z.record(z.unknown())
    .transform((value) => {
      const normalized = normalizeToolArgumentsFromJsonSchema(value, jsonSchema);
      return hydrate ? hydrate(normalized) : normalized;
    })
    .superRefine((value, context) => {
    if (!jsonSchema || Object.keys(jsonSchema).length === 0) return;
    const validation = validateSchema(value, { jsonSchema });
    if (validation.valid) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${label} failed JSON schema validation.`,
    });
  });
}

function jsonSchemaWithoutRequiredField(
  jsonSchema: Record<string, unknown> | null | undefined,
  field: string,
): Record<string, unknown> | null | undefined {
  if (!jsonSchema) return jsonSchema;
  const properties = jsonSchema.properties && typeof jsonSchema.properties === 'object' && !Array.isArray(jsonSchema.properties)
    ? Object.fromEntries(
      Object.entries(jsonSchema.properties as Record<string, unknown>)
        .filter(([property]) => property !== field),
    )
    : jsonSchema.properties;
  return {
    ...jsonSchema,
    ...(properties ? { properties } : {}),
    ...(Array.isArray(jsonSchema.required)
      ? { required: jsonSchema.required.map(String).filter((item) => item !== field) }
      : {}),
  };
}

function normalizeKnownFieldName(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractKnownContractId(knownFields: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(knownFields)) {
    const normalizedKey = normalizeKnownFieldName(key);
    const isContractField = (
      /^(?:contract|contrato)(?: id| number| numero)?$/.test(normalizedKey)
      || /^(?:id|numero) (?:do )?(?:contract|contrato|servico)$/.test(normalizedKey)
    );
    if (!isContractField || value === null || value === undefined) continue;
    const contractId = String(value).match(/\b\d{2,30}\b/)?.[0];
    if (contractId) return contractId;
  }
  return null;
}

function extractKnownCustomerIdentifier(knownFields: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(knownFields)) {
    if (canonicalWorkflowFieldName(key) !== 'customer_identifier') continue;
    const identifier = String(value ?? '').replace(/\D/g, '');
    if (identifier.length === 11 || identifier.length === 14) return identifier;
  }
  return null;
}

function contractIdFromOutputEntry(value: Record<string, unknown>): string {
  return String(
    value.id
    ?? value.contractId
    ?? value.contract_id
    ?? value.contrato
    ?? value.contrato_id
    ?? '',
  ).replace(/\D/g, '');
}

export function extractSgpContractIp(
  output: Record<string, unknown>,
  requestedContractId?: string | null,
): string | null {
  const contracts = Array.isArray(output.contracts) ? output.contracts : [];
  const records = contracts.filter((entry): entry is Record<string, unknown> => (
    Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
  ));
  const normalizedContractId = String(requestedContractId || '').replace(/\D/g, '');
  const contract = normalizedContractId
    ? records.find((entry) => contractIdFromOutputEntry(entry) === normalizedContractId)
    : records.length === 1 ? records[0] : null;
  const ip = contract && typeof contract.ip === 'string'
    ? String(contract.ip).trim()
    : '';
  return isIP(ip) > 0 ? ip : null;
}

export function hydrateClientIpArgument(
  argumentsValue: Record<string, unknown>,
  resolvedClientIp: string | null,
): Record<string, unknown> {
  return resolvedClientIp ? { ...argumentsValue, client_ip: resolvedClientIp } : argumentsValue;
}

export function normalizeNativeToolArguments(
  toolName: string,
  argumentsValue: Record<string, unknown>,
): Record<string, unknown> {
  if (!/(?:^|:)change_wifi_(?:channel|name|password)$|(?:^|:)set_wifi_(?:enabled|visibility)$/.test(toolName)) {
    return argumentsValue;
  }
  const rawBand = typeof argumentsValue.band === 'string'
    ? argumentsValue.band.trim().toLowerCase().replace(/\s+/g, '')
    : '';
  const band = /^(?:2[.,]?4)(?:ghz|g)?$/.test(rawBand)
    ? '2.4'
    : /^(?:5)(?:ghz|g)?$/.test(rawBand)
      ? '5'
      : null;
  return band ? { ...argumentsValue, band } : argumentsValue;
}

function actionForTool(
  toolName: AgentToolName,
  argumentsValue: Record<string, unknown>,
): AgentToolAction {
  if (toolName.startsWith('mcp:')) {
    return {
      type: 'mcp_call_tool',
      reason: 'Solicitação do workflow runtime.',
      payload: {
        toolName,
        arguments: argumentsValue,
      },
    };
  }
  return {
    type: toolName,
    reason: 'Solicitação do workflow runtime.',
    payload: argumentsValue,
  } as AgentToolAction;
}

function resolveDefinition(
  toolName: AgentToolName,
  provided: Map<string, AutopilotToolBridgeDefinition>,
): AutopilotToolBridgeDefinition | null {
  const custom = provided.get(toolName);
  if (toolName.startsWith('mcp:')) return custom || null;
  const canonical = getAgentToolDefinition(toolName);
  if (!custom) return canonical;
  if (!canonical) return custom;
  const schema = custom.inputSchema;
  const hasProperties = schema?.properties && typeof schema.properties === 'object'
    && Object.keys(schema.properties).length > 0;
  return {
    ...custom,
    class: canonical.class,
    riskLevel: canonical.riskLevel === 'high' || custom.riskLevel === 'high' ? 'high'
      : canonical.riskLevel === 'medium' || custom.riskLevel === 'medium' ? 'medium' : 'low',
    description: custom.description === toolName ? canonical.description : custom.description,
    // Published cutovers can contain {} or just {type:'object'}. Those are
    // placeholders, not an intentional replacement of the native contract.
    inputSchema: toolName === 'sgp_generate_invoice_pix' ? canonical.inputSchema
      : hasProperties ? schema : canonical.inputSchema || schema,
  };
}

export function createAutopilotToolRegistry(input: {
  context: AgentToolRuntimeContext;
  toolNames: AgentToolName[];
  definitions?: AutopilotToolBridgeDefinition[];
  knownFields?: Record<string, unknown>;
  responseTimeZone?: string;
  reportToolStatus?: (event: NativeToolStatusEvent) => Promise<void>;
}): ToolRegistry {
  // The existing Autopilot policy and durable claim remain the final authority.
  const registry = new ToolRegistry(() => true);
  const provided = new Map((input.definitions || []).map((definition) => [definition.name, definition]));
  const knownFields = input.knownFields || {};
  const knownContractId = extractKnownContractId(knownFields);
  const knownCustomerIdentifier = extractKnownCustomerIdentifier(knownFields);
  let resolvedClientIp: string | null = null;
  let sgpLookupCompleted = false;
  let sgpSnapshot: Record<string, unknown> | null = null;
  const executeWithStatus = async (
    action: AgentToolAction,
    displayToolName: string,
  ): Promise<AgentToolExecutionResult | undefined> => {
    const runId = randomUUID();
    try {
      await input.reportToolStatus?.({
        runId,
        toolName: displayToolName,
        status: 'running',
      });
    } catch (error) {
      console.warn('[NATIVE_TOOL_STATUS] Failed to report running tool:', error);
    }
    const [result] = await runAgentTools(input.context, [action]);
    if (result) {
      try {
        await input.reportToolStatus?.({
          runId,
          toolName: displayToolName,
          status: result.status,
          result,
        });
      } catch (error) {
        console.warn('[NATIVE_TOOL_STATUS] Failed to report terminal tool status:', error);
      }
    }
    return result;
  };

  for (const toolName of input.toolNames) {
    const definition = resolveDefinition(toolName, provided);
    if (!definition) continue;
    const requiredInputFields = Array.isArray(definition.inputSchema?.required)
      ? definition.inputSchema.required.map(String)
      : [];
    const inputProperties = definition.inputSchema?.properties;
    const requiresClientIp = requiredInputFields.includes('client_ip') || Boolean(
      inputProperties
      && typeof inputProperties === 'object'
      && !Array.isArray(inputProperties)
      && Object.prototype.hasOwnProperty.call(inputProperties, 'client_ip'),
    );
    const modelInputSchema = requiresClientIp
      ? jsonSchemaWithoutRequiredField(definition.inputSchema, 'client_ip')
      : definition.inputSchema;
    const isSnapshotTool = definition.class
      ? ['read_only', 'compute_only', 'retrieval'].includes(definition.class)
      : definition.riskLevel === 'low';
    registry.register({
      name: toolName,
      description: definition.description,
      inputJsonSchema: modelInputSchema || {},
      inputSchema: jsonObjectSchema(
        modelInputSchema,
        `${toolName} input`,
        (argumentsValue) => {
          const normalized = normalizeNativeToolArguments(toolName, argumentsValue);
          return requiresClientIp
            ? hydrateClientIpArgument(normalized, resolvedClientIp)
            : normalized;
        },
      ),
      outputSchema: jsonObjectSchema(definition.outputSchema, `${toolName} output`),
      timeoutMs: definition.timeoutMs,
      retryPolicy: {
        maxAttempts: Math.max(1, definition.maxAttempts),
        initialDelayMs: 250,
        backoffMultiplier: 2,
        maxDelayMs: 5_000,
        retryableErrorCodes: ['TIMEOUT', 'NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE'],
      },
      idempotent: definition.idempotent,
      // Read-only/retrieval results are snapshots, not durable operation
      // results. In particular, command status must be fetched again while it
      // is pending instead of replaying the first response forever.
      cacheResult: !isSnapshotTool,
      allowRepeatedCallsWhilePending: isSnapshotTool,
      riskLevel: definition.riskLevel,
      requiresConfirmation: definition.requiresHumanApproval,
      execute: async (argumentsValue) => {
		let executableArguments = normalizeNativeToolArguments(
          toolName,
          normalizeToolArgumentsFromJsonSchema(argumentsValue, definition.inputSchema),
        );
        if (toolName === 'sgp_fetch_contact_panel_data') {
          executableArguments = {
            ...argumentsValue,
            ...(knownContractId ? { contractId: knownContractId } : {}),
            ...(knownCustomerIdentifier ? { customerIdentifier: knownCustomerIdentifier } : {}),
          };
        }
        if (requiresClientIp) {
          if (!resolvedClientIp && !sgpLookupCompleted) {
            const lookupResult = await executeWithStatus({
              type: 'sgp_fetch_contact_panel_data',
              reason: 'Resolver o IP WAN atual do contrato antes da operacao no roteador.',
              payload: {
                contractId: knownContractId,
                customerIdentifier: knownCustomerIdentifier,
              },
            }, 'sgp_fetch_contact_panel_data');
            if (!lookupResult || lookupResult.status !== 'success') {
              const error = new Error(
                lookupResult?.error || 'Nao foi possivel consultar o IP WAN atual no SGP.',
              ) as Error & { code?: string; retryable?: boolean };
              error.code = 'TOOL_DEPENDENCY_FAILED';
              error.retryable = false;
              throw error;
            }
            const lookupOutput = lookupResult.output && typeof lookupResult.output === 'object'
              ? lookupResult.output
              : {};
            sgpLookupCompleted = true;
            sgpSnapshot = lookupOutput;
            resolvedClientIp = extractSgpContractIp(lookupOutput, knownContractId);
          }
          executableArguments = hydrateClientIpArgument(executableArguments, resolvedClientIp);
          if (!String(executableArguments.client_ip || '').trim()) {
            const error = new Error(
              knownContractId
                ? `O SGP nao retornou um IP WAN atual para o contrato ${knownContractId}.`
                : 'Informe o contrato antes de consultar o roteador; nao e seguro escolher o IP entre varios contratos.',
            ) as Error & { code?: string; retryable?: boolean };
            error.code = 'TOOL_DEPENDENCY_MISSING';
            error.retryable = false;
            throw error;
          }
        }
        if (toolName === 'sgp_generate_invoice_pix') {
          if (!sgpSnapshot) {
            const lookup = await executeWithStatus({
              type: 'sgp_fetch_contact_panel_data',
              reason: 'Conferir fatura, contrato e PIX existente antes de gerar um pagamento.',
              payload: { contractId: knownContractId, customerIdentifier: knownCustomerIdentifier },
            }, 'sgp_fetch_contact_panel_data');
            if (!lookup || lookup.status !== 'success' || !lookup.output) {
              const error = new Error('[SGP_INVOICE_LOOKUP_FAILED] Não foi possível verificar a fatura no SGP. Nenhum PIX foi gerado.') as Error & { code: string };
              error.code = 'SGP_INVOICE_LOOKUP_FAILED';
              throw error;
            }
            sgpSnapshot = lookup.output;
          }
          const selection = selectRequestedSgpInvoice({
            snapshot: sgpSnapshot,
            customerMessage: input.context.customerMessage,
            timeZone: input.responseTimeZone,
          });
          const invoice = selection.invoice;
          if (!invoice || String(invoice.id) !== String(executableArguments.invoiceId)
            || String(invoice.contractId) !== String(executableArguments.contractId)) {
            return { generated: false, requiresClarification: true, reason: selection.reason,
              message: 'Confirme com o cliente qual fatura e contrato ele deseja. Nenhum PIX foi gerado.' };
          }
          if (!invoice.isOpen || invoice.isPaid || invoice.isCancelled) {
            return { generated: false, payable: false, invoiceId: invoice.id, contractId: invoice.contractId,
              message: 'Esta fatura não está em aberto. Nenhum PIX foi gerado.' };
          }
          if (invoice.pixCode) {
            return { generated: false, reused: true, invoiceId: invoice.id, contractId: invoice.contractId, pixCode: invoice.pixCode };
          }
        }
        if (definition.inputSchema && Object.keys(definition.inputSchema).length > 0) {
          const validation = validateSchema(executableArguments, { jsonSchema: definition.inputSchema });
          if (!validation.valid) {
            const error = new Error(`${toolName} input failed JSON schema validation after dependency resolution.`) as Error & {
              code?: string;
              retryable?: boolean;
            };
            error.code = 'INVALID_TOOL_ARGUMENTS';
            error.retryable = false;
            throw error;
          }
        }
        const result = await executeWithStatus(
          actionForTool(toolName, executableArguments),
          toolName,
        );
        if (!result || result.status !== 'success') {
          let errorMsg = result?.error || `Tool ${toolName} failed.`;
          const structured = (result?.output as any)?.structuredContent;
          if (structured?.remedial_suggestion && !errorMsg.includes('[Instrução Corretiva do ACS]')) {
            errorMsg += `\n[Instrução Corretiva do ACS]: ${structured.remedial_suggestion}`;
          }
          const error = new Error(errorMsg) as Error & {
            code?: string;
            retryable?: boolean;
          };
          error.code = result?.status === 'rejected' ? 'TOOL_REJECTED' : 'TOOL_EXECUTION_FAILED';
          error.retryable = false;
          throw error;
        }
        const output = result.output && typeof result.output === 'object'
          ? result.output
          : {};
        if (toolName === 'sgp_fetch_contact_panel_data') {
          sgpLookupCompleted = true;
          sgpSnapshot = output;
          resolvedClientIp = extractSgpContractIp(
            output,
            String(executableArguments.contractId || knownContractId || ''),
          );
        }
        return output;
      },
    });
  }

  return registry;
}
