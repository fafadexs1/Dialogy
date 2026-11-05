import { db } from '@/lib/db';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';
import { runSgpWorkspaceTool } from '@/services/agent-tools/sgp-tools';
import { evaluateTeamBusinessHours } from '@/services/chat-distribution/team-availability';
import type { NodeExecutionResult, NodeRuntimeInput, WorkflowHandlerDependencies } from '@/services/workflow-runtime';
import { createId, isRecord, renderTemplate, statePatchAtPath } from '@/services/workflow-runtime/utils';
import { executeSgpIdentification } from './sgp-identification';
import { isValidBrazilianDocument } from '@/lib/brazilian-document';
import { saveSgpContactDocumentIfEmpty } from './sgp-contact-document';

export type NexusTemplateDelivery = {
  instanceName?: string;
  name: string;
  language: string;
  components: Array<Record<string, unknown>>;
  renderedContent?: string;
};

export type NexusPlatformActionDelivery = {
  sendResponse: NonNullable<WorkflowHandlerDependencies['sendResponse']>;
  sendOptions?: (
    options: { title: string; choices: NexusPlatformChoice[]; invalid?: boolean; invalidMessage?: string },
    input: NodeRuntimeInput,
  ) => Promise<Record<string, unknown>>;
  sendTemplate?: (template: NexusTemplateDelivery, input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
};

type SgpContract = {
  id: string;
  planDescription?: string;
  addressLabel?: string;
  connectionStatus?: string;
  statusTone?: string;
  statusLabel?: string;
};

type SgpInvoice = {
  id: string;
  contractId: string;
  dueDate?: string | null;
  correctedAmount?: number;
  amount?: number;
  digitableLine?: string | null;
  barcode?: string | null;
  paymentLink?: string | null;
  pixCode?: string | null;
  isOpen?: boolean;
};

export type NexusPlatformChoice = { id: string; label: string; description?: string };

function source(input: NodeRuntimeInput) {
  return {
    ...input.execution.variables,
    input: input.execution.input,
    current: input.input,
    variables: input.execution.variables,
    context: input.execution.context,
    nodeResults: input.execution.nodeResults,
    sessionId: input.execution.sessionId,
    conversationId: input.execution.conversationId,
  };
}

function internalStateKey(input: NodeRuntimeInput) {
  return `__nexus_sgp_${input.node.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function statePatch(input: NodeRuntimeInput, value: unknown, state: unknown = null) {
  const outputKey = String(input.node.config.outputKey || '').trim();
  return {
    [internalStateKey(input)]: state,
    ...(outputKey ? statePatchAtPath(outputKey, value) : {}),
  };
}

function outputStatePatch(input: NodeRuntimeInput, value: unknown) {
  const outputKey = String(input.node.config.outputKey || '').trim();
  return outputKey ? statePatchAtPath(outputKey, value) : undefined;
}

function actionError(message: string, code = 'SGP_ACTION_FAILED'): NodeExecutionResult {
  return {
    status: 'error',
    selectedOutput: 'error',
    error: { code, message, retryable: false },
  };
}

function normalizeChoice(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function resumeValue(input: NodeRuntimeInput): unknown {
  const resume = isRecord(input.input.resume) ? input.input.resume : null;
  return resume?.selectedOptionId ?? resume?.value ?? resume?.text ?? resume?.message ?? resume?.answer;
}

function resolveChoice(value: unknown, choices: NexusPlatformChoice[]): string | null {
  const normalized = normalizeChoice(value);
  if (!normalized) return null;
  const numericIndex = /^\d+$/.test(normalized) ? Number(normalized) - 1 : -1;
  return choices.find((choice, index) => (
    normalizeChoice(choice.id) === normalized
    || normalizeChoice(choice.label) === normalized
    || index === numericIndex
  ))?.id || null;
}

function contractChoices(contracts: SgpContract[]): NexusPlatformChoice[] {
  return contracts.map((contract) => {
    const contractStatus = String(
      contract.statusLabel
      || (contract.statusTone === 'suspended' ? 'Suspenso' : contract.statusTone === 'active' ? 'Ativo' : 'Sem status'),
    ).trim();
    const connectionStatus = contract.connectionStatus === 'online'
      ? 'Online'
      : contract.connectionStatus === 'offline'
        ? 'Offline'
        : 'Conexão não identificada';
    return {
      id: contract.id,
      // Mantém o padrão visual do Nexus antigo: contrato e situação cadastral
      // aparecem primeiro, sem serem escondidos pelo plano ou pelo endereço.
      label: `${contract.id} (${contractStatus})`,
      description: [connectionStatus, contract.addressLabel].filter(Boolean).join(' · '),
    };
  });
}

function formatSgpInvoiceDate(value: string | null | undefined) {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text || 'sem vencimento';
}

function formatSgpInvoiceMonth(value: string | null | undefined) {
  const text = String(value || '').trim();
  const isoMatch = /^(\d{4})-(\d{2})/.exec(text);
  if (isoMatch) return `${isoMatch[2]}/${isoMatch[1]}`;
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  return brMatch ? `${brMatch[2]}/${brMatch[3]}` : 'Fatura';
}

function invoiceChoices(invoices: SgpInvoice[]): NexusPlatformChoice[] {
  return invoices.map((invoice) => {
    const amount = Number(invoice.correctedAmount || invoice.amount || 0);
    const formattedAmount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
    return {
      id: invoice.id,
      label: `${formatSgpInvoiceMonth(invoice.dueDate)} - ${formattedAmount}`,
      description: `Vencimento ${formatSgpInvoiceDate(invoice.dueDate)}`,
    };
  });
}

function choicesPrompt(title: string, choices: NexusPlatformChoice[], invalid = false) {
  return [
    invalid ? 'Opção inválida. Escolha uma das opções apresentadas.' : '',
    title,
    choices.map((choice, index) => (
      `${index + 1}. ${choice.label}${choice.description ? ` — ${choice.description}` : ''}`
    )).join('\n'),
  ].filter(Boolean).join('\n\n');
}

async function waitForChoice(
  input: NodeRuntimeInput,
  delivery: NexusPlatformActionDelivery,
  title: string,
  choices: NexusPlatformChoice[],
  state: Record<string, unknown>,
  invalid = false,
): Promise<NodeExecutionResult> {
  const prompt = choicesPrompt(title, choices, invalid);
  const sent = delivery.sendOptions
    ? await delivery.sendOptions({ title, choices, invalid }, input)
    : await delivery.sendResponse(prompt, input);
  if (sent.success === false) return actionError(String(sent.error || 'Falha ao enviar as opções.'), 'SGP_PROMPT_DELIVERY_FAILED');
  const waitingSince = new Date();
  const timeoutMs = Math.max(60_000, Math.min(30 * 86_400_000, Number(input.node.config.timeoutMs || 86_400_000)));
  return {
    status: 'waiting',
    selectedOutput: 'resumed',
    waitingReason: 'time',
    resumeToken: createId(`resume_${input.execution.executionId}_${input.node.id}`),
    output: {
      prompt,
      delivery: sent,
      resumeMode: 'reexecute',
      expirationOutput: 'error',
      waitingSince: waitingSince.toISOString(),
      timeoutMs,
      expiresAt: new Date(waitingSince.getTime() + timeoutMs).toISOString(),
    },
    statePatch: { [internalStateKey(input)]: state },
  };
}

function readState(input: NodeRuntimeInput): Record<string, unknown> | null {
  const value = input.execution.variables[internalStateKey(input)];
  return isRecord(value) ? structuredClone(value) : null;
}

function asRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

async function callSgp(
  input: NodeRuntimeInput,
  action: Parameters<typeof runSgpWorkspaceTool>[1],
) {
  const workspaceId = input.workflow.workspaceId;
  const chatId = input.execution.conversationId;
  if (!workspaceId || !chatId) throw new Error('Este bloco SGP precisa ser executado em um atendimento ativo.');
  const customerIdentifier = renderTemplate(
    String(input.node.config.cpfCnpj || ''),
    source(input),
  ).trim();
  const result = await runSgpWorkspaceTool({ workspaceId, chatId, customerIdentifier }, action);
  if (result.status !== 'success' || !isRecord(result.output)) {
    throw new Error(result.error || 'O SGP não concluiu a operação.');
  }
  return result.output;
}

async function executeTeamAvailability(input: NodeRuntimeInput): Promise<NodeExecutionResult> {
  const teamId = renderTemplate(String(input.node.config.teamId || ''), source(input)).trim();
  if (!teamId) return actionError('Selecione a equipe que terá o expediente consultado.', 'DIALOGY_TEAM_REQUIRED');
  const result = await db.query(
    `SELECT t.id,
            t.name,
            w.timezone,
            COALESCE((
              SELECT json_agg(json_build_object(
                'day_of_week', bh.day_of_week,
                'is_enabled', bh.is_enabled,
                'start_time', bh.start_time,
                'end_time', bh.end_time
              ))
              FROM business_hours bh
              WHERE bh.team_id = t.id
            ), '[]'::json) AS business_hours,
            COALESCE((
              SELECT json_agg(json_build_object(
                'date', se.date,
                'is_closed', se.is_closed,
                'start_time', se.start_time,
                'end_time', se.end_time
              ))
              FROM schedule_exceptions se
              WHERE se.team_id = t.id
                AND se.date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
            ), '[]'::json) AS schedule_exceptions
     FROM teams t
     JOIN workspaces w ON w.id = t.workspace_id
     WHERE t.id = $1
       AND t.workspace_id = $2
     LIMIT 1`,
    [teamId, input.workflow.workspaceId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return actionError('Equipe não encontrada neste workspace.', 'DIALOGY_TEAM_NOT_FOUND');
  const evaluation = evaluateTeamBusinessHours({
    businessHours: Array.isArray(row.business_hours) ? row.business_hours : [],
    scheduleExceptions: Array.isArray(row.schedule_exceptions) ? row.schedule_exceptions : [],
    timezone: String(row.timezone || 'America/Sao_Paulo'),
  });
  const value = {
    teamId: String(row.id),
    teamName: String(row.name),
    isOpen: evaluation.isOpen,
    verdict: evaluation.verdict,
    currentDate: evaluation.currentDate,
    currentTime: evaluation.currentTime,
    timezone: String(row.timezone || 'America/Sao_Paulo'),
  };
  return {
    status: 'route',
    selectedOutput: evaluation.isOpen ? 'open' : 'closed',
    output: value,
    statePatch: outputStatePatch(input, value),
  };
}

async function executeChatTag(input: NodeRuntimeInput): Promise<NodeExecutionResult> {
  const workspaceId = input.workflow.workspaceId;
  const chatId = input.execution.conversationId;
  const tagId = renderTemplate(String(input.node.config.tagId || ''), source(input)).trim();
  if (!workspaceId || !chatId) return actionError('Este bloco precisa ser executado em um atendimento ativo.', 'DIALOGY_CHAT_REQUIRED');
  if (!tagId) return actionError('Selecione a etiqueta que será aplicada.', 'DIALOGY_TAG_REQUIRED');
  const result = await db.query(
    `UPDATE chats AS chat
     SET tag = selected_tag.label,
         color = selected_tag.color,
         updated_at = timezone('utc', now())
     FROM tags AS selected_tag
     WHERE chat.id = $1
       AND chat.workspace_id = $2
       AND selected_tag.id = $3
       AND selected_tag.workspace_id = chat.workspace_id
     RETURNING selected_tag.id AS tag_id,
               selected_tag.label,
               selected_tag.color`,
    [chatId, workspaceId, tagId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return actionError('Atendimento ou etiqueta não encontrado neste workspace.', 'DIALOGY_TAG_NOT_FOUND');
  await broadcastHydratedChatUpdate(workspaceId, chatId);
  const value = { chatId, tagId: String(row.tag_id), label: String(row.label), color: String(row.color) };
  return { status: 'success', selectedOutput: 'success', output: value, statePatch: outputStatePatch(input, value) };
}

async function loadPanel(input: NodeRuntimeInput) {
  const cpfCnpj = renderTemplate(String(input.node.config.cpfCnpj || ''), source(input)).trim();
  return callSgp(input, {
    type: 'sgp_fetch_contact_panel_data',
    reason: 'NexusFlow',
    payload: { customerIdentifier: cpfCnpj || null },
  });
}

function eligibleContracts(value: unknown): SgpContract[] {
  return asRecords(value)
    .map((contract) => contract as SgpContract)
    .filter((contract) => Boolean(contract.id) && ['active', 'suspended'].includes(String(contract.statusTone || '')));
}

async function executeContractStatus(
  input: NodeRuntimeInput,
  delivery: NexusPlatformActionDelivery,
): Promise<NodeExecutionResult> {
  const resumedState = readState(input);
  let state = resumedState;
  if (!state) {
    const panel = await loadPanel(input);
    const contracts = eligibleContracts(panel.contracts);
    if (contracts.length === 0) return actionError('Nenhum contrato ativo ou suspenso foi encontrado para este cliente.', 'SGP_CONTRACT_NOT_FOUND');
    state = { stage: 'contract', contracts };
  }
  const contracts = asRecords(state.contracts).map((contract) => contract as SgpContract);
  let selectedContractId = String(state.selectedContractId || '');
  if (!selectedContractId && contracts.length === 1) selectedContractId = contracts[0]!.id;
  if (!selectedContractId) {
    // An initial resume value can belong to the input node that supplied the
    // CPF/CNPJ. Only consume it after this action has persisted a waiting state.
    const answer = resumedState ? resumeValue(input) : undefined;
    if (answer !== undefined) selectedContractId = resolveChoice(answer, contractChoices(contracts)) || '';
    if (!selectedContractId) {
      return waitForChoice(input, delivery, 'Por favor, informe o contrato:', contractChoices(contracts), state, answer !== undefined);
    }
  }
  const contract = contracts.find((candidate) => candidate.id === selectedContractId);
  if (!contract) return actionError('O contrato selecionado não foi encontrado.', 'SGP_CONTRACT_NOT_FOUND');
  const active = contract.statusTone === 'active';
  const value = { status: active ? 'ativo' : 'suspenso', contract };
  return {
    status: 'route',
    selectedOutput: active ? 'active' : 'suspended',
    output: value,
    statePatch: statePatch(input, value.status),
  };
}

function paymentMethods(invoice: SgpInvoice): NexusPlatformChoice[] {
  const methods: NexusPlatformChoice[] = [{ id: 'pix', label: 'PIX copia e cola' }];
  if (invoice.digitableLine || invoice.barcode) methods.push({ id: 'boleto', label: 'Linha digitável do boleto' });
  if (invoice.paymentLink) methods.push({ id: 'link', label: 'Link de pagamento' });
  return methods;
}

function findNestedValue(value: unknown, keys: string[], depth = 0): string {
  if (depth > 4 || !isRecord(value)) return '';
  for (const key of keys) {
    const direct = value[key];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
  }
  for (const nested of Object.values(value)) {
    const match = findNestedValue(nested, keys, depth + 1);
    if (match) return match;
  }
  return '';
}

function templateDelivery(input: NodeRuntimeInput, method: 'pix' | 'boleto', code: string): NexusTemplateDelivery {
  const prefix = method === 'pix' ? 'pixTemplate' : 'boletoTemplate';
  const count = Math.max(1, Number(input.node.config[`${prefix}BodyParameterCount`] || 1));
  const position = Math.min(count, Math.max(1, Number(input.node.config[`${prefix}BodyParameter`] || 1)));
  return {
    instanceName: String(input.node.config[`${prefix}Instance`] || input.execution.context.instanceName || '').trim() || undefined,
    name: String(input.node.config[`${prefix}Name`] || '').trim(),
    language: String(input.node.config[`${prefix}Language`] || 'pt_BR').trim(),
    components: [{
      type: 'body',
      parameters: Array.from({ length: count }, (_, index) => ({ type: 'text', text: index + 1 === position ? code : '-' })),
    }],
  };
}

async function deliverPaymentCode(
  input: NodeRuntimeInput,
  delivery: NexusPlatformActionDelivery,
  method: 'pix' | 'boleto' | 'link',
  code: string,
) {
  if (input.node.config.deliveryMode === 'cloud-template' && method !== 'link') {
    if (!delivery.sendTemplate) throw new Error('O canal atual não oferece envio de template aprovado.');
    const template = templateDelivery(input, method, code);
    if (!template.name || !template.instanceName) throw new Error(`Configure o template de ${method === 'pix' ? 'PIX' : 'boleto'} e sua instância.`);
    const result = await delivery.sendTemplate(template, input);
    if (result.success === false) throw new Error(String(result.error || 'Falha ao enviar o template.'));
    return result;
  }
  // PIX e linha digitável precisam ser copiáveis como uma mensagem pura. Qualquer
  // prefixo obriga o cliente a editar o conteúdo antes de colar no banco.
  const content = method === 'link' ? `Link de pagamento:\n\n${code}` : code;
  const result = await delivery.sendResponse(content, input);
  if (result.success === false) throw new Error(String(result.error || 'Falha ao enviar a segunda via.'));
  return result;
}

async function executeSecondCopy(
  input: NodeRuntimeInput,
  delivery: NexusPlatformActionDelivery,
): Promise<NodeExecutionResult> {
  const resumedState = readState(input);
  let state = resumedState;
  if (!state) {
    const panel = await loadPanel(input);
    const document = renderTemplate(String(input.node.config.cpfCnpj || ''), source(input)).trim();
    // Persist only an explicitly supplied, valid document confirmed by this SGP lookup.
    // A customer without open invoices can still be identified successfully.
    if (isValidBrazilianDocument(document) && asRecords(panel.contracts).some((contract) => Boolean(contract.id))) {
      await saveSgpContactDocumentIfEmpty({
        workspaceId: input.workflow.workspaceId!,
        chatId: input.execution.conversationId!,
        document,
      });
    }
    const contracts = eligibleContracts(panel.contracts);
    if (contracts.length === 0) return actionError('Nenhum contrato ativo ou suspenso foi encontrado para este cliente.', 'SGP_CONTRACT_NOT_FOUND');
    state = { stage: 'contract', contracts, invoices: asRecords(panel.invoices) };
  }
  const contracts = asRecords(state.contracts).map((contract) => contract as SgpContract);
  const allInvoices = asRecords(state.invoices).map((invoice) => invoice as SgpInvoice);
  // Do not treat the CPF/CNPJ collected by the preceding node as an answer to
  // this action's contract or invoice prompts.
  let answer = resumedState ? resumeValue(input) : undefined;
  let selectedContractId = String(state.selectedContractId || '');
  if (!selectedContractId && contracts.length === 1) {
    selectedContractId = contracts[0]!.id;
    // The resume value belongs to the previous input node (usually the CPF/CNPJ).
    // Once the only contract is selected automatically, it must not be reused as
    // a numeric invoice choice (for example, CPF 004... selecting option 4).
    answer = undefined;
    state = { ...state, stage: 'invoice', selectedContractId };
  }
  if (!selectedContractId) {
    if (answer !== undefined) selectedContractId = resolveChoice(answer, contractChoices(contracts)) || '';
    if (!selectedContractId) return waitForChoice(input, delivery, 'Por favor, informe o contrato:', contractChoices(contracts), state, answer !== undefined);
    answer = undefined;
    state = { ...state, stage: 'invoice', selectedContractId };
  }
  const invoices = allInvoices.filter((invoice) => invoice.contractId === selectedContractId && invoice.isOpen === true);
  if (invoices.length === 0) return actionError('Este contrato não possui faturas em aberto para segunda via.', 'SGP_INVOICE_NOT_FOUND');
  let selectedInvoiceId = String(state.selectedInvoiceId || '');
  if (!selectedInvoiceId) {
    if (answer !== undefined) selectedInvoiceId = resolveChoice(answer, invoiceChoices(invoices)) || '';
    if (!selectedInvoiceId) return waitForChoice(
      input,
      delivery,
      'Qual fatura você deseja pagar?',
      invoiceChoices(invoices),
      { ...state, stage: 'invoice', selectedContractId },
      answer !== undefined,
    );
    answer = undefined;
    state = { ...state, stage: 'payment-method', selectedContractId, selectedInvoiceId };
  }
  const invoice = invoices.find((candidate) => candidate.id === selectedInvoiceId);
  if (!invoice) return actionError('A fatura selecionada não foi encontrada.', 'SGP_INVOICE_NOT_FOUND');
  const methods = paymentMethods(invoice);
  let selectedPaymentMethod = String(state.selectedPaymentMethod || '');
  if (!selectedPaymentMethod) {
    if (answer !== undefined) selectedPaymentMethod = resolveChoice(answer, methods) || '';
    if (!selectedPaymentMethod) return waitForChoice(
      input,
      delivery,
      'Como deseja receber a segunda via?',
      methods,
      { ...state, stage: 'payment-method', selectedInvoiceId },
      answer !== undefined,
    );
  }
  if (!['pix', 'boleto', 'link'].includes(selectedPaymentMethod)) return actionError('Forma de pagamento inválida.', 'SGP_PAYMENT_METHOD_INVALID');
  const method = selectedPaymentMethod as 'pix' | 'boleto' | 'link';
  let code = method === 'pix'
    ? String(invoice.pixCode || '')
    : method === 'boleto'
      ? String(invoice.digitableLine || invoice.barcode || '')
      : String(invoice.paymentLink || '');
  if (method === 'pix' && !code) {
    const generated = await callSgp(input, {
      type: 'sgp_generate_invoice_pix',
      reason: 'NexusFlow',
      payload: { invoiceId: invoice.id, contractId: selectedContractId },
    });
    code = findNestedValue(generated, ['codigoPix', 'pixCode', 'qrCode', 'qrcode', 'copiaECola', 'copiaecola']);
  }
  code = code.trim();
  if (!code) return actionError('O SGP não retornou o código solicitado para esta fatura.', 'SGP_PAYMENT_CODE_NOT_FOUND');
  const deliveryResult = await deliverPaymentCode(input, delivery, method, code);
  const value = { contractId: selectedContractId, invoice, method, code, delivery: deliveryResult };
  return { status: 'success', selectedOutput: 'success', output: value, statePatch: statePatch(input, code) };
}

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function isPaymentPromiseLimitReached(message: string) {
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
  return (
    /quantidade\s+permitida/.test(normalized)
    || /limite.*promessa/.test(normalized)
    || /promessa.*limite/.test(normalized)
    || /recurso.*promessa.*nao\s+disponivel/.test(normalized)
  );
}

async function executePaymentPromise(
  input: NodeRuntimeInput,
  delivery: NexusPlatformActionDelivery,
): Promise<NodeExecutionResult> {
  const resumedState = readState(input);
  let state = resumedState;
  if (!state) {
    const panel = await loadPanel(input);
    const contracts = eligibleContracts(panel.contracts);
    if (contracts.length === 0) return actionError('Nenhum contrato ativo ou suspenso foi encontrado para este cliente.', 'SGP_CONTRACT_NOT_FOUND');
    state = { stage: 'contract', contracts };
  }
  const contracts = asRecords(state.contracts).map((contract) => contract as SgpContract);
  let selectedContractId = String(state.selectedContractId || '');
  if (!selectedContractId && contracts.length === 1) selectedContractId = contracts[0]!.id;
  if (!selectedContractId) {
    const answer = resumedState ? resumeValue(input) : undefined;
    if (answer !== undefined) selectedContractId = resolveChoice(answer, contractChoices(contracts)) || '';
    if (!selectedContractId) return waitForChoice(input, delivery, 'Por favor, informe o contrato:', contractChoices(contracts), state, answer !== undefined);
  }
  const configuredDate = renderTemplate(String(input.node.config.promiseDate || ''), source(input)).trim();
  const promiseDate = configuredDate || saoPauloDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(promiseDate)) return actionError('A data da promessa deve usar o formato AAAA-MM-DD.', 'SGP_PROMISE_DATE_INVALID');
  const response = await callSgp(input, {
    type: 'sgp_create_payment_promise',
    reason: 'NexusFlow',
    payload: { contractId: selectedContractId, promiseDate, sendSms: input.node.config.sendSms !== false },
  });
  const payload = isRecord(response.payload) ? response.payload : response;
  const status = Number(payload.status);
  const providerMessage = String(payload.msg || payload.message || '').trim();
  const limitReached = status === 2 && isPaymentPromiseLimitReached(providerMessage);
  const messages: Record<number, string> = {
    0: 'A conexão do cliente não foi bloqueada.',
    1: 'A conexão foi liberada provisoriamente. Assim que o pagamento constar, continuará liberada.',
    2: limitReached
      ? 'O limite de desbloqueios de confiança permitido pelo SGP já foi utilizado. Vou encaminhar seu atendimento ao financeiro.'
      : providerMessage
        ? `Não foi possível realizar a liberação provisória. Motivo informado pelo SGP: ${providerMessage}`
        : 'Não foi possível realizar a liberação provisória. Encaminharei o atendimento ao financeiro.',
  };
  if (![0, 1, 2].includes(status)) return actionError(`O SGP retornou um status inesperado: ${String(payload.status)}.`, 'SGP_PROMISE_STATUS_INVALID');
  const sent = await delivery.sendResponse(messages[status]!, input);
  if (sent.success === false) return actionError(String(sent.error || 'Falha ao informar o resultado da promessa.'), 'SGP_RESULT_DELIVERY_FAILED');
  const value = {
    contractId: selectedContractId,
    promiseDate,
    status,
    reason: providerMessage || null,
    limitReached,
    response: payload,
    delivery: sent,
  };
  return {
    status: 'route',
    selectedOutput: limitReached ? 'limit-reached' : `status-${status}`,
    output: value,
    statePatch: statePatch(input, value),
  };
}

export async function executeNexusPlatformAction(
  input: NodeRuntimeInput,
  delivery: NexusPlatformActionDelivery,
): Promise<NodeExecutionResult> {
  try {
    if (input.node.type === 'dialogy.sgp_identify_customer') return await executeSgpIdentification(input, delivery);
    if (input.node.type === 'dialogy.team_availability') return await executeTeamAvailability(input);
    if (input.node.type === 'dialogy.chat_tag') return await executeChatTag(input);
    if (input.node.type === 'dialogy.sgp_contract_status') return await executeContractStatus(input, delivery);
    if (input.node.type === 'dialogy.sgp_second_copy') return await executeSecondCopy(input, delivery);
    if (input.node.type === 'dialogy.sgp_payment_promise') return await executePaymentPromise(input, delivery);
    return actionError(`Ação nativa não implementada: ${input.node.type}.`, 'PLATFORM_ACTION_NOT_IMPLEMENTED');
  } catch (error) {
    return actionError(error instanceof Error ? error.message : String(error));
  }
}
