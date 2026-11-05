import { ConnectorDefinitionSchema, type ConnectorDefinition } from './connector-contract';

type Template = { id: string; service: string; label: string; definition: ConnectorDefinition };
function readOperation(id: string, service: string, label: string, url: string, description: string, options: { query?: Record<string, unknown>; headers?: Record<string, string>; inputSchema?: Record<string, unknown> } = {}): Template {
  return { id, service, label, definition: ConnectorDefinitionSchema.parse({ name: `${service} · ${label}`, description,
    inputSchema: options.inputSchema || { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { type: 'object' }, approval: 'automatic',
    http: { method: 'GET', url, headers: options.headers || {}, query: options.query || {}, bodyType: 'none', credentialId: '', credentialRequired: true, responseFormat: 'json' } }) };
}
const stripeHeaders = { 'Stripe-Version': '2026-09-30.endive' };

/** Read-only financial operations; credentials are configured in the workspace vault. */
export const financialAppTemplates: Template[] = [
  readOperation('stripe_balance', 'Stripe', 'Consultar saldo', 'https://api.stripe.com/v1/balance', 'Consulta o saldo da conta autenticada. Use uma chave restrita com acesso somente de leitura.', { headers: stripeHeaders }),
  readOperation('stripe_charges', 'Stripe', 'Listar cobranças', 'https://api.stripe.com/v1/charges', 'Lista as cobranças recentes. Use uma chave restrita com acesso somente de leitura.', { headers: stripeHeaders, query: { limit: 100 } }),
  readOperation('asaas_balance_sandbox', 'Asaas', 'Consultar saldo · sandbox', 'https://api-sandbox.asaas.com/v3/finance/balance', 'Consulta saldo no sandbox Asaas. Configure credencial API key no cabeçalho access_token.'),
  readOperation('asaas_payments_sandbox', 'Asaas', 'Listar cobranças · sandbox', 'https://api-sandbox.asaas.com/v3/payments', 'Lista cobranças no sandbox Asaas. Configure credencial API key no cabeçalho access_token.', { query: { limit: 100, offset: 0 } }),
  readOperation('asaas_balance_live', 'Asaas', 'Consultar saldo · produção', 'https://api.asaas.com/v3/finance/balance', 'Consulta dados reais no Asaas. Use credencial de produção no cabeçalho access_token.'),
  readOperation('asaas_payments_live', 'Asaas', 'Listar cobranças · produção', 'https://api.asaas.com/v3/payments', 'Lista cobranças reais no Asaas. Use credencial de produção no cabeçalho access_token.', { query: { limit: 100, offset: 0 } }),
  readOperation('mercadopago_search', 'Mercado Pago', 'Buscar pagamentos', 'https://api.mercadopago.com/v1/payments/search', 'Consulta pagamentos pela referência externa usando token autorizado.', {
    inputSchema: { type: 'object', properties: { reference: { type: 'string', minLength: 1, maxLength: 200, description: 'Referência externa do pagamento' } }, required: ['reference'], additionalProperties: false },
    query: { external_reference: '{{arguments.reference}}', sort: 'date_created', criteria: 'desc', range: 'date_created' },
  }),
];
