import { describe, expect, it } from 'vitest';

import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { fingerprintAuditedToolOperation } from '@/services/agent-tools/action-fingerprint';
import type { AgentToolExecutionResult } from '@/services/agent-tools/types';
import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import {
  buildAutopilotTurnPlan,
  buildAutopilotTurnPlanCustomerResponse,
  buildAutopilotTurnPlanFollowUpActions,
  buildAutopilotTurnPlanRecoveryActions,
  hasRequiredAutopilotTurnPlanFailure,
  hasSatisfiedAutopilotTurnPlan,
  inferAutopilotCustomerNeed,
  isTerminalAutopilotTurnPlan,
  isExplicitAutopilotToolRetryRequest,
  shouldBypassKnowledgeForOperationalTurn,
  shouldPrioritizeAutopilotTurnPlan,
} from '@/services/autopilot/turn-plan';
import type { SlotExtractionResult } from '@/services/autopilot/slots';

function tool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown> | null = null,
  overrides: Partial<AgentToolCatalogItem> = {},
): AgentToolCatalogItem {
  return {
    name: name as AgentToolCatalogItem['name'],
    version: name.startsWith('mcp:') ? 'mcp' : 'builtin',
    description,
    class: 'retrieval',
    riskLevel: 'low',
    sideEffect: 'none',
    idempotent: true,
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: ['support_request', 'troubleshooting'],
    requiredSlots: [],
    fallbackAction: 'handoff',
    source: name.startsWith('mcp:') ? 'mcp' : 'dialogy',
    enabledByDefault: false,
    serverId: name.startsWith('mcp:') ? 'router' : undefined,
    serverName: name.startsWith('mcp:') ? 'Router MCP' : undefined,
    inputSchema,
    ...overrides,
  };
}

const catalog = [
  tool('sgp_fetch_contact_panel_data', 'Consulta cadastro, contratos, status e IP do cliente no SGP.'),
  tool(
    'mcp:ecommerce:get_order_status',
    'Consulta status, rastreio e previsao de entrega de um pedido pelo numero do pedido.',
    { type: 'object', properties: { order_id: { type: 'string' } } },
  ),
  tool(
    'mcp:router:get_wifi_view',
    'Consulta SSID, usuario e senha atuais do Wi-Fi do contrato validado.',
    { type: 'object', properties: { client_ip: { type: 'string' } } },
  ),
  tool(
    'mcp:commerce:list_products',
    'Lista catalogo de produtos, planos, precos, estoque e disponibilidade.',
    { type: 'object', properties: { query: { type: 'string' } } },
  ),
  tool(
    'mcp:clinic:get_available_slots',
    'Consulta agenda, horarios disponiveis e vagas para visitas por data.',
    { type: 'object', required: ['date'], properties: { date: { type: 'string' }, time: { type: 'string' } } },
  ),
  tool(
    'mcp:clinic:book_appointment',
    'Agenda e confirma uma consulta para a data e horario solicitados.',
    { type: 'object', required: ['date', 'time'], properties: { date: { type: 'string' }, time: { type: 'string' } } },
    { class: 'write_non_idempotent', riskLevel: 'medium', sideEffect: 'medium', idempotent: false, allowedIntents: ['scheduling_request'] },
  ),
  tool(
    'mcp:logistics:schedule_pickup',
    'Agenda uma coleta logistica usando o codigo do pacote e a janela de coleta.',
    {
      type: 'object',
      required: ['package_code', 'pickup_window'],
      properties: {
        package_code: { type: 'string', description: 'codigo da embalagem ou pacote' },
        pickup_window: { type: 'string', description: 'janela desejada para a coleta' },
      },
    },
    { class: 'write_non_idempotent', riskLevel: 'medium', sideEffect: 'medium', idempotent: false, allowedIntents: ['scheduling_request'] },
  ),
  tool(
    'mcp:commerce:cancel_order',
    'Cancela definitivamente um pedido pelo numero informado.',
    { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } } },
    { class: 'write_non_idempotent', riskLevel: 'high', sideEffect: 'high', idempotent: false, allowedIntents: ['cancellation_request'] },
  ),
  tool(
    'mcp:commerce:refund_order',
    'Estorna, cancela ou reembolsa um pedido do cliente.',
    { type: 'object', properties: { order_id: { type: 'string' } } },
    { class: 'write_non_idempotent', riskLevel: 'high', sideEffect: 'high', requiresHumanApproval: true },
  ),
  tool('mcp:router:reboot_router', 'Reinicia o roteador do cliente.'),
  tool(
    'mcp:router:change_wifi_credentials',
    'Troca nome SSID e/ou senha das redes Wi-Fi da ONT.',
    {
      type: 'object',
      required: ['client_ip'],
      properties: {
        client_ip: { type: 'string', description: 'IP da ONT no ACS.' },
        device_id: { type: 'string', description: 'Serial opcional da ONT.' },
        username: { type: 'string', description: 'Usuario administrativo da interface web.' },
        password: { type: 'string', description: 'Senha administrativa da interface web.' },
        ssid_24: { type: 'string', description: 'Novo SSID para a rede 2.4 GHz.' },
        ssid_5g: { type: 'string', description: 'Novo SSID para a rede 5 GHz.' },
        password_24: { type: 'string', description: 'Nova senha para a rede 2.4 GHz.' },
        password_5g: { type: 'string', description: 'Nova senha para a rede 5 GHz.' },
      },
    },
    {
      class: 'write_non_idempotent',
      riskLevel: 'high',
      sideEffect: 'high',
      idempotent: false,
      requiresHumanApproval: true,
    },
  ),
] satisfies AgentToolCatalogItem[];

function slots(overrides: Partial<SlotExtractionResult['slots']> = {}): SlotExtractionResult {
  return {
    slots: overrides,
    details: [],
    invalidSlots: [],
  };
}

function sgpResult(contracts: any[]): AgentToolExecutionResult {
  return {
    toolName: 'sgp_fetch_contact_panel_data',
    status: 'success',
    input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
    output: {
      customerName: 'Cliente Teste',
      cpfCnpj: '52998224725',
      contracts,
    },
  };
}

function sgpResultForCpf(cpfCnpj: string, contracts: any[]): AgentToolExecutionResult {
  return {
    ...sgpResult(contracts),
    output: {
      customerName: 'Cliente Teste',
      cpfCnpj,
      contracts,
    },
  };
}

function failedToolResult(
  toolName: string,
  argumentsValue: Record<string, unknown> = {},
): AgentToolExecutionResult {
  return {
    toolName: toolName as AgentToolExecutionResult['toolName'],
    status: 'error',
    input: {
      type: toolName === 'sgp_fetch_contact_panel_data' ? toolName : 'mcp_call_tool',
      payload: toolName.startsWith('mcp:') ? { toolName, arguments: argumentsValue } : {},
    } as any,
    error: 'timeout',
  };
}

describe('autopilot turn plan', () => {
  it('detects Wi-Fi credential lookup need', () => {
    expect(inferAutopilotCustomerNeed('esqueci usuario e senha do wifi')).toBe('wifi_credentials_lookup');
    expect(inferAutopilotCustomerNeed('quero trocar a senha do wifi')).toBe('wifi_credentials_change');
    expect(inferAutopilotCustomerNeed('minha internet esta lenta, veja canal e redes ao redor')).toBe('wifi_channel_diagnostics');
  });

  it('keeps the previous Wi-Fi need when the next customer message is only a CPF', () => {
    expect(inferAutopilotCustomerNeed(
      '529.982.247-25',
      [
        'Cliente: esqueci usuario e senha do wifi',
        'Atendente: Para consultar com seguranca, me informe o CPF/CNPJ.',
      ].join('\n'),
    )).toBe('wifi_credentials_lookup');
  });

  it.each(['Oi', 'Fala ai galera'])('does not inherit an old operational need for an isolated greeting: %s', (greeting) => {
    const history = [
      'Cliente: qual o status do pedido ABCD-1234?',
      'Atendente: Atendimento transferido para TicketMaster.',
      'Atendente: Consultei os dados operacionais do cadastro. Contratos encontrados: 20.',
    ].join('\n');

    expect(inferAutopilotCustomerNeed(greeting, history)).toBe('none');

    const plan = buildAutopilotTurnPlan({
      customerMessage: greeting,
      chatHistory: history,
      intentResolution: resolveAutopilotIntent({ customerMessage: greeting }),
      slotExtraction: slots(),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'transfer_chat', 'add_internal_note'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('none');
    expect(plan.expectedNextAction).toBe('continue_llm');
    expect(plan.responseOverride).toBeNull();
    expect(plan.preResponseActions).toEqual([]);
  });

  it('delegates an explicit conversation close to close_chat instead of planning cancellation or SGP tools', () => {
    const customerMessage = 'Pode encerrar? USE close_chat';
    const plan = buildAutopilotTurnPlan({
      customerMessage,
      chatHistory: [
        'Cliente: Quero cancelar o pedido AB1234',
        'Atendente: Consultei os dados operacionais do cadastro.',
      ].join('\n'),
      intentResolution: {
        ...resolveAutopilotIntent({ customerMessage }),
        intent: 'cancellation_request',
      },
      slotExtraction: slots({ order_or_request_id: 'AB1234' }),
      enabledToolNames: [
        'close_chat',
        'sgp_fetch_contact_panel_data',
        'mcp:commerce:cancel_order',
      ],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('none');
    expect(plan.expectedNextAction).toBe('continue_llm');
    expect(plan.requiredToolNames).toEqual([]);
    expect(plan.preResponseActions).toEqual([]);
    expect(plan.responseOverride).toBeNull();
    expect(plan.reasons).toContain('explicit_conversation_close_delegated_to_workflow');
  });

  it('asks for CPF/CNPJ before exposing Wi-Fi credentials', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'esqueci usuario e senha do wifi',
      slotExtraction: slots(),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view', 'mcp:router:reboot_router'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('wifi_credentials_lookup');
    expect(plan.expectedNextAction).toBe('ask_slot');
    expect(plan.missingSlots).toEqual(['customer_identifier']);
    expect(plan.responseOverride).toContain('CPF/CNPJ');
    expect(plan.preResponseActions).toHaveLength(0);
    expect(plan.forbiddenToolNames).toContain('mcp:router:reboot_router');
  });

  it('forces SGP validation before get_wifi_view when CPF is known', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: '529.982.247-25',
      chatHistory: [
        'Cliente: esqueci usuario e senha do wifi',
        'Atendente: Para consultar com seguranca, me informe o CPF/CNPJ.',
      ].join('\n'),
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view', 'mcp:router:reboot_router'],
      toolCatalog: catalog,
    });

    expect(plan.expectedNextAction).toBe('call_required_tool');
    expect(plan.requiredToolNames).toEqual(['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view']);
    expect(plan.preResponseActions).toMatchObject([
      { type: 'sgp_fetch_contact_panel_data' },
    ]);
    expect(plan.preResponseActions.map((action) => action.type)).not.toContain('mcp_call_tool');
  });

  it('asks for CPF/CNPJ before operational billing lookups', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'preciso da segunda via do boleto',
      slotExtraction: slots(),
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('external_lookup');
    expect(plan.expectedNextAction).toBe('ask_slot');
    expect(plan.requiredToolNames).toContain('sgp_fetch_contact_panel_data');
    expect(plan.responseOverride).toContain('CPF/CNPJ');
    expect(plan.preResponseActions).toHaveLength(0);
  });

  it('forces SGP validation for operational lookups when CPF is known', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: '529.982.247-25',
      chatHistory: [
        'Cliente: preciso da segunda via do boleto',
        'Atendente: Para consultar com seguranca, me informe o CPF/CNPJ.',
      ].join('\n'),
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('external_lookup');
    expect(plan.expectedNextAction).toBe('call_required_tool');
    expect(plan.preResponseActions).toMatchObject([
      { type: 'sgp_fetch_contact_panel_data' },
    ]);
  });

  it('summarizes operational SGP lookup results without inventing data', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: '529.982.247-25',
      chatHistory: [
        'Cliente: preciso da segunda via do boleto',
        'Atendente: Para consultar com seguranca, me informe o CPF/CNPJ.',
      ].join('\n'),
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      toolCatalog: catalog,
      recentToolResults: [sgpResultForCpf('52998224725', [{ id: '123', connectionStatus: 'online' }])],
    });
    const response = buildAutopilotTurnPlanCustomerResponse({
      turnPlan: plan,
      toolResults: [
        {
          ...sgpResultForCpf('52998224725', [{ id: '123', connectionStatus: 'online' }]),
          output: {
            customerName: 'Cliente Teste',
            cpfCnpj: '52998224725',
            contracts: [{ id: '123', connectionStatus: 'online', planDescription: 'Fibra 600 Mega' }],
            invoices: [{ id: 'fat-1', dueDate: '2026-06-30', amountFormatted: 'R$ 99,90', isPaid: false }],
          },
        },
      ],
    });

    expect(response).toContain('Cliente: Cliente Teste');
    expect(response).toContain('contrato 123');
    expect(response).toContain('Faturas em aberto: 1');
    expect(response).toContain('R$ 99,90');
  });

  it('never serializes nested SGP invoice summaries as object Object', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: '529.982.247-25',
      chatHistory: [
        'Cliente: preciso consultar meus contratos',
        'Atendente: Para consultar com seguranca, me informe o CPF/CNPJ.',
      ].join('\n'),
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      toolCatalog: catalog,
      recentToolResults: [sgpResultForCpf('52998224725', [{ id: '123', connectionStatus: 'online' }])],
    });
    const response = buildAutopilotTurnPlanCustomerResponse({
      turnPlan: plan,
      toolResults: [{
        ...sgpResultForCpf('52998224725', [{ id: '123', connectionStatus: 'online' }]),
        output: {
          customerName: 'Cliente Teste',
          cpfCnpj: '52998224725',
          contracts: [{ id: '123', connectionStatus: 'online' }],
          invoiceGroups: [{ summary: { openInvoices: 2, total: 199.8 } }],
        },
      }],
    });

    expect(response).not.toContain('[object Object]');
  });

  it('asks for order/protocol number before a generic MCP order status lookup', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'qual o status do meu pedido?',
      slotExtraction: slots(),
      enabledToolNames: ['mcp:ecommerce:get_order_status'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('order_status_lookup');
    expect(plan.expectedNextAction).toBe('ask_slot');
    expect(plan.missingSlots).toEqual(['order_or_request_id']);
    expect(plan.responseOverride).toContain('numero do pedido');
    expect(plan.preResponseActions).toHaveLength(0);
  });

  it('calls the qualified MCP order status tool when the order id is known', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'pedido AB1234',
      chatHistory: [
        'Cliente: qual o status do meu pedido?',
        'Atendente: Para consultar o status, me informe o numero do pedido.',
      ].join('\n'),
      slotExtraction: slots({ order_or_request_id: 'AB1234' }),
      enabledToolNames: ['mcp:ecommerce:get_order_status'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('order_status_lookup');
    expect(plan.expectedNextAction).toBe('call_required_tool');
    expect(plan.requiredToolNames).toContain('mcp:ecommerce:get_order_status');
    expect(plan.preResponseActions).toMatchObject([
      {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:ecommerce:get_order_status',
          arguments: { order_id: 'AB1234' },
        },
      },
    ]);
  });

  it('does not reuse a successful MCP result from a different order id', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'Qual o status do pedido RACE-9001?',
      slotExtraction: slots({ order_or_request_id: 'RACE-9001' }),
      enabledToolNames: ['mcp:ecommerce:get_order_status'],
      toolCatalog: catalog,
      recentToolResults: [{
        toolName: 'mcp:ecommerce:get_order_status',
        status: 'success',
        input: {
          type: 'mcp_call_tool',
          payload: {
            toolName: 'mcp:ecommerce:get_order_status',
            arguments: { order_id: 'AB1234' },
          },
        },
        output: { structuredContent: { order_id: 'AB1234', status: 'entregue' } },
      }],
    });

    expect(plan.expectedNextAction).toBe('call_required_tool');
    expect(plan.preResponseActions).toMatchObject([{
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:ecommerce:get_order_status',
        arguments: { order_id: 'RACE-9001' },
      },
    }]);
  });

  it('summarizes generic MCP order status results', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'pedido AB1234',
      chatHistory: [
        'Cliente: qual o status do meu pedido?',
        'Atendente: Para consultar o status, me informe o numero do pedido.',
      ].join('\n'),
      slotExtraction: slots({ order_or_request_id: 'AB1234' }),
      enabledToolNames: ['mcp:ecommerce:get_order_status'],
      toolCatalog: catalog,
    });
    const response = buildAutopilotTurnPlanCustomerResponse({
      turnPlan: plan,
      toolResults: [
        {
          toolName: 'mcp:ecommerce:get_order_status',
          status: 'success',
          input: {
            type: 'mcp_call_tool',
            payload: { toolName: 'mcp:ecommerce:get_order_status', arguments: { order_id: 'AB1234' } },
          },
          output: {
            structuredContent: {
              order_id: 'AB1234',
              status: 'Saiu para entrega',
              tracking_code: 'BR123456789',
              delivery_estimate: '2026-06-21',
            },
          },
        },
      ],
    });

    expect(response).toContain('Pedido/protocolo: AB1234');
    expect(response).toContain('Status: Saiu para entrega');
    expect(response).toContain('Rastreamento: BR123456789');
  });

  it('calls the qualified read-only MCP catalog tool for product and price lookups', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'quais produtos tem com preco e disponibilidade?',
      slotExtraction: slots(),
      enabledToolNames: ['mcp:commerce:list_products', 'mcp:commerce:refund_order'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('generic_external_lookup');
    expect(plan.expectedNextAction).toBe('call_required_tool');
    expect(plan.requiredToolNames).toContain('mcp:commerce:list_products');
    expect(plan.forbiddenToolNames).toContain('mcp:commerce:refund_order');
    expect(plan.preResponseActions).toMatchObject([
      {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:commerce:list_products',
          arguments: { query: 'quais produtos tem com preco e disponibilidade?' },
        },
      },
    ]);
  });

  it('keeps a commercial plan preference in the LLM path and never substitutes an SGP lookup', () => {
    const customerMessage = 'Esse de 1000 parece ser perfeito pra mim';
    const chatHistory = [
      'Atendente: Conheca os planos de 500, 600, 800 e 1000 mega.',
      'Cliente: Esse de 1000 parece ser perfeito pra mim',
      'Atendente: Consultei os dados operacionais. Contratos encontrados: 20.',
    ].join('\n');
    const plan = buildAutopilotTurnPlan({
      customerMessage,
      chatHistory,
      intentResolution: resolveAutopilotIntent({ customerMessage, chatHistory }),
      slotExtraction: slots({ product_or_service_preference: '1000 mega' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('generic_external_lookup');
    expect(plan.expectedNextAction).toBe('continue_llm');
    expect(plan.requiredToolNames).toEqual([]);
    expect(plan.preResponseActions).toEqual([]);
    expect(plan.responseOverride).toBeNull();
    expect(plan.metadata.selectedGenericExternalLookupTool).toBeNull();
  });

  it('asks for required slots declared by a generic MCP schema before scheduling lookups', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'quero consultar horarios disponiveis para uma visita',
      slotExtraction: slots(),
      enabledToolNames: ['mcp:clinic:get_available_slots'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('generic_external_lookup');
    expect(plan.expectedNextAction).toBe('ask_slot');
    expect(plan.missingSlots).toEqual(['date']);
    expect(plan.responseOverride).toContain('data');
    expect(plan.preResponseActions).toHaveLength(0);
  });

  it('calls a qualified scheduling MCP tool when required slots are known', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: '2026-06-22 as 14h',
      chatHistory: [
        'Cliente: quero consultar horarios disponiveis para uma visita',
        'Atendente: Para consultar corretamente, me informe data.',
      ].join('\n'),
      slotExtraction: slots({ date: '2026-06-22', time: '14:00' }),
      enabledToolNames: ['mcp:clinic:get_available_slots'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('generic_external_lookup');
    expect(plan.expectedNextAction).toBe('call_required_tool');
    expect(plan.preResponseActions).toMatchObject([
      {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:clinic:get_available_slots',
          arguments: { date: '2026-06-22', time: '14:00' },
        },
      },
    ]);
  });

  it('summarizes generic MCP lookup results without exposing raw JSON', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'quais produtos tem com preco e disponibilidade?',
      slotExtraction: slots(),
      enabledToolNames: ['mcp:commerce:list_products'],
      toolCatalog: catalog,
    });
    const response = buildAutopilotTurnPlanCustomerResponse({
      turnPlan: plan,
      toolResults: [
        {
          toolName: 'mcp:commerce:list_products',
          status: 'success',
          input: {
            type: 'mcp_call_tool',
            payload: { toolName: 'mcp:commerce:list_products', arguments: { query: 'produtos' } },
          },
          output: {
            structuredContent: {
              products: [
                { name: 'Plano Pro', price: 'R$ 99,90', availability: 'disponivel' },
                { name: 'Plano Ultra', price: 'R$ 149,90', availability: 'sob consulta' },
              ],
            },
          },
        },
      ],
    });

    expect(response).toContain('Consultei as informacoes solicitadas.');
    expect(response).toContain('Plano Pro');
    expect(response).toContain('R$ 99,90');
    expect(response).not.toContain('structuredContent');
  });

  it('stages a qualified scheduling action with exact schema arguments for confirmation', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'quero agendar a consulta em 2026-07-02 as 14h',
      intentResolution: {
        intent: 'scheduling_request',
        confidence: 0.98,
        reason: 'test',
        requiredSlots: ['date', 'time'],
        extractedSlots: { date: '2026-07-02', time: '14:00' },
        workflowId: 'scheduling',
        shouldUseLlm: true,
        shouldRetrieveKnowledge: false,
        shouldUseTool: true,
        shouldTransfer: false,
        knowledgeCategories: ['scheduling'],
      },
      slotExtraction: slots({ date: '2026-07-02', time: '14:00' }),
      enabledToolNames: ['mcp:clinic:get_available_slots', 'mcp:clinic:book_appointment'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('generic_external_action');
    expect(plan.expectedNextAction).toBe('require_confirmation');
    expect(plan.requiredToolNames).toEqual(['mcp:clinic:book_appointment']);
    expect(plan.preResponseActions).toMatchObject([{
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:clinic:book_appointment',
        arguments: { date: '2026-07-02', time: '14:00' },
      },
    }]);
    expect(plan.forbiddenToolNames).not.toContain('mcp:clinic:book_appointment');
  });

  it('does not execute a generic action until all required schema slots exist', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'quero agendar uma consulta',
      slotExtraction: slots(),
      enabledToolNames: ['mcp:clinic:book_appointment'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('generic_external_action');
    expect(plan.expectedNextAction).toBe('ask_slot');
    expect(plan.missingSlots).toEqual(['date', 'time']);
    expect(plan.preResponseActions).toEqual([]);
  });

  it('selects cancellation instead of a read-only status tool and binds the order id', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'por favor cancele o pedido AB1234',
      slotExtraction: slots({ order_or_request_id: 'AB1234' }),
      enabledToolNames: ['mcp:ecommerce:get_order_status', 'mcp:commerce:cancel_order'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('generic_external_action');
    expect(plan.requiredToolNames).toEqual(['mcp:commerce:cancel_order']);
    expect(plan.preResponseActions).toMatchObject([{
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:commerce:cancel_order',
        arguments: { order_id: 'AB1234' },
      },
    }]);
  });

  it('does not treat a different destructive payload as already completed', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'por favor cancele o pedido CD5678',
      slotExtraction: slots({ order_or_request_id: 'CD5678' }),
      enabledToolNames: ['mcp:commerce:cancel_order'],
      toolCatalog: catalog,
      recentToolResults: [{
        toolName: 'mcp:commerce:cancel_order',
        status: 'success',
        input: {
          type: 'mcp_call_tool',
          payload: {
            toolName: 'mcp:commerce:cancel_order',
            arguments: { order_id: 'AB1234' },
          },
        },
        output: { status: 'cancelled' },
      }],
    });

    expect(plan.expectedNextAction).toBe('require_confirmation');
    expect(plan.preResponseActions).toMatchObject([{
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:commerce:cancel_order',
        arguments: { order_id: 'CD5678' },
      },
    }]);
  });

  it('turns a confirmation rejection into a customer-facing prompt without exposing secrets', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'quero agendar a consulta em 2026-07-02 as 14h',
      slotExtraction: slots({ date: '2026-07-02', time: '14:00' }),
      enabledToolNames: ['mcp:clinic:book_appointment'],
      toolCatalog: catalog,
    });
    const action = plan.preResponseActions[0];
    const response = buildAutopilotTurnPlanCustomerResponse({
      turnPlan: plan,
      toolResults: [{
        toolName: 'mcp_call_tool',
        status: 'rejected',
        input: action,
        error: '[tool_policy:confirmation_required] Confirmacao necessaria.',
      }],
    });

    expect(response).toContain('confirmacao explicita');
    expect(response).toContain('2026-07-02');
    expect(response).not.toContain('mcp:clinic:book_appointment');
  });

  it('collects arbitrary required MCP schema fields instead of calling a tool with missing arguments', () => {
    const firstPlan = buildAutopilotTurnPlan({
      customerMessage: 'quero agendar uma coleta logistica',
      slotExtraction: slots(),
      enabledToolNames: ['mcp:logistics:schedule_pickup'],
      toolCatalog: catalog,
    });

    expect(firstPlan.customerNeed).toBe('generic_external_action');
    expect(firstPlan.expectedNextAction).toBe('ask_slot');
    expect(firstPlan.missingSlots).toEqual([]);
    expect(firstPlan.missingInputFields).toEqual([
      { name: 'package_code', label: 'codigo da embalagem ou pacote' },
      { name: 'pickup_window', label: 'janela desejada para a coleta' },
    ]);
    expect(firstPlan.responseOverride).toContain('package_code');
    expect(firstPlan.responseOverride).toContain('campo: valor');
    expect(firstPlan.preResponseActions).toEqual([]);

    const secondPlan = buildAutopilotTurnPlan({
      customerMessage: 'package_code: CX-77; pickup_window: 14h as 18h',
      chatHistory: [
        'Cliente: quero agendar uma coleta logistica',
        `Atendente: ${firstPlan.responseOverride}`,
      ].join('\n'),
      slotExtraction: slots(),
      enabledToolNames: ['mcp:logistics:schedule_pickup'],
      toolCatalog: catalog,
    });

    expect(secondPlan.customerNeed).toBe('generic_external_action');
    expect(secondPlan.expectedNextAction).toBe('require_confirmation');
    expect(secondPlan.missingInputFields).toEqual([]);
    expect(secondPlan.preResponseActions).toMatchObject([{
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:logistics:schedule_pickup',
        arguments: {
          package_code: 'CX-77',
          pickup_window: '14h as 18h',
        },
      },
    }]);
  });

  it('does not repeat a generic qualified MCP lookup after a recent failure', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'e ai?',
      chatHistory: [
        'Cliente: quais produtos tem com preco e disponibilidade?',
        'Atendente: Nao consegui concluir a consulta tecnica automaticamente agora.',
      ].join('\n'),
      slotExtraction: slots(),
      enabledToolNames: ['mcp:commerce:list_products'],
      toolCatalog: catalog,
      recentToolResults: [failedToolResult('mcp:commerce:list_products', { query: 'e ai?' })],
    });

    expect(plan.customerNeed).toBe('generic_external_lookup');
    expect(plan.expectedNextAction).toBe('continue_llm');
    expect(plan.preResponseActions).toHaveLength(0);
    expect(plan.responseOverride).toContain('verificar manualmente');
    expect(plan.reasons).toContain('generic_external_lookup_recent_mcp_failure');
  });

  it('builds a qualified MCP follow-up from SGP IP without using generic mcp_call_tool as the planned name', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'me fala a senha do wifi CPF 529.982.247-25',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
    });

    const actions = buildAutopilotTurnPlanFollowUpActions({
      turnPlan: plan,
      customerMessage: 'me fala a senha do wifi CPF 529.982.247-25',
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
      toolResults: [sgpResult([{ id: '123', ip: '10.55.81.19', connectionStatus: 'online' }])],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:router:get_wifi_view',
        arguments: { client_ip: '10.55.81.19' },
      },
    });
  });

  it('passes SGP login and MAC as router aliases when the management IP differs', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'me fala a senha do wifi CPF 529.982.247-25',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
    });

    const actions = buildAutopilotTurnPlanFollowUpActions({
      turnPlan: plan,
      customerMessage: 'me fala a senha do wifi CPF 529.982.247-25',
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
      toolResults: [sgpResult([{
        id: '123',
        ip: '10.55.81.19',
        login: 'cliente.pppoe',
        mac: 'AA:BB:CC:DD:EE:FF',
        connectionStatus: 'online',
      }])],
    });

    expect(actions[0]).toMatchObject({
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:router:get_wifi_view',
        arguments: {
          client_ip: '10.55.81.19',
          client_login: 'cliente.pppoe',
          client_mac: 'AA:BB:CC:DD:EE:FF',
        },
      },
    });
  });

  it('does not reuse SGP memory from another customer identifier', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'me fala a senha do wifi CPF 529.982.247-25',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
      recentToolResults: [
        sgpResultForCpf('00000000000', [{ id: '999', ip: '10.0.0.9', connectionStatus: 'online' }]),
      ],
    });

    expect(plan.expectedNextAction).toBe('call_required_tool');
    expect(plan.preResponseActions).toMatchObject([
      {
        type: 'sgp_fetch_contact_panel_data',
        payload: { customerIdentifier: '52998224725' },
      },
    ]);
  });

  it('correlates a freshly validated SGP result by its requested identifier when the provider masks the output document', () => {
    const result = sgpResultForCpf('***.***.***-**', [
      { id: '123', ip: '10.55.81.19', connectionStatus: 'online' },
    ]);
    result.input = {
      type: 'sgp_fetch_contact_panel_data',
      payload: { customerIdentifier: '52998224725' },
    };

    const plan = buildAutopilotTurnPlan({
      customerMessage: 'me fala a senha do wifi CPF 529.982.247-25 contrato 999',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
      recentToolResults: [result],
    });

    expect(plan.reasons).toContain('requested_contract_not_owned_by_validated_customer');
    expect(isTerminalAutopilotTurnPlan(plan)).toBe(true);
    expect(plan.preResponseActions).toEqual([]);
  });

  it('reuses a redacted SGP result through its privacy-safe operation fingerprint', () => {
    const result = sgpResultForCpf('[cpf-redacted]', [
      { id: '123', ip: '10.55.81.19', connectionStatus: 'online' },
    ]);
    result.input = {
      type: 'sgp_fetch_contact_panel_data',
      payload: { customerIdentifier: '[redacted]' },
      operationFingerprint: fingerprintAuditedToolOperation({
        type: 'sgp_fetch_contact_panel_data',
        payload: { customerIdentifier: '52998224725' },
      }),
    } as any;

    const plan = buildAutopilotTurnPlan({
      customerMessage: 'Nova senha: SenhaTemporariaSegura42!',
      chatHistory: [
        'Cliente: quero trocar a senha do wifi CPF 529.982.247-25 contrato 123',
        'Atendente: Validei o contrato. Informe apenas a nova senha.',
      ].join('\n'),
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:change_wifi_credentials'],
      toolCatalog: catalog,
      recentToolResults: [result],
    });

    expect(plan.expectedNextAction).toBe('require_confirmation');
    expect(plan.preResponseActions).toEqual([]);
    expect(plan.reasons).not.toContain('wifi_credentials_change_requires_sgp_validation');
    expect(plan.metadata.recentSgpMemoryMatchesCustomer).toBe(true);
  });

  it('responds with Wi-Fi fields returned by MCP after validation', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'me fala a senha do wifi CPF 529.982.247-25',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
      recentToolResults: [sgpResult([{ id: '123', ip: '10.55.81.19', connectionStatus: 'online' }])],
    });
    const response = buildAutopilotTurnPlanCustomerResponse({
      turnPlan: plan,
      toolResults: [
        sgpResult([{ id: '123', ip: '10.55.81.19', connectionStatus: 'online' }]),
        {
          toolName: 'mcp:router:get_wifi_view',
          status: 'success',
          input: {
            type: 'mcp_call_tool',
            payload: { toolName: 'mcp:router:get_wifi_view', arguments: { client_ip: '10.55.81.19' } },
          },
          output: {
            structuredContent: {
              ssid: 'Casa Teste',
              username: 'cliente123',
              password: 'senha-segura',
            },
          },
        },
      ],
    });

    expect(response).toContain('Rede/SSID: Casa Teste');
    expect(response).toContain('Usuario: cliente123');
    expect(response).toContain('Senha: senha-segura');
  });

  it('parses structured Wi-Fi JSON carried in legacy MCP text content', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'me fala a senha do wifi CPF 529.982.247-25',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
    });
    const response = buildAutopilotTurnPlanCustomerResponse({
      turnPlan: plan,
      toolResults: [{
        toolName: 'mcp:router:get_wifi_view',
        status: 'success',
        input: {
          type: 'mcp_call_tool',
          payload: {
            toolName: 'mcp:router:get_wifi_view',
            arguments: { client_ip: '10.55.81.19' },
          },
        },
        output: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              networks: [{ ssid: 'Casa Texto', password: 'senha-texto' }],
            }),
          }],
          structuredContent: null,
        },
      }],
    });

    expect(response).toContain('Rede/SSID: Casa Texto');
    expect(response).toContain('Senha: senha-texto');
  });

  it('does not call Wi-Fi MCP when SGP has no IPv4', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'me fala a senha do wifi CPF 529.982.247-25',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
      recentToolResults: [sgpResult([{ id: '123', connectionStatus: 'online' }])],
    });

    expect(plan.expectedNextAction).toBe('continue_llm');
    expect(plan.preResponseActions).toHaveLength(0);
    expect(plan.responseOverride).toContain('IPv4');
  });

  it('never falls back to another contract when the requested contract is not owned by the validated customer', () => {
    const recentToolResults = [
      sgpResult([{ id: '123', ip: '10.55.81.19', connectionStatus: 'online' }]),
    ];
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'me fala a senha do wifi CPF 529.982.247-25 contrato 999',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
      recentToolResults,
    });

    expect(plan.expectedNextAction).toBe('continue_llm');
    expect(plan.preResponseActions).toHaveLength(0);
    expect(plan.responseOverride).toContain('nao foi encontrado');
    expect(plan.reasons).toContain('requested_contract_not_owned_by_validated_customer');
    expect(isTerminalAutopilotTurnPlan(plan)).toBe(true);
    expect(buildAutopilotTurnPlanFollowUpActions({
      turnPlan: plan,
      customerMessage: 'me fala a senha do wifi CPF 529.982.247-25 contrato 999',
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
      toolResults: recentToolResults,
    })).toHaveLength(0);
  });

  it('asks for customer identity before rebooting a router', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'reinicia meu roteador agora',
      slotExtraction: slots(),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:reboot_router', 'mcp:router:change_wifi_credentials'],
      toolCatalog: catalog,
    });

    expect(plan.customerNeed).toBe('router_reboot');
    expect(plan.expectedNextAction).toBe('ask_slot');
    expect(plan.missingSlots).toEqual(['customer_identifier']);
    expect(plan.preResponseActions).toHaveLength(0);
    expect(plan.responseOverride).toContain('CPF/CNPJ');
    expect(plan.forbiddenToolNames).toContain('mcp:router:change_wifi_credentials');
  });

  it('validates the contract before staging a qualified reboot confirmation', () => {
    const input = {
      customerMessage: 'reinicia meu roteador, CPF 52998224725, contrato 123',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:reboot_router'],
      toolCatalog: catalog,
    };
    const validationPlan = buildAutopilotTurnPlan(input);
    const confirmationPlan = buildAutopilotTurnPlan({
      ...input,
      recentToolResults: [sgpResult([{ id: '123', ip: '10.55.81.19', connectionStatus: 'online' }])],
    });

    expect(validationPlan.expectedNextAction).toBe('call_required_tool');
    expect(validationPlan.preResponseActions).toMatchObject([{
      type: 'sgp_fetch_contact_panel_data',
    }]);
    expect(validationPlan.confirmationAction).toBeNull();
    expect(confirmationPlan.expectedNextAction).toBe('require_confirmation');
    expect(confirmationPlan.responseOverride).toContain('Confirme explicitamente');
    expect(confirmationPlan.confirmationAction).toMatchObject({
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:router:reboot_router',
        arguments: { client_ip: '10.55.81.19' },
      },
    });
  });

  it('validates the contract before asking only for the requested Wi-Fi value', () => {
    const input = {
      customerMessage: 'quero trocar a senha do wifi, CPF 52998224725, contrato 123',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:reboot_router', 'mcp:router:change_wifi_credentials'],
      toolCatalog: catalog,
    };
    const validationPlan = buildAutopilotTurnPlan(input);
    const valuePlan = buildAutopilotTurnPlan({
      ...input,
      recentToolResults: [sgpResult([{ id: '123', ip: '10.55.81.19', connectionStatus: 'online' }])],
    });

    expect(validationPlan.customerNeed).toBe('wifi_credentials_change');
    expect(validationPlan.expectedNextAction).toBe('call_required_tool');
    expect(validationPlan.preResponseActions).toMatchObject([{
      type: 'sgp_fetch_contact_panel_data',
    }]);
    expect(validationPlan.confirmationAction).toBeNull();
    expect(valuePlan.expectedNextAction).toBe('ask_slot');
    expect(valuePlan.missingInputFields).toEqual([{
      name: 'new_wifi_password',
      label: 'nova senha do Wi-Fi',
    }]);
    expect(valuePlan.responseOverride).toContain('Informe apenas a nova senha');
    expect(valuePlan.responseOverride).not.toContain('novo nome');
    expect(valuePlan.confirmationAction).toBeNull();
    expect(valuePlan.forbiddenToolNames).toContain('mcp:router:reboot_router');
  });

  it('stages the qualified ZTE Wi-Fi password action only after a new value and never fills admin credentials', () => {
    const newPassword = 'SenhaTemporariaSegura42!';
    const plan = buildAutopilotTurnPlan({
      customerMessage: `Nova senha: ${newPassword}`,
      chatHistory: [
        'Cliente: quero trocar a senha do wifi, CPF 52998224725, contrato 123',
        'Atendente: Validei o contrato. Informe apenas a nova senha do Wi-Fi.',
      ].join('\n'),
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:reboot_router', 'mcp:router:change_wifi_credentials'],
      toolCatalog: catalog,
      recentToolResults: [sgpResult([{ id: '123', ip: '10.55.81.19', connectionStatus: 'online' }])],
    });

    expect(plan.customerNeed).toBe('wifi_credentials_change');
    expect(plan.expectedNextAction).toBe('require_confirmation');
    expect(plan.preResponseActions).toHaveLength(0);
    expect(plan.confirmationAction).toMatchObject({
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:router:change_wifi_credentials',
        arguments: {
          client_ip: '10.55.81.19',
          password_24: newPassword,
          password_5g: newPassword,
        },
      },
    });
    expect((plan.confirmationAction?.payload as any)?.arguments?.password).toBeUndefined();
    expect((plan.confirmationAction?.payload as any)?.arguments?.username).toBeUndefined();
    expect(plan.responseOverride).toContain('Nenhuma mudanca foi aplicada');
    expect(plan.responseOverride).not.toContain(newPassword);
  });

  it('stages an SSID-only change without inventing a password change', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'Novo SSID: RedeSuporteNova',
      chatHistory: [
        'Cliente: quero trocar somente o nome da rede wifi, CPF 52998224725, contrato 123',
        'Atendente: Validei o contrato. Informe apenas o novo nome da rede.',
      ].join('\n'),
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:change_wifi_credentials'],
      toolCatalog: catalog,
      recentToolResults: [sgpResult([{ id: '123', ip: '10.55.81.19', connectionStatus: 'online' }])],
    });

    const argumentsValue = (plan.confirmationAction?.payload as any)?.arguments as Record<string, unknown>;
    expect(plan.expectedNextAction).toBe('require_confirmation');
    expect(argumentsValue).toMatchObject({
      client_ip: '10.55.81.19',
      ssid_24: 'RedeSuporteNova',
      ssid_5g: 'RedeSuporteNova',
    });
    expect(argumentsValue.password_24).toBeUndefined();
    expect(argumentsValue.password_5g).toBeUndefined();
  });

  it('does not repeat an operational SGP lookup after a recent failure', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'e ai?',
      chatHistory: [
        'Cliente: preciso da segunda via do boleto',
        'Atendente: Para consultar com seguranca, me informe o CPF/CNPJ.',
        'Cliente: 529.982.247-25',
        'Atendente: Nao consegui concluir a consulta automatica agora.',
      ].join('\n'),
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
      toolCatalog: catalog,
      recentToolResults: [failedToolResult('sgp_fetch_contact_panel_data')],
    });

    expect(plan.customerNeed).toBe('external_lookup');
    expect(plan.expectedNextAction).toBe('continue_llm');
    expect(plan.preResponseActions).toHaveLength(0);
    expect(plan.responseOverride).toContain('verificar manualmente');
    expect(plan.reasons).toContain('operational_lookup_recent_sgp_failure');
  });

  it('does not repeat Wi-Fi credential SGP validation after a recent failure', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'e ai?',
      chatHistory: [
        'Cliente: esqueci usuario e senha do wifi',
        'Atendente: Para consultar com seguranca, me informe o CPF/CNPJ.',
        'Cliente: 529.982.247-25',
        'Atendente: Nao consegui concluir a consulta automatica agora.',
      ].join('\n'),
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
      recentToolResults: [failedToolResult('sgp_fetch_contact_panel_data')],
    });

    expect(plan.customerNeed).toBe('wifi_credentials_lookup');
    expect(plan.expectedNextAction).toBe('continue_llm');
    expect(plan.preResponseActions).toHaveLength(0);
    expect(plan.responseOverride).toContain('verificar manualmente');
    expect(plan.reasons).toContain('wifi_credentials_recent_sgp_failure');
  });

  it('does not repeat a qualified MCP order lookup after a recent failure', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'e ai?',
      chatHistory: [
        'Cliente: qual o status do meu pedido?',
        'Atendente: Para consultar o status, me informe o numero do pedido.',
        'Cliente: pedido AB1234',
        'Atendente: Nao consegui concluir a consulta automatica agora.',
      ].join('\n'),
      slotExtraction: slots({ order_or_request_id: 'AB1234' }),
      enabledToolNames: ['mcp:ecommerce:get_order_status'],
      toolCatalog: catalog,
      recentToolResults: [failedToolResult('mcp:ecommerce:get_order_status', { order_id: 'AB1234' })],
    });

    expect(plan.customerNeed).toBe('order_status_lookup');
    expect(plan.expectedNextAction).toBe('continue_llm');
    expect(plan.preResponseActions).toHaveLength(0);
    expect(plan.responseOverride).toContain('verificar manualmente');
    expect(plan.reasons).toContain('order_status_recent_mcp_failure');
  });

  it('retries a failed read-only tool only when the customer explicitly asks', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'Pode tentar novamente agora?',
      chatHistory: [
        'Cliente: qual o status do pedido AB1234?',
        'Atendente: Nao consegui concluir a consulta automatica agora.',
      ].join('\n'),
      slotExtraction: slots({ order_or_request_id: 'AB1234' }),
      enabledToolNames: ['mcp:ecommerce:get_order_status'],
      toolCatalog: catalog,
      recentToolResults: [failedToolResult('mcp:ecommerce:get_order_status', { order_id: 'AB1234' })],
    });

    expect(isExplicitAutopilotToolRetryRequest('Pode tentar novamente agora?')).toBe(true);
    expect(isExplicitAutopilotToolRetryRequest('sim')).toBe(false);
    expect(isExplicitAutopilotToolRetryRequest('e ai?')).toBe(false);
    expect(plan.customerNeed).toBe('order_status_lookup');
    expect(plan.expectedNextAction).toBe('call_required_tool');
    expect(plan.preResponseActions).toMatchObject([{
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:ecommerce:get_order_status',
        arguments: { order_id: 'AB1234' },
      },
    }]);
  });

  it('retries Wi-Fi lookup after failure without authorizing reboot', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'Tente de novo',
      chatHistory: [
        'Cliente: esqueci usuario e senha do wifi, CPF 52998224725',
        'Atendente: Validei o cadastro, mas nao consegui obter os dados do Wi-Fi.',
      ].join('\n'),
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: [
        'sgp_fetch_contact_panel_data',
        'mcp:router:get_wifi_view',
        'mcp:router:reboot_router',
      ],
      toolCatalog: catalog,
      recentToolResults: [
        sgpResult([{ id: '123', ip: '10.55.81.19', connectionStatus: 'online' }]),
        failedToolResult('mcp:router:get_wifi_view', { client_ip: '10.55.81.19' }),
      ],
    });

    expect(plan.customerNeed).toBe('wifi_credentials_lookup');
    expect(plan.expectedNextAction).toBe('call_required_tool');
    expect(plan.preResponseActions).toMatchObject([{
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:router:get_wifi_view',
        arguments: { client_ip: '10.55.81.19' },
      },
    }]);
    expect(plan.forbiddenToolNames).toContain('mcp:router:reboot_router');
  });

  it('prioritizes a concrete deterministic turn over a static entry greeting', () => {
    const actionablePlan = buildAutopilotTurnPlan({
      customerMessage: 'esqueci o usuario e a senha do wifi, meu CPF e 52998224725',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      allowedToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
    });
    const conversationalPlan = buildAutopilotTurnPlan({
      customerMessage: 'oi',
      slotExtraction: slots(),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      allowedToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
    });

    expect(shouldPrioritizeAutopilotTurnPlan(actionablePlan)).toBe(true);
    expect(shouldPrioritizeAutopilotTurnPlan(conversationalPlan)).toBe(false);
  });

  it('terminates the turn after a required tool fails instead of entering another planner', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'esqueci o usuario e a senha do wifi, meu CPF e 52998224725',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      allowedToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
    });
    const failedWifiResult: AgentToolExecutionResult = {
      toolName: 'mcp:router:get_wifi_view' as any,
      status: 'error',
      input: {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:router:get_wifi_view',
          arguments: { client_ip: '192.0.2.10' },
        },
      },
      error: 'fetch failed',
    };

    expect(hasRequiredAutopilotTurnPlanFailure(plan, [failedWifiResult])).toBe(true);
    expect(hasRequiredAutopilotTurnPlanFailure(plan, [{
      ...failedWifiResult,
      toolName: 'mcp:router:optional_lookup' as any,
      input: {
        type: 'mcp_call_tool',
        payload: { toolName: 'mcp:router:optional_lookup', arguments: {} },
      },
    }])).toBe(false);
  });

  it('marks a turn complete only when every required qualified tool succeeded', () => {
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'esqueci o usuario e a senha do wifi, meu CPF e 52998224725',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      allowedToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      toolCatalog: catalog,
    });
    const sgpSuccess = sgpResult([{ id: '123', ip: '10.55.81.19', connectionStatus: 'online' }]);
    const wifiSuccess: AgentToolExecutionResult = {
      toolName: 'mcp:router:get_wifi_view',
      status: 'success',
      input: {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:router:get_wifi_view',
          arguments: { client_ip: '10.55.81.19' },
        },
      },
      output: { structuredContent: { ssid: 'Casa', password: 'segredo' } },
    };

    expect(hasSatisfiedAutopilotTurnPlan(plan, [sgpSuccess])).toBe(false);
    expect(hasSatisfiedAutopilotTurnPlan(plan, [sgpSuccess, wifiSuccess])).toBe(true);
    expect(hasSatisfiedAutopilotTurnPlan(plan, [
      sgpSuccess,
      { ...wifiSuccess, status: 'error', output: null, error: 'timeout' },
    ])).toBe(false);
  });

  it('recovers a failed live Wi-Fi scan with one read-only cached lookup', () => {
    const cachedTool = tool(
      'mcp:router:get_wifi_scan_cached',
      'Retorna o ultimo scan de redes Wi-Fi vizinhas salvo em cache.',
      { type: 'object', properties: { client_ip: { type: 'string' } } },
    );
    const plan = buildAutopilotTurnPlan({
      customerMessage: 'analise os canais do wifi CPF 52998224725',
      slotExtraction: slots({ customer_identifier: '52998224725' }),
      enabledToolNames: [
        'sgp_fetch_contact_panel_data',
        'mcp:router:scan_wifi_neighbors',
        'mcp:router:get_wifi_scan_cached',
      ],
      allowedToolNames: [
        'sgp_fetch_contact_panel_data',
        'mcp:router:scan_wifi_neighbors',
        'mcp:router:get_wifi_scan_cached',
      ],
      toolCatalog: [
        ...catalog,
        tool(
          'mcp:router:scan_wifi_neighbors',
          'Escaneia redes Wi-Fi vizinhas e canais.',
          { type: 'object', properties: { client_ip: { type: 'string' } } },
        ),
        cachedTool,
      ],
    });
    const sgpSuccess = sgpResult([{ id: '123', ip: '10.55.81.19', connectionStatus: 'online' }]);
    const failedScan: AgentToolExecutionResult = {
      toolName: 'mcp:router:scan_wifi_neighbors',
      status: 'error',
      input: {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:router:scan_wifi_neighbors',
          arguments: { client_ip: '10.55.81.19' },
        },
      },
      error: 'router unreachable',
    };

    const recovery = buildAutopilotTurnPlanRecoveryActions({
      turnPlan: plan,
      customerMessage: 'analise os canais do wifi CPF 52998224725',
      enabledToolNames: [
        'sgp_fetch_contact_panel_data',
        'mcp:router:scan_wifi_neighbors',
        'mcp:router:get_wifi_scan_cached',
      ],
      allowedToolNames: [
        'sgp_fetch_contact_panel_data',
        'mcp:router:scan_wifi_neighbors',
        'mcp:router:get_wifi_scan_cached',
      ],
      toolCatalog: [...catalog, cachedTool],
      toolResults: [sgpSuccess, failedScan],
    });

    expect(recovery).toMatchObject([{
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:router:get_wifi_scan_cached',
        arguments: { client_ip: '10.55.81.19' },
      },
    }]);

    const cachedSuccess: AgentToolExecutionResult = {
      toolName: 'mcp:router:get_wifi_scan_cached',
      status: 'success',
      input: recovery[0],
      output: { structuredContent: { source: 'cached_wifi_scan', networks: [] } },
    };
    expect(hasRequiredAutopilotTurnPlanFailure(plan, [sgpSuccess, failedScan, cachedSuccess])).toBe(false);
    expect(hasSatisfiedAutopilotTurnPlan(plan, [sgpSuccess, failedScan, cachedSuccess])).toBe(true);
  });

  it('bypasses RAG only when a concrete operational need has a matching enabled tool', () => {
    expect(shouldBypassKnowledgeForOperationalTurn({
      customerNeed: 'wifi_credentials_lookup',
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
    })).toBe(true);
    expect(shouldBypassKnowledgeForOperationalTurn({
      customerNeed: 'wifi_channel_diagnostics',
      enabledToolNames: ['mcp:router:scan_wifi_neighbors'],
    })).toBe(true);
    expect(shouldBypassKnowledgeForOperationalTurn({
      customerNeed: 'wifi_credentials_lookup',
      enabledToolNames: ['mcp:router:reboot_router'],
    })).toBe(false);
    expect(shouldBypassKnowledgeForOperationalTurn({
      customerNeed: 'generic_external_lookup',
      enabledToolNames: ['mcp:commerce:list_products'],
    })).toBe(false);
    expect(shouldBypassKnowledgeForOperationalTurn({
      customerNeed: 'generic_external_lookup',
      enabledToolNames: ['mcp:commerce:list_products'],
      customerMessage: 'Quais produtos tem com preco e disponibilidade?',
      toolCatalog: catalog,
    })).toBe(true);
    expect(shouldBypassKnowledgeForOperationalTurn({
      customerNeed: 'generic_external_action',
      enabledToolNames: ['mcp:logistics:schedule_pickup'],
      customerMessage: 'Quero agendar uma coleta logistica',
      toolCatalog: catalog,
    })).toBe(true);
    expect(shouldBypassKnowledgeForOperationalTurn({
      customerNeed: 'generic_external_lookup',
      enabledToolNames: ['mcp:clinic:get_available_slots'],
      customerMessage: 'Quais produtos tem com preco?',
      toolCatalog: catalog,
    })).toBe(false);
  });
});
