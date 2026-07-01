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
  const sideEffect = input.sideEffect || 'none';
  return {
    name: input.name as AgentToolCatalogItem['name'],
    version: isMcp ? 'mcp' : 'builtin',
    description: input.description,
    class: sideEffect === 'none' ? 'retrieval' : 'write_non_idempotent',
    riskLevel: input.riskLevel || (sideEffect === 'none' ? 'low' : 'medium'),
    sideEffect,
    idempotent: sideEffect === 'none',
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: [
      'order_or_request_status',
      'support_request',
      'troubleshooting',
      'scheduling_request',
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

function result(input: {
  action: AgentToolAction;
  toolName: string;
  status: AgentToolExecutionResult['status'];
  output?: Record<string, unknown>;
  error?: string;
}): AgentToolExecutionResult {
  return {
    toolName: input.toolName as AgentToolExecutionResult['toolName'],
    status: input.status,
    input: input.action,
    output: input.output,
    error: input.error,
  };
}

function confirmationRequired(action: AgentToolAction, toolName: string): AgentToolExecutionResult {
  return result({
    action,
    toolName,
    status: 'rejected',
    error: '[tool_policy:confirmation_required] Confirmacao necessaria.',
  });
}

const tools = {
  orderStatus: 'mcp:commerce:get_order_status',
  wifiView: 'mcp:router:get_wifi_view',
  reboot: 'mcp:router:reboot_router',
  schedulePickup: 'mcp:logistics:schedule_pickup',
} as const;

const catalog = [
  tool({
    name: 'sgp_fetch_contact_panel_data',
    description: 'Consulta cadastro, contratos e IPv4 do cliente.',
  }),
  tool({
    name: tools.orderStatus,
    description: 'Consulta status e rastreio de pedido sem altera-lo.',
    inputSchema: {
      type: 'object',
      required: ['order_id'],
      properties: { order_id: { type: 'string' } },
    },
  }),
  tool({
    name: tools.wifiView,
    description: 'Consulta SSID, usuario e senha atuais do Wi-Fi.',
    inputSchema: {
      type: 'object',
      required: ['client_ip'],
      properties: { client_ip: { type: 'string' } },
    },
  }),
  tool({
    name: tools.reboot,
    description: 'Reinicia o roteador e interrompe temporariamente a conexao.',
    sideEffect: 'high',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      required: ['client_ip'],
      properties: { client_ip: { type: 'string' } },
    },
  }),
  tool({
    name: tools.schedulePickup,
    description: 'Agenda uma coleta logistica para o pacote e janela informados.',
    sideEffect: 'medium',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      required: ['package_code', 'pickup_window'],
      properties: {
        package_code: { type: 'string' },
        pickup_window: { type: 'string' },
      },
    },
  }),
] satisfies AgentToolCatalogItem[];

const scenarios: AutopilotConversationScenario[] = [
  {
    id: 'readonly_timeout_retry',
    title: 'Consulta read-only falha sem loop e aceita retry explicito',
    enabledToolNames: [tools.orderStatus],
    toolCatalog: catalog,
    toolFixtures: {
      [tools.orderStatus]: ({ action }) => result({
        action,
        toolName: tools.orderStatus,
        status: 'error',
        error: 'connect timeout',
      }),
    },
    turns: [
      {
        customerMessage: 'Qual o status do pedido AB1234?',
        expect: {
          executedToolsInclude: [tools.orderStatus],
          responseIncludes: ['nao consegui'],
          maxToolExecutions: 1,
        },
      },
      {
        customerMessage: 'E ai?',
        expect: {
          executedToolsExclude: [tools.orderStatus],
          responseIncludes: ['verificar manualmente'],
          maxToolExecutions: 0,
        },
      },
      {
        customerMessage: 'Pode tentar novamente agora?',
        expect: {
          executedToolsInclude: [tools.orderStatus],
          maxToolExecutions: 1,
        },
      },
    ],
  },
  {
    id: 'wifi_chain_recovery',
    title: 'Wi-Fi falha depois do SGP sem cair em reboot',
    enabledToolNames: ['sgp_fetch_contact_panel_data', tools.wifiView, tools.reboot],
    toolCatalog: catalog,
    toolFixtures: {
      sgp_fetch_contact_panel_data: ({ action }) => result({
        action,
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        output: {
          cpfCnpj: '52998224725',
          contracts: [{ id: '10', ip: '192.0.2.10', connectionStatus: 'online' }],
        },
      }),
      [tools.wifiView]: ({ action, turnIndex }) => turnIndex < 2
        ? result({
            action,
            toolName: tools.wifiView,
            status: 'error',
            error: 'MCP unavailable',
          })
        : result({
            action,
            toolName: tools.wifiView,
            status: 'success',
            output: {
              structuredContent: {
                ssid: 'Rede Recuperada',
                username: 'cliente',
                password: 'senha-recuperada',
              },
            },
          }),
    },
    turns: [
      {
        customerMessage: 'Esqueci usuario e senha do Wi-Fi. CPF 52998224725.',
        expect: {
          executedToolsInclude: ['sgp_fetch_contact_panel_data', tools.wifiView],
          executedToolsExclude: [tools.reboot],
          responseIncludes: ['validei o cadastro', 'nao consegui'],
          maxToolExecutions: 2,
        },
      },
      {
        customerMessage: 'E ai?',
        expect: {
          executedToolsExclude: [tools.wifiView, tools.reboot],
          responseIncludes: ['verificar manualmente'],
          maxToolExecutions: 0,
        },
      },
      {
        customerMessage: 'Tente de novo',
        expect: {
          executedToolsInclude: [tools.wifiView],
          executedToolsExclude: [tools.reboot],
          responseIncludes: ['Rede Recuperada', 'senha-recuperada'],
          maxToolExecutions: 1,
        },
      },
    ],
  },
  {
    id: 'write_failure_reconfirmation',
    title: 'Escrita falha sem retry autonomo e exige nova confirmacao',
    enabledToolNames: [tools.schedulePickup],
    toolCatalog: catalog,
    toolFixtures: {
      [tools.schedulePickup]: ({ action, turnIndex }) => {
        if (turnIndex === 1 || turnIndex === 4) {
          return confirmationRequired(action, tools.schedulePickup);
        }
        if (turnIndex === 2) {
          return result({
            action,
            toolName: tools.schedulePickup,
            status: 'error',
            error: 'upstream timeout after dispatch uncertainty',
          });
        }
        return result({
          action,
          toolName: tools.schedulePickup,
          status: 'success',
          output: {
            structuredContent: {
              status: 'coleta agendada',
              package_code: 'CX-77',
            },
          },
        });
      },
    },
    turns: [
      {
        customerMessage: 'Quero agendar uma coleta logistica',
        expect: {
          expectedNextAction: 'ask_slot',
          missingInputFieldsInclude: ['package_code', 'pickup_window'],
          executedToolsExclude: [tools.schedulePickup],
          pendingConfirmationTool: null,
          maxToolExecutions: 0,
        },
      },
      {
        customerMessage: 'package_code: CX-77; pickup_window: 14h as 18h',
        expect: {
          pendingConfirmationTool: tools.schedulePickup,
          maxToolExecutions: 1,
        },
      },
      {
        customerMessage: 'Confirmo',
        expect: {
          confirmedTool: tools.schedulePickup,
          pendingConfirmationTool: null,
          responseIncludes: ['nao consegui executar', 'nao vou repeti'],
          maxToolExecutions: 1,
        },
      },
      {
        customerMessage: 'Sim',
        expect: {
          executedToolsExclude: [tools.schedulePickup],
          responseIncludes: ['nao vou repeti'],
          pendingConfirmationTool: null,
          maxToolExecutions: 0,
        },
      },
      {
        customerMessage: 'Pode tentar novamente agora?',
        expect: {
          expectedNextAction: 'require_confirmation',
          pendingConfirmationTool: tools.schedulePickup,
          maxToolExecutions: 1,
        },
      },
      {
        customerMessage: 'Confirmo',
        expect: {
          confirmedTool: tools.schedulePickup,
          pendingConfirmationTool: null,
          responseIncludes: ['coleta agendada', 'CX-77'],
          maxToolExecutions: 1,
        },
      },
    ],
  },
];

describe('autopilot failure recovery matrix', () => {
  it('recovers across read, chained lookup and write scenarios without autonomous loops', () => {
    const suite = runAutopilotConversationSuite({
      scenarios,
      requirements: {
        minimumQualityScore: 1,
        customerNeeds: [
          'order_status_lookup',
          'wifi_credentials_lookup',
          'generic_external_action',
        ],
        executedToolNames: [
          tools.orderStatus,
          'sgp_fetch_contact_panel_data',
          tools.wifiView,
          tools.schedulePickup,
        ],
      },
    });

    expect(suite.violations).toEqual([]);
    expect(suite.passed).toBe(true);
    expect(suite.scenarioCount).toBe(3);
    expect(suite.turnCount).toBe(12);
    expect(suite.assertionsTotal).toBeGreaterThanOrEqual(40);
    expect(suite.qualityScore).toBe(1);
    expect(suite.coveredToolNames).not.toContain(tools.reboot);
  });
});
