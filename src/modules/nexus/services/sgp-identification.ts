import { lookupSgpCustomerContracts, type SgpIdentificationContract } from '@/services/agent-tools/sgp-tools';
import { isValidBrazilianDocument, normalizeBrazilianDocument } from '@/lib/brazilian-document';
import { saveSgpContactDocumentIfEmpty } from './sgp-contact-document';
import type { NodeExecutionResult, NodeRuntimeInput } from '@/services/workflow-runtime/types';
import { createId, isRecord, renderTemplate, statePatchAtPath } from '@/services/workflow-runtime/utils';
import type { NexusPlatformActionDelivery, NexusPlatformChoice } from './platform-actions';

import { getSgpIdentificationMessage, type SgpIdentificationMessageKey } from './sgp-identification-messages';

const PAGE_SIZE = 6; // Six contracts + previous/next + another CPF + back fit WhatsApp's ten rows.
type SelectionState = {
  stage: 'cpf' | 'missing' | 'not-found' | 'contracts';
  cpfCnpj?: string;
  contracts?: SgpIdentificationContract[];
  page?: number;
};

export async function executeSgpIdentification(input: NodeRuntimeInput, delivery: NexusPlatformActionDelivery): Promise<NodeExecutionResult> {
  const key = `__nexus_identify_${input.node.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const stored = input.execution.variables[key];
  const state = isRecord(stored) ? stored as SelectionState : null;
  const resume = state && isRecord(input.input.resume) ? input.input.resume : {};
  const answer = String(resume.selectedOptionId ?? resume.value ?? resume.text ?? resume.message ?? '').trim();
  const text = (name: SgpIdentificationMessageKey, values: Record<string, unknown> = {}) => renderTemplate(getSgpIdentificationMessage(input.node.config, name), { ...input.execution.variables, input: input.execution.input, current: input.input, variables: input.execution.variables, context: input.execution.context, ...values });
  const allowNew = input.node.config.allowNewCustomer === true;
  const result = (selectedOutput: string, value: Record<string, unknown>): NodeExecutionResult => {
    // State patches merge objects, so clear fields from any earlier identification.
    const identity = { cpfCnpj: '', id: '', contractId: '', statusTone: 'unknown', statusLabel: '', addressLabel: '', planDescription: '', summary: '', ...value };
    return {
      status: 'route', selectedOutput, output: identity,
      statePatch: { [key]: null, ...statePatchAtPath(String(input.node.config.outputKey || 'sgpIdentification'), identity) },
    };
  };
  const fail = (): NodeExecutionResult => ({
    ...result('error', { status: 'unavailable', contractId: '', addressLabel: '', summary: 'Identificação SGP indisponível; contrato não confirmado.' }),
    status: 'error', error: { code: 'SGP_IDENTIFICATION_UNAVAILABLE', message: 'Não foi possível consultar o SGP agora.', retryable: false },
  });
  const wait = async (next: SelectionState, title: string, choices: NexusPlatformChoice[] = [], invalid = false): Promise<NodeExecutionResult> => {
    const prompt = [invalid ? text('invalidOption') : '', title,
      choices.map((choice, index) => `${index + 1}. ${choice.label}${choice.description ? ` — ${choice.description}` : ''}`).join('\n'),
    ].filter(Boolean).join('\n\n');
    const sent = choices.length && delivery.sendOptions
      ? await delivery.sendOptions({ title, choices, invalid, invalidMessage: text('invalidOption') }, input)
      : await delivery.sendResponse(prompt, input);
    if (sent.success === false) return fail();
    const now = Date.now();
    const timeoutMs = Math.max(60_000, Math.min(30 * 86_400_000, Number(input.node.config.timeoutMs) || 86_400_000));
    return {
      status: 'waiting', selectedOutput: 'resumed', waitingReason: 'time',
      resumeToken: createId(`identify_${input.execution.executionId}_${input.node.id}`),
      output: { prompt, delivery: sent, resumeMode: 'reexecute', expirationOutput: 'cancelled',
        waitingSince: new Date(now).toISOString(), timeoutMs, expiresAt: new Date(now + timeoutMs).toISOString() },
      statePatch: { [key]: next },
    };
  };
  const choicesFor = (current: SelectionState): NexusPlatformChoice[] => {
    const contracts = current.contracts || [];
    const page = current.page || 0;
    return [
      ...(current.stage === 'contracts' ? contracts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(contract => ({
        id: `contract:${contract.id}`, label: `${contract.id} (${contract.statusLabel})`,
        description: [contract.addressLabel, contract.planDescription].filter(Boolean).join(' · '),
      })) : []),
      ...(page > 0 ? [{ id: 'previous', label: text('previousLabel') }] : []),
      ...((page + 1) * PAGE_SIZE < contracts.length ? [{ id: 'next', label: text('nextLabel') }] : []),
      { id: 'other_cpf', label: current.stage === 'missing' ? text('enterDocumentLabel') : text('otherDocumentLabel') },
      ...(allowNew && current.stage !== 'contracts' ? [{ id: 'new_customer', label: text('newCustomerLabel') }] : []),
      { id: 'back', label: text('backLabel') },
    ];
  };
  const show = (current: SelectionState, invalid = false) => wait(current,
    current.stage === 'contracts'
      ? text('selectContract', { page: (current.page || 0) + 1, pages: Math.ceil((current.contracts?.length || 1) / PAGE_SIZE) })
      : current.stage === 'missing' ? text('missingDocument')
        : text('noContracts'), choicesFor(current), invalid);

  if (state && state.stage !== 'cpf') {
    const choices = choicesFor(state);
    // Stable row IDs win over display text and numbered fallback indexes.
    const choice = choices.find(c => c.id === answer)
      || choices.find(c => c.label.toLocaleLowerCase('pt-BR') === answer.toLocaleLowerCase('pt-BR'))
      || (/^[1-9]\d?$/.test(answer) ? choices[Number(answer) - 1] : undefined);
    if (choice?.id === 'other_cpf') return wait({ stage: 'cpf' }, text('requestDocument'));
    if (choice?.id === 'back') return result('cancelled', { status: 'cancelled' });
    if (choice?.id === 'new_customer') return result('new_customer', { status: 'new_customer', contractId: '', summary: 'Novo cliente, sem contrato selecionado.' });
    if (choice?.id === 'previous' || choice?.id === 'next') return show({ ...state, page: (state.page || 0) + (choice.id === 'next' ? 1 : -1) });
    if (choice?.id.startsWith('contract:')) {
      const contract = state.contracts?.find(c => `contract:${c.id}` === choice.id);
      if (contract) {
        const crmDocumentStatus = input.node.config.saveDocumentIfEmpty === false ? 'not-requested' : await saveSgpContactDocumentIfEmpty({
          workspaceId: input.workflow.workspaceId || '', chatId: input.execution.conversationId || '', document: state.cpfCnpj || '',
        });
        if (crmDocumentStatus === 'unavailable') return { ...fail(), error: { code: 'SGP_DOCUMENT_SAVE_FAILED', message: 'Não foi possível conferir ou salvar o documento do contato.', retryable: false } };
        return result('selected', {
        crmDocumentStatus,
        status: 'identified', cpfCnpj: state.cpfCnpj, contractId: contract.id, ...contract,
        summary: `Contrato ${contract.id} (${contract.statusLabel}) — ${contract.addressLabel} — ${contract.planDescription}`,
        });
      }
    }
    return show(state, true);
  }
  let identifier: string | undefined;
  if (state?.stage === 'cpf') {
    if (/^(back|voltar|voltar ao menu principal|cancelar)$/i.test(answer) || answer.toLocaleLowerCase('pt-BR') === text('backLabel').toLocaleLowerCase('pt-BR')) return result('cancelled', { status: 'cancelled' });
    if (allowNew && (/^(new_customer|ainda não sou cliente)$/i.test(answer) || answer.toLocaleLowerCase('pt-BR') === text('newCustomerLabel').toLocaleLowerCase('pt-BR'))) {
      return result('new_customer', { status: 'new_customer', contractId: '', summary: 'Novo cliente, sem contrato selecionado.' });
    }
    identifier = normalizeBrazilianDocument(answer);
    if (!isValidBrazilianDocument(identifier)) return wait({ stage: 'cpf' }, text('invalidDocument'));
  }
  if (!input.workflow.workspaceId || !input.execution.conversationId) return fail();
  const found = await lookupSgpCustomerContracts({ workspaceId: input.workflow.workspaceId, chatId: input.execution.conversationId, customerIdentifier: identifier });
  if (found.status === 'unavailable') return fail();
  if (found.status === 'invalid-identifier') return wait({ stage: 'cpf' }, text('invalidSavedDocument'));
  if (found.status === 'missing-identifier') return show({ stage: 'missing' });
  if (found.status === 'not-found' || found.contracts.length === 0) return show({ stage: 'not-found' });
  return show({ stage: 'contracts', cpfCnpj: found.cpfCnpj, contracts: found.contracts, page: 0 });
}
