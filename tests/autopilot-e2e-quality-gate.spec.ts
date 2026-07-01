import { describe, expect, it } from 'vitest';

import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import {
  runAutopilotConversationSuite,
  type AutopilotConversationScenario,
} from '@/services/autopilot/conversation-eval-runner';

function tool(input: {
  name: string;
  description: string;
  sideEffect?: AgentToolCatalogItem['sideEffect'];
  riskLevel?: AgentToolCatalogItem['riskLevel'];
  inputSchema?: Record<string, unknown>;
}): AgentToolCatalogItem {
  const isMcp = input.name.startsWith('mcp:');
  return {
    name: input.name as AgentToolCatalogItem['name'],
    version: isMcp ? 'mcp' : 'builtin',
    description: input.description,
    class: input.sideEffect && input.sideEffect !== 'none' ? 'write_non_idempotent' : 'retrieval',
    riskLevel: input.riskLevel || (input.sideEffect === 'high' ? 'high' : 'low'),
    sideEffect: input.sideEffect || 'none',
    idempotent: input.sideEffect !== 'high',
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: [
      'catalog_request',
      'pricing_request',
      'availability_request',
      'scheduling_request',
      'order_or_request_status',
      'support_request',
      'troubleshooting',
      'change_request',
      'cancellation_request',
    ],
    requiredSlots: [],
    fallbackAction: 'handoff',
    source: isMcp ? 'mcp' : 'dialogy',
    enabledByDefault: false,
    serverId: isMcp ? input.name.split(':')[1] : undefined,
    serverName: isMcp ? input.name.split(':')[1] : undefined,
    inputSchema: input.inputSchema || null,
  };
}

const catalog = [
  tool({
    name: 'sgp_fetch_contact_panel_data',
    description: 'Consulta cadastro, contratos e IPv4 do cliente.',
  }),
  tool({
    name: 'mcp:commerce:list_products',
    description: 'Lista catalogo, produtos, precos e disponibilidade.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:commerce:get_order_status',
    description: 'Consulta o status e rastreio de um pedido.',
    inputSchema: { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:commerce:cancel_order',
    description: 'Cancela definitivamente um pedido.',
    sideEffect: 'high',
    riskLevel: 'high',
    inputSchema: { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:clinic:book_appointment',
    description: 'Agenda e confirma uma consulta na data e horario solicitados.',
    sideEffect: 'medium',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      required: ['date', 'time'],
      properties: { date: { type: 'string' }, time: { type: 'string' } },
    },
  }),
  tool({
    name: 'mcp:logistics:schedule_pickup',
    description: 'Agenda uma coleta logistica com codigo do pacote e janela de coleta.',
    sideEffect: 'medium',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      required: ['package_code', 'pickup_window'],
      properties: {
        package_code: { type: 'string', description: 'codigo do pacote' },
        pickup_window: { type: 'string', description: 'janela de coleta' },
      },
    },
  }),
  tool({
    name: 'mcp:router:get_wifi_view',
    description: 'Consulta SSID, usuario e senha atuais do Wi-Fi.',
    inputSchema: { type: 'object', required: ['client_ip'], properties: { client_ip: { type: 'string' } } },
  }),
  tool({
    name: 'mcp:router:reboot_router',
    description: 'Reinicia o roteador.',
    sideEffect: 'high',
    riskLevel: 'high',
    inputSchema: { type: 'object', required: ['client_ip'], properties: { client_ip: { type: 'string' } } },
  }),
] satisfies AgentToolCatalogItem[];

function confirmationFixture(action: AgentToolAction): AgentToolExecutionResult {
  return {
    toolName: String(action.payload && 'toolName' in action.payload ? action.payload.toolName : action.type) as AgentToolExecutionResult['toolName'],
    status: 'rejected',
    input: action,
    error: '[tool_policy:confirmation_required] Confirmacao necessaria.',
  };
}

const scenarios: AutopilotConversationScenario[] = [
  {
    id: 'gate_catalog',
    title: 'Catalogo e preco read-only',
    enabledToolNames: ['mcp:commerce:list_products', 'mcp:commerce:cancel_order'],
    toolCatalog: catalog,
    toolFixtures: {
      'mcp:commerce:list_products': ({ action }) => ({
        toolName: 'mcp:commerce:list_products',
        status: 'success',
        input: action,
        output: { structuredContent: { products: [{ name: 'Plano Pro', price: 'R$ 99,90', available: true }] } },
      }),
    },
    turns: [{
      customerMessage: 'quais produtos tem, com preco e disponibilidade?',
      expect: {
        customerNeed: 'generic_external_lookup',
        executedToolsInclude: ['mcp:commerce:list_products'],
        executedToolsExclude: ['mcp:commerce:cancel_order'],
        responseIncludes: ['Plano Pro', 'R$ 99,90'],
        pendingConfirmationTool: null,
        maxToolExecutions: 1,
      },
    }],
  },
  {
    id: 'gate_order_status',
    title: 'Status usa consulta e nunca cancelamento',
    enabledToolNames: ['mcp:commerce:get_order_status', 'mcp:commerce:cancel_order'],
    toolCatalog: catalog,
    toolFixtures: {
      'mcp:commerce:get_order_status': ({ action }) => ({
        toolName: 'mcp:commerce:get_order_status',
        status: 'success',
        input: action,
        output: { structuredContent: { order_id: 'AB1234', status: 'em transporte' } },
      }),
    },
    turns: [{
      customerMessage: 'qual o status do pedido AB1234?',
      expect: {
        customerNeed: 'order_status_lookup',
        executedToolsInclude: ['mcp:commerce:get_order_status'],
        executedToolsExclude: ['mcp:commerce:cancel_order'],
        responseIncludes: ['AB1234', 'em transporte'],
        maxToolExecutions: 1,
      },
    }],
  },
  {
    id: 'gate_schedule',
    title: 'Agendamento transacional',
    enabledToolNames: ['mcp:clinic:book_appointment'],
    toolCatalog: catalog,
    toolFixtures: {
      'mcp:clinic:book_appointment': ({ action, turnIndex }) => turnIndex === 0
        ? confirmationFixture(action)
        : {
            toolName: 'mcp:clinic:book_appointment',
            status: 'success',
            input: action,
            output: { structuredContent: { status: 'confirmado', date: '2026-07-03', time: '09:00' } },
          },
    },
    turns: [
      {
        customerMessage: 'quero agendar consulta em 03/07/2026 as 09h',
        expect: {
          customerNeed: 'generic_external_action',
          expectedNextAction: 'require_confirmation',
          pendingConfirmationTool: 'mcp:clinic:book_appointment',
          responseIncludes: ['confirmacao explicita'],
        },
      },
      {
        customerMessage: 'confirmo',
        expect: {
          confirmedTool: 'mcp:clinic:book_appointment',
          pendingConfirmationTool: null,
          responseIncludes: ['confirmado'],
          maxToolExecutions: 1,
        },
      },
    ],
  },
  {
    id: 'gate_cancel_abort',
    title: 'Cliente desiste de cancelamento',
    enabledToolNames: ['mcp:commerce:cancel_order'],
    toolCatalog: catalog,
    toolFixtures: {
      'mcp:commerce:cancel_order': ({ action }) => confirmationFixture(action),
    },
    turns: [
      {
        customerMessage: 'cancele o pedido AB1234',
        expect: {
          customerNeed: 'generic_external_action',
          pendingConfirmationTool: 'mcp:commerce:cancel_order',
        },
      },
      {
        customerMessage: 'melhor nao',
        expect: {
          executedToolsExclude: ['mcp:commerce:cancel_order'],
          pendingConfirmationTool: null,
          confirmedTool: null,
          responseIncludes: ['cancelada', 'nao sera executada'],
          maxToolExecutions: 0,
        },
      },
    ],
  },
  {
    id: 'gate_dynamic_schema',
    title: 'Schema MCP proprio coletado em multiplos turnos',
    enabledToolNames: ['mcp:logistics:schedule_pickup'],
    toolCatalog: catalog,
    toolFixtures: {
      'mcp:logistics:schedule_pickup': ({ action, turnIndex }) => turnIndex === 1
        ? confirmationFixture(action)
        : {
            toolName: 'mcp:logistics:schedule_pickup',
            status: 'success',
            input: action,
            output: { structuredContent: { status: 'coleta agendada', package_code: 'CX-77' } },
          },
    },
    turns: [
      {
        customerMessage: 'quero agendar uma coleta logistica',
        expect: {
          customerNeed: 'generic_external_action',
          expectedNextAction: 'ask_slot',
          missingInputFieldsInclude: ['package_code', 'pickup_window'],
          executedToolsExclude: ['mcp:logistics:schedule_pickup'],
          maxToolExecutions: 0,
        },
      },
      {
        customerMessage: 'package_code: CX-77; pickup_window: 14h as 18h',
        expect: {
          expectedNextAction: 'require_confirmation',
          pendingConfirmationTool: 'mcp:logistics:schedule_pickup',
          executedToolsInclude: ['mcp:logistics:schedule_pickup'],
        },
      },
      {
        customerMessage: 'confirmo',
        expect: {
          confirmedTool: 'mcp:logistics:schedule_pickup',
          pendingConfirmationTool: null,
          responseIncludes: ['coleta agendada', 'CX-77'],
          maxToolExecutions: 1,
        },
      },
    ],
  },
  {
    id: 'gate_wifi_credentials',
    title: 'Credenciais Wi-Fi validadas sem reboot',
    enabledToolNames: [
      'sgp_fetch_contact_panel_data',
      'mcp:router:get_wifi_view',
      'mcp:router:reboot_router',
    ],
    toolCatalog: catalog,
    toolFixtures: {
      sgp_fetch_contact_panel_data: ({ action }) => ({
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: action,
        output: {
          cpfCnpj: '52998224725',
          contracts: [{ id: '10', ip: '192.0.2.10', connectionStatus: 'online' }],
        },
      }),
      'mcp:router:get_wifi_view': ({ action }) => ({
        toolName: 'mcp:router:get_wifi_view',
        status: 'success',
        input: action,
        output: { structuredContent: { ssid: 'Rede Cliente', username: 'cliente', password: 'senha-teste' } },
      }),
    },
    turns: [
      {
        customerMessage: 'esqueci o usuario e a senha do Wi-Fi',
        expect: {
          customerNeed: 'wifi_credentials_lookup',
          expectedNextAction: 'ask_slot',
          executedToolsExclude: ['mcp:router:reboot_router'],
          maxToolExecutions: 0,
        },
      },
      {
        customerMessage: 'CPF 529.982.247-25',
        expect: {
          executedToolsInclude: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
          executedToolsExclude: ['mcp:router:reboot_router'],
          responseIncludes: ['Rede Cliente', 'senha-teste'],
          maxToolExecutions: 2,
        },
      },
    ],
  },
];

describe('autopilot declarative E2E quality gate', () => {
  it('requires perfect invariants, assertions and cross-niche capability coverage', () => {
    const result = runAutopilotConversationSuite({
      scenarios,
      requirements: {
        minimumQualityScore: 1,
        customerNeeds: [
          'generic_external_lookup',
          'generic_external_action',
          'order_status_lookup',
          'wifi_credentials_lookup',
        ],
        executedToolNames: [
          'mcp:commerce:list_products',
          'mcp:commerce:get_order_status',
          'mcp:commerce:cancel_order',
          'mcp:clinic:book_appointment',
          'mcp:logistics:schedule_pickup',
          'sgp_fetch_contact_panel_data',
          'mcp:router:get_wifi_view',
        ],
      },
    });

    expect(result.violations).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.scenarioCount).toBe(6);
    expect(result.turnCount).toBe(11);
    expect(result.assertionsTotal).toBeGreaterThanOrEqual(40);
    expect(result.qualityScore).toBe(1);
  });

  it('fails closed when required niche or tool coverage is absent', () => {
    const result = runAutopilotConversationSuite({
      scenarios: scenarios.slice(0, 1),
      requirements: {
        minimumQualityScore: 1,
        customerNeeds: ['wifi_credentials_lookup'],
        executedToolNames: ['mcp:router:get_wifi_view'],
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain('coverage_missing_customer_need:wifi_credentials_lookup');
    expect(result.violations).toContain('coverage_missing_executed_tool:mcp:router:get_wifi_view');
  });
});
