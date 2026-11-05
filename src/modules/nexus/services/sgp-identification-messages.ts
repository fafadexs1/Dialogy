/** Copy overrides are optional; workflows without them retain their original dialogue. */
export const SGP_IDENTIFICATION_MESSAGES = {
  missingDocument: { label: 'Quando o contato não tem CPF/CNPJ', value: 'Informe o CPF ou CNPJ do titular para localizar seu cadastro.' },
  requestDocument: { label: 'Ao pedir outro CPF/CNPJ', value: 'Digite o CPF ou CNPJ do titular, com ou sem pontuação, ou digite voltar.' },
  invalidDocument: { label: 'CPF/CNPJ digitado inválido', value: 'CPF ou CNPJ inválido. Confira os números e os dígitos verificadores e informe novamente, ou digite voltar.' },
  invalidSavedDocument: { label: 'CPF/CNPJ cadastrado inválido', value: 'O CPF/CNPJ cadastrado não é válido. Informe o CPF ou CNPJ correto para este atendimento, ou digite voltar.' },
  noContracts: { label: 'Nenhum contrato encontrado', value: 'Não encontramos contratos para este CPF/CNPJ. Como deseja continuar?' },
  selectContract: { label: 'Seleção de contrato', value: 'Para qual contrato deseja atendimento? ({{page}}/{{pages}})' },
  invalidOption: { label: 'Opção não reconhecida', value: 'Opção inválida. Escolha uma das opções apresentadas.' },
  enterDocumentLabel: { label: 'Botão para informar CPF/CNPJ', value: 'Informar CPF/CNPJ' },
  otherDocumentLabel: { label: 'Botão para outro CPF/CNPJ', value: 'Outro CPF/CNPJ' },
  backLabel: { label: 'Botão de voltar', value: 'Voltar ao menu principal' },
  newCustomerLabel: { label: 'Botão de novo cliente', value: 'Ainda não sou cliente' },
  previousLabel: { label: 'Página anterior de contratos', value: 'Contratos anteriores' },
  nextLabel: { label: 'Próxima página de contratos', value: 'Mais contratos' },
} as const;

export type SgpIdentificationMessageKey = keyof typeof SGP_IDENTIFICATION_MESSAGES;

export function getSgpIdentificationMessage(config: Record<string, unknown>, key: SgpIdentificationMessageKey): string {
  const messages = config.messages && typeof config.messages === 'object' && !Array.isArray(config.messages) ? config.messages as Record<string, unknown> : {};
  const value = messages[key] ?? (key === 'invalidOption' ? config.invalidOptionMessage : undefined);
  return typeof value === 'string' && value.trim() ? value : SGP_IDENTIFICATION_MESSAGES[key].value;
}
