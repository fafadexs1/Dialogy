import { parseStudioSgpQuery, projectStudioSgpQuery } from './sgp-query';
import 'server-only';
import { lookupSgpCustomerContracts, runSgpWorkspaceTool } from '@/services/agent-tools/sgp-tools';
import { resolveStudioMapping, type StudioDataContext } from './data-mapping';
import { studioSgpPanelValues } from './sgp-data';
import type { ProcedureStep } from './types';
import { isValidCustomerIdentifier } from '@/services/autopilot/slots';
import { isValidStudioCnpj } from './collection';

export async function executeStudioSgp(input: { workspaceId: string; chatId: string; step: ProcedureStep; context: StudioDataContext; query?: unknown }): Promise<{ values: Record<string, unknown> }> {
  const { step, context } = input;
  const mapped = (name: string, fallback: string) => {
    const mapping = step.nativeDataMappings?.find((entry) => entry.apiField === name);
    return mapping ? resolveStudioMapping(mapping, context) : context.values[fallback] ?? context.input?.[fallback];
  };
  const document = mapped('customerIdentifier', 'customer_cpf');
  const query = input.query === undefined ? undefined : parseStudioSgpQuery(input.query);
  if (query && step.nativeActionPayload?.flexibleScope !== true) throw new Error('Esta publicação não permite consultas com escopo variável.');
  if (!query && step.nativeActionPayload?.flexibleScope === true) throw new Error('Defina os contratos e o pedido da consulta no atendimento adaptativo antes de executar.');
  const contract = query ? undefined : mapped('contractId', 'customer_contract');
  const customerIdentifier = document == null || document === '' ? undefined : String(document).replace(/[.\/\-\s]/g, '');
  const contractId = contract == null || contract === '' ? undefined : String(contract).trim();
  if (customerIdentifier && !/^\d{11}(?:\d{3})?$/.test(customerIdentifier)) throw new Error('Colete um CPF ou CNPJ válido antes de consultar o SGP.');
  if (customerIdentifier && !(customerIdentifier.length === 11 ? isValidCustomerIdentifier(customerIdentifier) : isValidStudioCnpj(customerIdentifier))) throw new Error('CPF ou CNPJ inválido. Confira o documento do titular.');
  if (contractId && !/^\d+$/.test(contractId)) throw new Error('Escolha um contrato válido retornado pelo SGP.');
  const target = { workspaceId: input.workspaceId, chatId: input.chatId, customerIdentifier };
  if (step.nativeActionType === 'sgp_fetch_contracts') {
    const result = await lookupSgpCustomerContracts(target);
    if (result.status === 'not-found') return { values: { contracts: [], contracts_count: 0, cpf_cnpj: customerIdentifier || null, contract_selection_required: false } };
    if (result.status !== 'found') throw new Error('Não foi possível consultar os contratos no SGP. Verifique o documento e a integração.');
    const contracts = result.contracts.map((entry) => ({ ...entry, id: String(entry.id), plan: entry.planDescription, address: entry.addressLabel, status: entry.statusLabel,
      label: `${entry.id} - ${entry.planDescription || 'Plano'}${entry.addressLabel ? ` - ${entry.addressLabel}` : ''}` }));
    const selected = contractId ? contracts.find((entry) => entry.id === contractId) : contracts.length === 1 ? contracts[0] : null;
    if (contractId && !selected) throw new Error('O contrato escolhido não pertence ao documento consultado.');
    return { values: { contracts, contracts_count: contracts.length, cpf_cnpj: result.cpfCnpj, contract_selection_required: contracts.length > 1 && !selected,
      customer_ip: selected?.ip || null, contract_ip: selected?.ip || null, customer_mac: selected?.mac || null, contract_mac: selected?.mac || null } };
  }
  const result = await runSgpWorkspaceTool(target, { type: 'sgp_fetch_contact_panel_data', payload: { contractId } });
  if (result.status !== 'success' || !result.output) throw new Error(result.error || 'Falha ao consultar painel SGP.');
  const values = studioSgpPanelValues(result.output, contractId);
  if (!query) return { values };
  return { values: projectStudioSgpQuery(result.output, query) };
}
