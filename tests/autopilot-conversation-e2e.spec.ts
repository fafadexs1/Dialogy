import { describe, expect, it } from 'vitest';

import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import { runAutopilotConversationScenario } from '@/services/autopilot/conversation-eval-runner';

function tool(input: {
  name: string;
  description: string;
  sideEffect?: AgentToolCatalogItem['sideEffect'];
  riskLevel?: AgentToolCatalogItem['riskLevel'];
  inputSchema?: Record<string, unknown> | null;
}): AgentToolCatalogItem {
  return {
    name: input.name as AgentToolCatalogItem['name'],
    version: input.name.startsWith('mcp:') ? 'mcp' : 'builtin',
    description: input.description,
    class: input.sideEffect && input.sideEffect !== 'none' ? 'write_non_idempotent' : 'retrieval',
    riskLevel: input.riskLevel || (input.sideEffect === 'high' ? 'high' : 'low'),
    sideEffect: input.sideEffect || 'none',
    idempotent: input.sideEffect !== 'high',
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: input.sideEffect === 'high',
    customerVisible: true,
    allowedIntents: ['support_request', 'troubleshooting', 'change_request', 'order_or_request_status'],
    requiredSlots: [],
    fallbackAction: 'handoff',
    source: input.name.startsWith('mcp:') ? 'mcp' : 'dialogy',
    enabledByDefault: false,
    serverId: input.name.startsWith('mcp:') ? 'router' : undefined,
    serverName: input.name.startsWith('mcp:') ? 'Router MCP' : undefined,
    inputSchema: input.inputSchema || null,
  };
}

const toolCatalog = [
  tool({
    name: 'sgp_fetch_contact_panel_data',
    description: 'Consulta cadastro, contratos, status e IPv4 do cliente no SGP.',
  }),
  tool({
    name: 'mcp:ecommerce:get_order_status',
    description: 'Consulta status, rastreio e previsao de entrega de um pedido pelo numero do pedido.',
    inputSchema: { type: 'object', properties: { order_id: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:commerce:list_products',
    description: 'Lista catalogo de produtos, planos, precos, estoque e disponibilidade.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:clinic:get_available_slots',
    description: 'Consulta agenda, horarios disponiveis e vagas para visitas por data.',
    inputSchema: { type: 'object', required: ['date'], properties: { date: { type: 'string' }, time: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:clinic:book_appointment',
    description: 'Agenda e confirma uma consulta para a data e horario solicitados.',
    sideEffect: 'medium',
    riskLevel: 'medium',
    inputSchema: { type: 'object', required: ['date', 'time'], properties: { date: { type: 'string' }, time: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:commerce:cancel_order',
    description: 'Cancela definitivamente um pedido pelo numero informado.',
    sideEffect: 'high',
    riskLevel: 'high',
    inputSchema: { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:commerce:refund_order',
    description: 'Estorna, cancela ou reembolsa um pedido do cliente.',
    sideEffect: 'high',
    riskLevel: 'high',
    inputSchema: { type: 'object', properties: { order_id: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:router:get_wifi_view',
    description: 'Consulta SSID, usuario e senha atuais do Wi-Fi do contrato validado.',
    inputSchema: { type: 'object', properties: { client_ip: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:router:scan_wifi_neighbors',
    description: 'Escaneia redes Wi-Fi ao redor, canal, potencia e interferencia sem alterar o roteador.',
    inputSchema: { type: 'object', properties: { client_ip: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:router:reboot_router',
    description: 'Reinicia o roteador do cliente.',
    sideEffect: 'high',
    riskLevel: 'high',
    inputSchema: { type: 'object', properties: { client_ip: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:router:change_wifi_credentials',
    description: 'Troca nome SSID e senha do Wi-Fi do roteador.',
    sideEffect: 'high',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      required: ['client_ip'],
      properties: {
        client_ip: { type: 'string', description: 'IP da ONT no ACS.' },
        password: { type: 'string', description: 'Senha administrativa da interface web.' },
        username: { type: 'string', description: 'Usuario administrativo da interface web.' },
        ssid_24: { type: 'string', description: 'Novo SSID para a rede 2.4 GHz.' },
        ssid_5g: { type: 'string', description: 'Novo SSID para a rede 5 GHz.' },
        password_24: { type: 'string', description: 'Nova senha para a rede 2.4 GHz.' },
        password_5g: { type: 'string', description: 'Nova senha para a rede 5 GHz.' },
      },
    },
  }),
] satisfies AgentToolCatalogItem[];

function sgpFixture(action: AgentToolAction): AgentToolExecutionResult {
  return {
    toolName: 'sgp_fetch_contact_panel_data',
    status: 'success',
    input: action,
    output: {
      customerName: 'Cliente Teste',
      cpfCnpj: '52998224725',
      contracts: [
        {
          id: '3367529',
          ip: '10.55.81.19',
          connectionStatus: 'online',
          planDescription: 'Fibra 600 Mega',
        },
      ],
      invoices: [
        {
          id: 'fat-3367529-1',
          dueDate: '2026-06-30',
          amountFormatted: 'R$ 99,90',
          isPaid: false,
          isCancelled: false,
        },
      ],
    },
  };
}

describe('autopilot conversation E2E simulator', () => {
  it('runs a two-turn Wi-Fi credential lookup through CPF, SGP and qualified MCP without rebooting', () => {
    const result = runAutopilotConversationScenario({
      id: 'wifi_credentials_two_turns',
      title: 'Consulta credenciais Wi-Fi em conversa realista',
      enabledToolNames: [
        'sgp_fetch_contact_panel_data',
        'mcp:router:get_wifi_view',
        'mcp:router:scan_wifi_neighbors',
        'mcp:router:reboot_router',
        'mcp:router:change_wifi_credentials',
      ],
      toolCatalog,
      toolFixtures: {
        sgp_fetch_contact_panel_data: ({ action }) => sgpFixture(action),
        'mcp:router:get_wifi_view': ({ action }) => ({
          toolName: 'mcp:router:get_wifi_view',
          status: 'success',
          input: action,
          output: {
            structuredContent: {
              ssid: 'Klyra Fibra 5G',
              username: 'cliente3367529',
              password: 'wifi-3367529',
            },
          },
        }),
      },
      turns: [
        { customerMessage: 'esqueci o usuario e senha do wifi' },
        { customerMessage: '529.982.247-25' },
      ],
    });

    expect(result.invariantViolations).toEqual([]);
    expect(result.turns[0].turnPlan.customerNeed).toBe('wifi_credentials_lookup');
    expect(result.turns[0].executedTools).toEqual([]);
    expect(result.turns[0].response).toContain('CPF/CNPJ');
    expect(result.turns[1].turnPlan.customerNeed).toBe('wifi_credentials_lookup');
    expect(result.turns[1].executedTools).toEqual([
      'sgp_fetch_contact_panel_data',
      'mcp:router:get_wifi_view',
    ]);
    expect(result.turns[1].executedTools).not.toContain('mcp:router:reboot_router');
    expect(result.turns[1].executedTools).not.toContain('mcp:router:change_wifi_credentials');
    expect(result.turns[1].response).toContain('Rede/SSID: Klyra Fibra 5G');
    expect(result.turns[1].response).toContain('Senha: wifi-3367529');
  });

  it('diagnoses Wi-Fi channel conditions without changing channel, SSID or password', () => {
    const result = runAutopilotConversationScenario({
      id: 'wifi_channel_diagnostics_two_turns',
      title: 'Diagnostico de canal Wi-Fi sem side effect',
      enabledToolNames: [
        'sgp_fetch_contact_panel_data',
        'mcp:router:get_wifi_view',
        'mcp:router:scan_wifi_neighbors',
        'mcp:router:reboot_router',
        'mcp:router:change_wifi_credentials',
      ],
      toolCatalog,
      toolFixtures: {
        sgp_fetch_contact_panel_data: ({ action }) => sgpFixture(action),
        'mcp:router:scan_wifi_neighbors': ({ action }) => ({
          toolName: 'mcp:router:scan_wifi_neighbors',
          status: 'success',
          input: action,
          output: {
            content: [
              {
                type: 'text',
                text: 'Foram encontradas 11 redes proximas no canal 6. Recomendacao: manter 5 GHz no canal 44 e revisar posicionamento antes de qualquer alteracao.',
              },
            ],
          },
        }),
      },
      turns: [
        { customerMessage: 'minha internet esta lenta, veja as redes ao redor e o canal do wifi' },
        { customerMessage: '529.982.247-25' },
      ],
    });

    expect(result.invariantViolations).toEqual([]);
    expect(result.turns[1].executedTools).toEqual([
      'sgp_fetch_contact_panel_data',
      'mcp:router:scan_wifi_neighbors',
    ]);
    expect(result.turns[1].executedTools).not.toContain('mcp:router:reboot_router');
    expect(result.turns[1].executedTools).not.toContain('mcp:router:change_wifi_credentials');
    expect(result.turns[1].response).toContain('canal 6');
    expect(result.turns[1].response).toContain('Recomendacao');
  });

  it('does not execute router reboot without customer identity and explicit confirmation', () => {
    const result = runAutopilotConversationScenario({
      id: 'router_reboot_requires_identity',
      title: 'Reboot protegido por identidade e confirmacao',
      enabledToolNames: [
        'sgp_fetch_contact_panel_data',
        'mcp:router:get_wifi_view',
        'mcp:router:scan_wifi_neighbors',
        'mcp:router:reboot_router',
        'mcp:router:change_wifi_credentials',
      ],
      toolCatalog,
      toolFixtures: {
        sgp_fetch_contact_panel_data: ({ action }) => sgpFixture(action),
        'mcp:router:reboot_router': ({ action }) => ({
          toolName: 'mcp:router:reboot_router',
          status: 'success',
          input: action,
          output: { structuredContent: { ok: true } },
        }),
      },
      turns: [
        { customerMessage: 'reinicia meu roteador agora' },
      ],
    });

    expect(result.invariantViolations).toEqual([]);
    expect(result.turns[0].turnPlan.customerNeed).toBe('router_reboot');
    expect(result.turns[0].executedTools).toEqual([]);
    expect(result.turns[0].response).toContain('CPF/CNPJ');
  });

  it('does not execute Wi-Fi credential changes while only collecting new values and confirmation', () => {
    const result = runAutopilotConversationScenario({
      id: 'wifi_change_requires_confirmation',
      title: 'Troca de credenciais protegida por confirmacao',
      enabledToolNames: [
        'sgp_fetch_contact_panel_data',
        'mcp:router:get_wifi_view',
        'mcp:router:scan_wifi_neighbors',
        'mcp:router:reboot_router',
        'mcp:router:change_wifi_credentials',
      ],
      toolCatalog,
      toolFixtures: {
        sgp_fetch_contact_panel_data: ({ action }) => sgpFixture(action),
        'mcp:router:change_wifi_credentials': ({ action }) => ({
          toolName: 'mcp:router:change_wifi_credentials',
          status: 'success',
          input: action,
          output: { structuredContent: { ok: true } },
        }),
      },
      contact: {
        id: 'contact-with-cpf',
        workspace_id: 'eval-workspace',
        name: 'Cliente Teste',
        custom_fields: { cpf: '529.982.247-25' },
      },
      turns: [
        { customerMessage: 'quero trocar a senha do wifi' },
        { customerMessage: 'Nova senha: SenhaTemporariaSegura42!' },
      ],
    });

    expect(result.invariantViolations).toEqual([]);
    expect(result.turns[0].turnPlan.customerNeed).toBe('wifi_credentials_change');
    expect(result.turns[0].executedTools).toEqual(['sgp_fetch_contact_panel_data']);
    expect(result.turns[0].response).toContain('Informe apenas a nova senha');
    expect(result.turns[0].pendingConfirmationTool).toBeNull();
    expect(result.turns[1].executedTools).toEqual([]);
    expect(result.turns[1].pendingConfirmationTool).toBe('mcp:router:change_wifi_credentials');
    expect(result.turns[1].response).toContain('Confirme explicitamente');
  });

  it('runs a two-turn billing lookup through CPF and SGP without depending on an LLM promise', () => {
    const result = runAutopilotConversationScenario({
      id: 'billing_second_copy_two_turns',
      title: 'Segunda via de boleto em conversa sequencial',
      enabledToolNames: [
        'sgp_fetch_contact_panel_data',
        'mcp:router:get_wifi_view',
        'mcp:router:scan_wifi_neighbors',
        'mcp:router:reboot_router',
        'mcp:router:change_wifi_credentials',
      ],
      toolCatalog,
      toolFixtures: {
        sgp_fetch_contact_panel_data: ({ action }) => sgpFixture(action),
      },
      turns: [
        { customerMessage: 'preciso da segunda via do boleto' },
        { customerMessage: '529.982.247-25' },
      ],
    });

    expect(result.invariantViolations).toEqual([]);
    expect(result.turns[0].turnPlan.customerNeed).toBe('external_lookup');
    expect(result.turns[0].executedTools).toEqual([]);
    expect(result.turns[0].response).toContain('CPF/CNPJ');
    expect(result.turns[1].turnPlan.customerNeed).toBe('external_lookup');
    expect(result.turns[1].executedTools).toEqual(['sgp_fetch_contact_panel_data']);
    expect(result.turns[1].response).toContain('Faturas em aberto: 1');
    expect(result.turns[1].response).toContain('R$ 99,90');
  });

  it('runs a two-turn order status lookup through a qualified MCP tool', () => {
    const result = runAutopilotConversationScenario({
      id: 'order_status_mcp_two_turns',
      title: 'Status de pedido com MCP qualificada',
      enabledToolNames: [
        'mcp:ecommerce:get_order_status',
        'sgp_fetch_contact_panel_data',
        'mcp:router:reboot_router',
        'mcp:router:change_wifi_credentials',
      ],
      toolCatalog,
      toolFixtures: {
        'mcp:ecommerce:get_order_status': ({ action }) => ({
          toolName: 'mcp:ecommerce:get_order_status',
          status: 'success',
          input: action,
          output: {
            structuredContent: {
              order_id: 'AB1234',
              status: 'Saiu para entrega',
              tracking_code: 'BR123456789',
              delivery_estimate: '2026-06-21',
            },
          },
        }),
      },
      turns: [
        { customerMessage: 'qual o status do meu pedido?' },
        { customerMessage: 'pedido AB1234' },
      ],
    });

    expect(result.invariantViolations).toEqual([]);
    expect(result.turns[0].turnPlan.customerNeed).toBe('order_status_lookup');
    expect(result.turns[0].executedTools).toEqual([]);
    expect(result.turns[0].response).toContain('numero do pedido');
    expect(result.turns[1].turnPlan.customerNeed).toBe('order_status_lookup');
    expect(result.turns[1].executedTools).toEqual(['mcp:ecommerce:get_order_status']);
    expect(result.turns[1].executedTools).not.toContain('mcp:router:reboot_router');
    expect(result.turns[1].executedTools).not.toContain('mcp:router:change_wifi_credentials');
    expect(result.turns[1].response).toContain('Status: Saiu para entrega');
    expect(result.turns[1].response).toContain('Rastreamento: BR123456789');
  });

  it('answers catalog and pricing through the relevant qualified MCP tool without destructive actions', () => {
    const result = runAutopilotConversationScenario({
      id: 'catalog_prices_mcp_single_turn',
      title: 'Catalogo e precos via MCP read-only',
      enabledToolNames: [
        'mcp:commerce:list_products',
        'mcp:commerce:refund_order',
        'mcp:router:reboot_router',
        'mcp:router:change_wifi_credentials',
      ],
      toolCatalog,
      toolFixtures: {
        'mcp:commerce:list_products': ({ action }) => ({
          toolName: 'mcp:commerce:list_products',
          status: 'success',
          input: action,
          output: {
            structuredContent: {
              products: [
                { name: 'Plano Pro', price: 'R$ 99,90', availability: 'disponivel' },
                { name: 'Plano Ultra', price: 'R$ 149,90', availability: 'sob consulta' },
              ],
            },
          },
        }),
      },
      turns: [
        { customerMessage: 'quais produtos voces tem com preco e disponibilidade?' },
      ],
    });

    expect(result.invariantViolations).toEqual([]);
    expect(result.turns[0].turnPlan.customerNeed).toBe('generic_external_lookup');
    expect(result.turns[0].executedTools).toEqual(['mcp:commerce:list_products']);
    expect(result.turns[0].executedTools).not.toContain('mcp:commerce:refund_order');
    expect(result.turns[0].executedTools).not.toContain('mcp:router:reboot_router');
    expect(result.turns[0].response).toContain('Plano Pro');
    expect(result.turns[0].response).toContain('R$ 99,90');
  });

  it('runs scheduling lookup message by message and fills required slots before calling MCP', () => {
    const result = runAutopilotConversationScenario({
      id: 'scheduling_slots_mcp_two_turns',
      title: 'Consulta agenda com slot obrigatorio',
      enabledToolNames: [
        'mcp:clinic:get_available_slots',
        'mcp:commerce:refund_order',
        'mcp:router:reboot_router',
      ],
      toolCatalog,
      toolFixtures: {
        'mcp:clinic:get_available_slots': ({ action }) => ({
          toolName: 'mcp:clinic:get_available_slots',
          status: 'success',
          input: action,
          output: {
            structuredContent: {
              slots: [
                { date: '2026-06-22', time: '14:00', status: 'disponivel' },
                { date: '2026-06-22', time: '15:00', status: 'disponivel' },
              ],
            },
          },
        }),
      },
      turns: [
        { customerMessage: 'quero consultar horarios disponiveis para uma visita' },
        { customerMessage: '2026-06-22 as 14h' },
      ],
    });

    expect(result.invariantViolations).toEqual([]);
    expect(result.turns[0].turnPlan.customerNeed).toBe('generic_external_lookup');
    expect(result.turns[0].executedTools).toEqual([]);
    expect(result.turns[0].response).toContain('data');
    expect(result.turns[1].turnPlan.customerNeed).toBe('generic_external_lookup');
    expect(result.turns[1].executedTools).toEqual(['mcp:clinic:get_available_slots']);
    expect(result.turns[1].executedTools).not.toContain('mcp:commerce:refund_order');
    expect(result.turns[1].executedTools).not.toContain('mcp:router:reboot_router');
    expect(result.turns[1].response).toContain('2026-06-22');
    expect(result.turns[1].response).toContain('14:00');
  });

  it('does not loop after an SGP billing lookup failure', () => {
    const result = runAutopilotConversationScenario({
      id: 'billing_sgp_failure_no_loop',
      title: 'Falha SGP nao repete a mesma consulta',
      enabledToolNames: [
        'sgp_fetch_contact_panel_data',
        'mcp:router:get_wifi_view',
        'mcp:router:scan_wifi_neighbors',
      ],
      toolCatalog,
      toolFixtures: {
        sgp_fetch_contact_panel_data: ({ action }) => ({
          toolName: 'sgp_fetch_contact_panel_data',
          status: 'error',
          input: action,
          error: 'SGP timeout',
        }),
      },
      turns: [
        { customerMessage: 'preciso da segunda via do boleto' },
        { customerMessage: '529.982.247-25' },
        { customerMessage: 'e ai?' },
      ],
    });

    expect(result.invariantViolations).toEqual([]);
    expect(result.turns[1].executedTools).toEqual(['sgp_fetch_contact_panel_data']);
    expect(result.turns[1].response).toContain('verificar manualmente');
    expect(result.turns[2].turnPlan.customerNeed).toBe('external_lookup');
    expect(result.turns[2].executedTools).toEqual([]);
    expect(result.turns[2].response).toContain('verificar manualmente');
    expect(result.turns[2].turnPlan.reasons).toContain('operational_lookup_recent_sgp_failure');
  });

  it('does not loop after a qualified MCP order status failure', () => {
    const result = runAutopilotConversationScenario({
      id: 'order_status_mcp_failure_no_loop',
      title: 'Falha MCP de pedido nao repete a mesma consulta',
      enabledToolNames: [
        'mcp:ecommerce:get_order_status',
        'sgp_fetch_contact_panel_data',
        'mcp:router:reboot_router',
        'mcp:router:change_wifi_credentials',
      ],
      toolCatalog,
      toolFixtures: {
        'mcp:ecommerce:get_order_status': ({ action }) => ({
          toolName: 'mcp:ecommerce:get_order_status',
          status: 'error',
          input: action,
          error: 'MCP timeout',
        }),
      },
      turns: [
        { customerMessage: 'qual o status do meu pedido?' },
        { customerMessage: 'pedido AB1234' },
        { customerMessage: 'e ai?' },
      ],
    });

    expect(result.invariantViolations).toEqual([]);
    expect(result.turns[1].executedTools).toEqual(['mcp:ecommerce:get_order_status']);
    expect(result.turns[1].response).toContain('verificar manualmente');
    expect(result.turns[2].turnPlan.customerNeed).toBe('order_status_lookup');
    expect(result.turns[2].executedTools).toEqual([]);
    expect(result.turns[2].response).toContain('verificar manualmente');
    expect(result.turns[2].turnPlan.reasons).toContain('order_status_recent_mcp_failure');
  });

  it('does not loop after a generic qualified MCP lookup failure', () => {
    const result = runAutopilotConversationScenario({
      id: 'catalog_mcp_failure_no_loop',
      title: 'Falha MCP generica nao repete a mesma consulta',
      enabledToolNames: [
        'mcp:commerce:list_products',
        'mcp:commerce:refund_order',
        'mcp:router:reboot_router',
      ],
      toolCatalog,
      toolFixtures: {
        'mcp:commerce:list_products': ({ action }) => ({
          toolName: 'mcp:commerce:list_products',
          status: 'error',
          input: action,
          error: 'MCP timeout',
        }),
      },
      turns: [
        { customerMessage: 'quais produtos tem com preco e disponibilidade?' },
        { customerMessage: 'e ai?' },
      ],
    });

    expect(result.invariantViolations).toEqual([]);
    expect(result.turns[0].executedTools).toEqual(['mcp:commerce:list_products']);
    expect(result.turns[0].response).toContain('verificar manualmente');
    expect(result.turns[1].turnPlan.customerNeed).toBe('generic_external_lookup');
    expect(result.turns[1].executedTools).toEqual([]);
    expect(result.turns[1].response).toContain('verificar manualmente');
    expect(result.turns[1].turnPlan.reasons).toContain('generic_external_lookup_recent_mcp_failure');
  });

  it('runs a two-phase scheduling transaction and executes the exact qualified tool once after confirmation', () => {
    const result = runAutopilotConversationScenario({
      id: 'scheduling_transaction',
      title: 'Agendamento com confirmacao vinculada',
      enabledToolNames: [
        'mcp:clinic:get_available_slots',
        'mcp:clinic:book_appointment',
        'mcp:commerce:cancel_order',
      ],
      toolCatalog,
      toolFixtures: {
        'mcp:clinic:book_appointment': ({ action, turnIndex }) => turnIndex === 0
          ? {
              toolName: 'mcp:clinic:book_appointment',
              status: 'rejected',
              input: action,
              error: '[tool_policy:confirmation_required] Confirmacao necessaria.',
            }
          : {
              toolName: 'mcp:clinic:book_appointment',
              status: 'success',
              input: action,
              output: {
                structuredContent: {
                  status: 'confirmado',
                  date: '2026-07-02',
                  time: '14:00',
                },
              },
            },
      },
      turns: [
        {
          customerMessage: 'quero agendar a consulta em 02/07/2026 as 14h',
          expect: {
            customerNeed: 'generic_external_action',
            expectedNextAction: 'require_confirmation',
            executedToolsInclude: ['mcp:clinic:book_appointment'],
            executedToolsExclude: ['mcp:clinic:get_available_slots', 'mcp:commerce:cancel_order'],
            responseIncludes: ['confirmacao explicita'],
            pendingConfirmationTool: 'mcp:clinic:book_appointment',
            confirmedTool: null,
            maxToolExecutions: 1,
          },
        },
        {
          customerMessage: 'sim, confirmo',
          expect: {
            customerNeed: 'generic_external_action',
            expectedNextAction: 'respond_from_tool_result',
            executedToolsInclude: ['mcp:clinic:book_appointment'],
            responseIncludes: ['confirmado', '2026-07-02', '14:00'],
            pendingConfirmationTool: null,
            confirmedTool: 'mcp:clinic:book_appointment',
            maxToolExecutions: 1,
          },
        },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.invariantViolations).toEqual([]);
    expect(result.assertionsTotal).toBeGreaterThan(10);
    expect(result.qualityScore).toBe(1);
    expect(result.turns[0].toolResults[0].input).toEqual(result.turns[1].toolResults[0].input);
  });

  it('consumes confirmation before execution so a failed side effect is never replayed by another yes', () => {
    const result = runAutopilotConversationScenario({
      id: 'failed_action_one_shot',
      title: 'Falha de acao confirmada sem replay',
      enabledToolNames: ['mcp:commerce:cancel_order'],
      toolCatalog,
      toolFixtures: {
        'mcp:commerce:cancel_order': ({ action, turnIndex }) => turnIndex === 0
          ? {
              toolName: 'mcp:commerce:cancel_order',
              status: 'rejected',
              input: action,
              error: '[tool_policy:confirmation_required] Confirmacao necessaria.',
            }
          : {
              toolName: 'mcp:commerce:cancel_order',
              status: 'error',
              input: action,
              error: 'upstream timeout after dispatch',
            },
      },
      turns: [
        {
          customerMessage: 'por favor cancele o pedido AB1234',
          expect: {
            pendingConfirmationTool: 'mcp:commerce:cancel_order',
            executedToolsInclude: ['mcp:commerce:cancel_order'],
          },
        },
        {
          customerMessage: 'confirmo',
          expect: {
            confirmedTool: 'mcp:commerce:cancel_order',
            pendingConfirmationTool: null,
            executedToolsInclude: ['mcp:commerce:cancel_order'],
            responseIncludes: ['nao vou repeti'],
          },
        },
        {
          customerMessage: 'sim',
          expect: {
            pendingConfirmationTool: null,
            confirmedTool: null,
            executedToolsExclude: ['mcp:commerce:cancel_order'],
            maxToolExecutions: 0,
          },
        },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.turns.flatMap((turn) => turn.executedTools).filter((toolName) => (
      toolName === 'mcp:commerce:cancel_order'
    ))).toHaveLength(2);
  });

  it('invalidates a pending destructive action when the customer changes subject', () => {
    const result = runAutopilotConversationScenario({
      id: 'stale_confirmation_superseded',
      title: 'Confirmacao antiga invalidada por novo assunto',
      enabledToolNames: ['mcp:commerce:cancel_order', 'mcp:commerce:list_products'],
      toolCatalog,
      toolFixtures: {
        'mcp:commerce:cancel_order': ({ action }) => ({
          toolName: 'mcp:commerce:cancel_order',
          status: 'rejected',
          input: action,
          error: '[tool_policy:confirmation_required] Confirmacao necessaria.',
        }),
        'mcp:commerce:list_products': ({ action }) => ({
          toolName: 'mcp:commerce:list_products',
          status: 'success',
          input: action,
          output: { structuredContent: { products: [{ name: 'Plano Pro', price: 'R$ 99,90' }] } },
        }),
      },
      turns: [
        {
          customerMessage: 'por favor cancele o pedido AB1234',
          expect: { pendingConfirmationTool: 'mcp:commerce:cancel_order' },
        },
        {
          customerMessage: 'antes disso, quais produtos e precos voces tem?',
          expect: {
            customerNeed: 'generic_external_lookup',
            executedToolsInclude: ['mcp:commerce:list_products'],
            executedToolsExclude: ['mcp:commerce:cancel_order'],
            pendingConfirmationTool: null,
          },
        },
        {
          customerMessage: 'sim',
          expect: {
            executedToolsExclude: ['mcp:commerce:cancel_order'],
            confirmedTool: null,
            pendingConfirmationTool: null,
          },
        },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.qualityScore).toBe(1);
  });
});
