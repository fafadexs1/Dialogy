import { CollectedFieldDefinitionSchema, ProcedureDocumentSchema } from './types';

export function studioFieldPreset(type: 'cpf_cnpj' | 'email' | 'phone' | 'name', id: string) {
  const preset = {
    cpf_cnpj: { name: 'CPF ou CNPJ', variableKey: 'customer_cpf', type: 'cpf_cnpj', promptMessage: 'Qual é o CPF ou CNPJ do titular?', isSensitive: true, reuseFrom: { sourceType: 'contact_property', sourceValue: 'custom_fields.sgp_document' } },
    email: { name: 'E-mail', variableKey: 'customer_email', type: 'email', promptMessage: 'Qual é seu e-mail?', reuseFrom: { sourceType: 'contact_property', sourceValue: 'email' } },
    phone: { name: 'Telefone', variableKey: 'customer_phone', type: 'phone', promptMessage: 'Qual é seu telefone de contato?', reuseFrom: { sourceType: 'contact_property', sourceValue: 'phone' } },
    name: { name: 'Nome', variableKey: 'customer_name', type: 'text', promptMessage: 'Qual é seu nome?', reuseFrom: { sourceType: 'contact_property', sourceValue: 'name' } },
  }[type];
  return CollectedFieldDefinitionSchema.parse({ id, ...preset });
}

export function createStudioSgpProcedure(id: string) {
  return ProcedureDocumentSchema.parse({ id, name: 'Consultar cliente no SGP', description: 'Identifica o titular e consulta contratos, conexão e faturas.',
    objective: 'Responder usando o retorno confirmado do SGP. Com vários contratos, pedir a instalação antes de consultar dados específicos. Não interpretar ausência de informação como conexão normal ou pagamento confirmado.',
    whenToUse: 'Consultar situação da conexão, plano, contrato, faturas, vencimentos ou pagamentos do cliente.', whenNotToUse: 'Alterar planos, reiniciar equipamentos ou realizar pagamentos.', updatedAt: new Date().toISOString(),
    steps: [
      { id: `${id}_cpf`, order: 1, type: 'collect_data', title: 'Identificar titular se necessário', collectField: studioFieldPreset('cpf_cnpj', `${id}_document`) },
      { id: `${id}_contracts`, order: 2, type: 'native_action', title: 'Consultar contratos SGP', nativeActionType: 'sgp_fetch_contracts', adaptiveAccess: { enabled: true, requiresSteps: [] }, nativeDataMappings: [{ apiField: 'customerIdentifier', sourceType: 'collected_field', sourceValue: 'customer_cpf' }] },
      { id: `${id}_select`, order: 3, type: 'collect_data', title: 'Selecionar instalação se necessário', collectField: { id: `${id}_contract`, name: 'Contrato', variableKey: 'customer_contract', type: 'single_select', promptMessage: 'Para qual instalação você precisa de atendimento?', optionsSourceKey: 'contracts', optionLabelPath: 'label', optionValuePath: 'id' } },
      { id: `${id}_panel`, order: 4, type: 'native_action', title: 'Consultar conexão e financeiro SGP', nativeActionType: 'sgp_fetch_contact_panel_data', adaptiveAccess: { enabled: true, requiresSteps: [`${id}_contracts`] }, nativeDataMappings: [{ apiField: 'customerIdentifier', sourceType: 'collected_field', sourceValue: 'customer_cpf' }, { apiField: 'contractId', sourceType: 'collected_field', sourceValue: 'customer_contract' }] },
      { id: `${id}_reply`, order: 5, type: 'respond', title: 'Responder com dados confirmados', messageText: 'Dados consultados no SGP:', messageDataKeys: ['customer_name', 'contracts', 'open_invoices', 'overdue_invoices', 'connection_status'] },
    ] });
}

/** Open scope is a published read capability; customer wording selects exact returned IDs. */
export function createStudioSgpMultiProcedure(id: string) {
  const procedure = createStudioSgpProcedure(id);
  procedure.name = 'SGP · Vários contratos e pedidos';
  procedure.objective = 'Consultar um, vários ou todos os contratos identificados pelo CPF. Tratar conexão, faturas e dúvidas em pedidos separados, preservando o contexto de cada instalação. Esclarecer quantidade ou destino ambíguos.';
  procedure.steps = procedure.steps.filter((step) => step.id !== `${id}_select`);
  const panel = procedure.steps.find((step) => step.id === `${id}_panel`)!;
  panel.title = 'Consultar contratos e selecionar faturas por pedido';
  panel.nativeActionPayload = { flexibleScope: true };
  panel.nativeDataMappings = [{ apiField: 'customerIdentifier', sourceType: 'collected_field', sourceValue: 'customer_cpf' }];
  const reply = procedure.steps.find((step) => step.type === 'respond')!;
  reply.messageDataKeys = ['contract_results', 'selected_invoices', 'query_complete'];
  procedure.steps.forEach((step, index) => { step.order = index + 1; });
  return procedure;
}
