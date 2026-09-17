import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { db } from 'c:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/lib/db';
import {
  AgentStudioDocumentSchema,
  AgentReleaseManifestSchema,
  type AgentStudioDocument,
  type AgentReleaseManifest,
  type ProcedureDocument,
} from 'c:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/services/agent-studio/types';
import { validateAgentForPublication } from 'c:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/services/agent-studio/assistant-validator';
import { resolveStudioMcpTool } from 'c:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/services/agent-studio/integrations';
import { compileStudioReasoningCapabilities } from 'c:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/services/agent-studio/reasoning-capabilities';

async function main() {
  const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
  const agentId = '7d7259ab-a6c3-4057-a9ca-28ddbb15db95';
  const userId = '8fe1f4da-9305-475c-95d1-83bda9f29b22';
  const mcpServerId = '8171892c-827b-4216-a631-02839d36af85';
  const supportTeamId = 'b9a74d62-7f65-46c1-a5ae-4887fde9926e';
  const salesTeamId = 'b3b71514-098f-49fa-b922-f38a40065ef6';
  const financeTeamId = 'e4991d0b-917c-42e7-8cde-014b0bdf5bb8';
  const nextVersion = 64;

  console.log(`========================================================================`);
  console.log(`=== PUBLICANDO LUCAS V${nextVersion}: TRIAGEM OBRIGATÓRIA DE CPF E CONTRATO ===`);
  console.log(`========================================================================`);

  function createCpfStep(procPrefix: string, order: number) {
    return {
      id: `step_${procPrefix}_cpf`,
      order,
      type: 'collect_data' as const,
      title: 'Confirmar CPF ou CNPJ do titular',
      collectField: {
        id: `field_${procPrefix}_cpf`,
        name: 'CPF ou CNPJ do titular',
        variableKey: 'customer_cpf',
        type: 'cpf_cnpj' as const,
        promptMessage: 'Para iniciarmos o atendimento e localizarmos a sua conexão com precisão, por favor informe o CPF ou CNPJ do titular do contrato:',
        errorMessage: 'Por favor, informe um CPF ou CNPJ válido com apenas os números.',
        required: true,
        maxAttempts: 3,
        requiresConfirmation: false,
        isSensitive: true,
      }
    };
  }

  function createContractStep(procPrefix: string, order: number) {
    return {
      id: `step_${procPrefix}_contract`,
      order,
      type: 'collect_data' as const,
      title: 'Confirmar contrato ou endereço',
      collectField: {
        id: `field_${procPrefix}_contract`,
        name: 'Número do contrato ou endereço',
        variableKey: 'customer_contract',
        type: 'text' as const,
        promptMessage: 'Qual é o número do contrato ou o endereço da instalação onde está o roteador? (Se tiver apenas um contrato, pode responder com o endereço ou apenas "único"):',
        errorMessage: 'Por favor, informe o endereço ou número do contrato.',
        required: true,
        maxAttempts: 3,
        requiresConfirmation: false,
        isSensitive: false,
      }
    };
  }

  // Build Procedures
  const procedures: ProcedureDocument[] = [
    // 1. Sem internet ou luz vermelha
    {
      id: 'a1000001-0000-4000-8000-000000000001',
      name: 'Diagnóstico de Sem Internet e Fibra Óptica',
      description: 'Diagnóstico técnico para falta total de conexão, luz LOS vermelha ou falha física de fibra.',
      objective: 'Localizar CPE do cliente no ACS, medir potência óptica Rx/Tx em dBm, verificar status WAN e identificar rompimento ou queda física.',
      priority: 200,
      whenToUse: 'Quando o cliente relatar queda total de conexão, luz LOS vermelha acesa, fibra rompida ou todos os aparelhos sem sinal.',
      whenNotToUse: 'Não usar para lentidão em aparelho isolado ou dúvidas de fatura.',
      triggerKeywords: ['sem internet', 'caiu a internet', 'luz vermelha', 'luz los', 'los vermelha', 'sem sinal', 'fibra rompida', 'nao conecta', 'fora do ar'],
      exampleRequests: ['Estou sem internet', 'A luz LOS está vermelha', 'Todos os aparelhos ficaram sem conexão', 'Minha internet caiu'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('sem_int', 1),
        createContractStep('sem_int', 2),
        {
          id: 'step_sem_int_list',
          order: 3,
          type: 'mcp_tool_call',
          title: 'Localizar roteador CPE no ACS',
          subtitle: 'Busca o identificador do equipamento do cliente',
          adaptiveAccess: { enabled: true, requiresSteps: [] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:list_routers`,
            friendlyToolName: 'Localizar roteador do cliente',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'limit', sourceType: 'static_value', sourceChipKey: '5', sourceChipLabel: 'Limite', valueType: 'number' }
            ],
            outputMappings: [
              { jsonPath: '[0].ID', chipKey: 'device_id', chipLabel: 'ID do Equipamento CPE', required: true },
              { jsonPath: '[0].PrimarySSID', chipKey: 'primary_ssid', chipLabel: 'Wi-Fi Principal', required: false },
              { jsonPath: '[0].IPAddress', chipKey: 'ip_address', chipLabel: 'Endereço IP', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_sem_int_details',
          order: 4,
          type: 'mcp_tool_call',
          title: 'Medir sinal óptico e status WAN',
          subtitle: 'Verifica atenuação óptica Rx/Tx dBm e status físico',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_sem_int_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:get_router_details`,
            friendlyToolName: 'Medir sinal óptico do roteador',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'device_id', sourceChipLabel: 'ID do Equipamento CPE', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'OpticalPower.RxPowerdBm', chipKey: 'rx_dbm', chipLabel: 'Potência Óptica Rx', required: false },
              { jsonPath: 'OpticalPower.Status', chipKey: 'optical_status', chipLabel: 'Status da Fibra', required: false },
              { jsonPath: 'UptimeSeconds', chipKey: 'uptime_seconds', chipLabel: 'Tempo Ligado', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_sem_int_reply',
          order: 5,
          type: 'respond',
          title: 'Informar diagnóstico da fibra',
          messageText: 'Diagnóstico da conexão realizado com sucesso. Analisamos o status óptico do seu roteador para verificar se há falha física na fibra ou se a conexão está operando normalmente.'
        },
        {
          id: 'step_sem_int_handoff',
          order: 6,
          type: 'handoff',
          title: 'Transferir ao Suporte Técnico',
          handoffTeam: supportTeamId,
          handoffReason: 'Falha física na fibra, atenuação fora do padrão ou problema persistente sem internet.'
        }
      ]
    },

    // 2. Lentidão e alcance do Wi-Fi
    {
      id: 'a1000001-0000-4000-8000-000000000002',
      name: 'Diagnóstico de Lentidão e Alcance Wi-Fi',
      description: 'Investigação detalhada de lentidão de navegação, sinal sem fio fraco nos cômodos e interferência RF.',
      objective: 'Analisar rádios 2.4G/5G, clientes conectados, sinal RSSI e varredura de espectro RF dos vizinhos.',
      priority: 190,
      whenToUse: 'Quando o cliente reclamar de internet lenta, travamentos, sinal fraco no quarto ou baixa velocidade.',
      whenNotToUse: 'Não usar para queda total com luz LOS vermelha.',
      triggerKeywords: ['internet lenta', 'lentidao', 'wifi lento', 'sinal fraco', 'travando', 'carregando devagar', 'velocidade baixa', 'alcance fraco'],
      exampleRequests: ['Meu Wi-Fi está muito lento', 'A internet está fraca no quarto', 'Os vídeos estão travando', 'Minha velocidade está baixa'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('lent', 1),
        createContractStep('lent', 2),
        {
          id: 'step_lent_list',
          order: 3,
          type: 'mcp_tool_call',
          title: 'Localizar roteador para análise de lentidão',
          adaptiveAccess: { enabled: true, requiresSteps: [] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:list_routers`,
            friendlyToolName: 'Localizar roteador',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'limit', sourceType: 'static_value', sourceChipKey: '5', sourceChipLabel: 'Limite', valueType: 'number' }
            ],
            outputMappings: [
              { jsonPath: '[0].ID', chipKey: 'lent_device_id', chipLabel: 'ID do Equipamento', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_lent_details',
          order: 4,
          type: 'mcp_tool_call',
          title: 'Medir sinal óptico da conexão lenta',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_lent_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:get_router_details`,
            friendlyToolName: 'Medir sinal óptico',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'lent_device_id', sourceChipLabel: 'ID do Equipamento', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'OpticalPower.RxPowerdBm', chipKey: 'lent_rx_dbm', chipLabel: 'Potência Rx', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_lent_wifi',
          order: 5,
          type: 'mcp_tool_call',
          title: 'Verificar canais e frequências Wi-Fi',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_lent_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:get_wifi_diagnostics`,
            friendlyToolName: 'Diagnóstico de Wi-Fi',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'lent_device_id', sourceChipLabel: 'ID do Equipamento', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'Radios[0].Channel', chipKey: 'lent_wifi_channel', chipLabel: 'Canal Wi-Fi', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_lent_clients',
          order: 6,
          type: 'mcp_tool_call',
          title: 'Analisar aparelhos conectados e sinal RSSI',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_lent_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:list_connected_clients`,
            friendlyToolName: 'Listar aparelhos conectados',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'lent_device_id', sourceChipLabel: 'ID do Equipamento', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'TotalCount', chipKey: 'lent_clients_count', chipLabel: 'Total de Aparelhos', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_lent_spectrum',
          order: 7,
          type: 'mcp_tool_call',
          title: 'Escanear espectro RF e redes vizinhas',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_lent_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:scan_wifi_spectrum`,
            friendlyToolName: 'Varredura de espectro RF',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'lent_device_id', sourceChipLabel: 'ID do Equipamento', valueType: 'text' },
              { argumentName: 'use_cached', sourceType: 'static_value', sourceChipKey: 'true', sourceChipLabel: 'Usar Cache', valueType: 'boolean' }
            ],
            outputMappings: [
              { jsonPath: 'Count', chipKey: 'lent_neighbors_count', chipLabel: 'Redes Vizinhas', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_lent_reply',
          order: 8,
          type: 'respond',
          title: 'Apresentar diagnóstico de lentidão',
          messageText: 'Análise de sinal, interferência e clientes conectados realizada com sucesso.'
        },
        {
          id: 'step_lent_handoff',
          order: 9,
          type: 'handoff',
          title: 'Transferir ao Suporte Técnico',
          handoffTeam: supportTeamId,
          handoffReason: 'Lentidão persistente após validação de canal, alcance e dispositivos conectados.'
        }
      ]
    },

    // 3. Quedas e instabilidade
    {
      id: 'a1000001-0000-4000-8000-000000000003',
      name: 'Diagnóstico de Quedas e Intermitência',
      description: 'Análise de instabilidade contínua, quedas periódicas de conexão e oscilações na rede.',
      objective: 'Verificar uptime do roteador, histórico de inform, estabilidade do enlace WAN e rádios Wi-Fi.',
      priority: 180,
      whenToUse: 'Quando a conexão fica caindo e voltando, desconecta em horários específicos ou o sinal oscila.',
      whenNotToUse: 'Não usar quando a queda for permanente por rompimento de fibra.',
      triggerKeywords: ['caindo e voltando', 'fica caindo', 'intermitente', 'instavel', 'desconecta toda hora', 'caindo muito', 'instabilidade'],
      exampleRequests: ['A internet fica caindo e voltando toda hora', 'Desconecta e volta sozinho', 'Está oscilando muito'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('interm', 1),
        createContractStep('interm', 2),
        {
          id: 'step_interm_list',
          order: 3,
          type: 'mcp_tool_call',
          title: 'Localizar roteador para análise de quedas',
          adaptiveAccess: { enabled: true, requiresSteps: [] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:list_routers`,
            friendlyToolName: 'Localizar roteador',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'limit', sourceType: 'static_value', sourceChipKey: '5', sourceChipLabel: 'Limite', valueType: 'number' }
            ],
            outputMappings: [
              { jsonPath: '[0].ID', chipKey: 'interm_device_id', chipLabel: 'ID Equipamento', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_interm_details',
          order: 4,
          type: 'mcp_tool_call',
          title: 'Verificar uptime e status WAN do equipamento',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_interm_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:get_router_details`,
            friendlyToolName: 'Verificar uptime e WAN',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'interm_device_id', sourceChipLabel: 'ID Equipamento', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'UptimeSeconds', chipKey: 'interm_uptime', chipLabel: 'Uptime', required: false },
              { jsonPath: 'OpticalPower.Status', chipKey: 'interm_optical_status', chipLabel: 'Status Óptico', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_interm_wifi',
          order: 5,
          type: 'mcp_tool_call',
          title: 'Verificar estabilidade dos rádios Wi-Fi',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_interm_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:get_wifi_diagnostics`,
            friendlyToolName: 'Diagnóstico Wi-Fi',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'interm_device_id', sourceChipLabel: 'ID Equipamento', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'Radios[0].Enabled', chipKey: 'interm_radio_enabled', chipLabel: 'Rádio Ativo', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_interm_reply',
          order: 6,
          type: 'respond',
          title: 'Apresentar análise de estabilidade',
          messageText: 'Diagnóstico de instabilidade e histórico de conexão verificado com sucesso.'
        },
        {
          id: 'step_interm_handoff',
          order: 7,
          type: 'handoff',
          title: 'Transferir ao Suporte Técnico',
          handoffTeam: supportTeamId,
          handoffReason: 'Intermitência contínua ou oscilação persistente na conexão.'
        }
      ]
    },

    // 4. Um aparelho, aplicativo ou jogo
    {
      id: 'a1000001-0000-4000-8000-000000000004',
      name: 'Diagnóstico de Aparelho, Jogo ou Aplicativo Isolado',
      description: 'Diagnóstico focado em problemas que afetam apenas uma Smart TV, console de jogos, streaming ou PC.',
      objective: 'Verificar conexão local do aparelho específico, intensidade do sinal e orientar teste no app.',
      priority: 170,
      whenToUse: 'Quando a queixa for sobre apenas um aparelho (só a TV), jogo com lag/ping alto ou app que não abre.',
      whenNotToUse: 'Não usar se a casa inteira estiver sem sinal.',
      triggerKeywords: ['so na televisao', 'so na tv', 'youtube nao abre', 'ping alto', 'jogo com lag', 'so no celular', 'aparelho especifico', 'netflix nao carrega'],
      exampleRequests: ['Só a televisão não conecta', 'Meu jogo está com ping alto', 'O YouTube não abre na TV'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('app', 1),
        createContractStep('app', 2),
        {
          id: 'step_app_list',
          order: 3,
          type: 'mcp_tool_call',
          title: 'Localizar roteador da residência',
          adaptiveAccess: { enabled: true, requiresSteps: [] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:list_routers`,
            friendlyToolName: 'Localizar roteador',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'limit', sourceType: 'static_value', sourceChipKey: '5', sourceChipLabel: 'Limite', valueType: 'number' }
            ],
            outputMappings: [
              { jsonPath: '[0].ID', chipKey: 'app_device_id', chipLabel: 'ID Equipamento', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_app_clients',
          order: 4,
          type: 'mcp_tool_call',
          title: 'Verificar aparelho na lista de clientes conectados',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_app_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:list_connected_clients`,
            friendlyToolName: 'Consultar clientes conectados',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'app_device_id', sourceChipLabel: 'ID Equipamento', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'TotalCount', chipKey: 'app_total_clients', chipLabel: 'Clientes Conectados', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_app_reply',
          order: 5,
          type: 'respond',
          title: 'Orientar teste no aparelho',
          messageText: 'Análise do dispositivo e conectividade local realizada. Orientações de reinício do aplicativo e reconexão de rede enviadas.'
        },
        {
          id: 'step_app_handoff',
          order: 6,
          type: 'handoff',
          title: 'Transferir ao Suporte Técnico',
          handoffTeam: supportTeamId,
          handoffReason: 'Falha isolada em aparelho persiste após testes locais.'
        }
      ]
    },

    // 5. Consultar rede Wi-Fi com privacidade
    {
      id: 'a1000001-0000-4000-8000-000000000005',
      name: 'Consulta Segura de Rede Wi-Fi',
      description: 'Consulta das redes sem fio ativas (SSID e frequência) preservando sigilo de senhas.',
      objective: 'Identificar os nomes de rede Wi-Fi configurados no roteador sem expor credenciais.',
      priority: 160,
      whenToUse: 'Quando o cliente perguntar o nome da sua rede Wi-Fi ou quiser confirmar se os rádios estão ativos.',
      whenNotToUse: 'Não usar para troca de nome ou suporte de queda.',
      triggerKeywords: ['qual nome do wifi', 'nome da minha rede', 'qual meu wifi', 'consultar wifi', 'qual e o ssid'],
      exampleRequests: ['Qual o nome da minha rede Wi-Fi?', 'Como está o nome do meu Wi-Fi?'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('cons', 1),
        createContractStep('cons', 2),
        {
          id: 'step_cons_list',
          order: 3,
          type: 'mcp_tool_call',
          title: 'Localizar roteador para consulta de Wi-Fi',
          adaptiveAccess: { enabled: true, requiresSteps: [] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:list_routers`,
            friendlyToolName: 'Localizar roteador',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'limit', sourceType: 'static_value', sourceChipKey: '5', sourceChipLabel: 'Limite', valueType: 'number' }
            ],
            outputMappings: [
              { jsonPath: '[0].ID', chipKey: 'cons_device_id', chipLabel: 'ID Equipamento', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_cons_wifi',
          order: 4,
          type: 'mcp_tool_call',
          title: 'Consultar nomes de rede (SSID)',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_cons_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:get_wifi_diagnostics`,
            friendlyToolName: 'Consultar diagnóstico Wi-Fi',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'cons_device_id', sourceChipLabel: 'ID Equipamento', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'Radios[0].SSID', chipKey: 'cons_ssid_name', chipLabel: 'Nome do Wi-Fi', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_cons_reply',
          order: 5,
          type: 'respond',
          title: 'Apresentar nome da rede Wi-Fi',
          messageText: 'Consulta realizada com sucesso. Informando o nome da rede sem expor senhas sensíveis.'
        },
        {
          id: 'step_cons_handoff',
          order: 6,
          type: 'handoff',
          title: 'Transferir ao Suporte Técnico',
          handoffTeam: supportTeamId,
          handoffReason: 'Cliente solicitou recuperação ou alteração de senha de Wi-Fi.'
        }
      ]
    },

    // 6. Confirmar alteração do nome do Wi-Fi
    {
      id: 'a1000001-0000-4000-8000-000000000006',
      name: 'Alteração de Nome da Rede Wi-Fi (SSID)',
      description: 'Configuração atômica do novo SSID do cliente mediante autorização e aviso prévio de desconexão.',
      objective: 'Coletar o novo nome desejado (1 a 32 caracteres), alertar sobre a desconexão e aplicar o novo SSID via ACS.',
      priority: 165,
      whenToUse: 'Quando o titular solicitar explicitamente a troca do nome da sua rede Wi-Fi.',
      whenNotToUse: 'Não usar para troca de senha ou suporte de queda de conexão.',
      triggerKeywords: ['mudar nome do wifi', 'trocar nome da rede', 'alterar ssid', 'mudar ssid', 'trocar nome do wifi', 'novo nome de wifi'],
      exampleRequests: ['Quero mudar o nome do meu Wi-Fi', 'Pode trocar o nome da minha rede?', 'Quero alterar o SSID'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('alt', 1),
        createContractStep('alt', 2),
        {
          id: 'step_alt_list',
          order: 3,
          type: 'mcp_tool_call',
          title: 'Localizar roteador para alteração de Wi-Fi',
          adaptiveAccess: { enabled: true, requiresSteps: [] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:list_routers`,
            friendlyToolName: 'Localizar roteador',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'limit', sourceType: 'static_value', sourceChipKey: '5', sourceChipLabel: 'Limite', valueType: 'number' }
            ],
            outputMappings: [
              { jsonPath: '[0].ID', chipKey: 'alt_device_id', chipLabel: 'ID Equipamento', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_alt_collect',
          order: 4,
          type: 'collect_data',
          title: 'Coletar novo nome do Wi-Fi',
          collectField: {
            id: 'field_novo_ssid',
            name: 'Novo nome da rede Wi-Fi',
            variableKey: 'novo_nome_wifi',
            type: 'text',
            promptMessage: 'Por favor, digite o novo nome (SSID) que você deseja colocar no seu Wi-Fi (de 1 a 32 caracteres):',
            required: true,
            maxAttempts: 3,
            requiresConfirmation: false,
            isSensitive: false
          }
        },
        {
          id: 'step_alt_config',
          order: 5,
          type: 'mcp_tool_call',
          title: 'Aplicar novo nome de Wi-Fi no roteador',
          subtitle: 'Altera o SSID nas frequências do roteador',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_alt_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:configure_wifi`,
            friendlyToolName: 'Configurar Wi-Fi',
            riskLevel: 'reversible',
            requiresConfirmation: true,
            confirmationPrompt: 'A alteração do nome desconectará os aparelhos até que você conecte no novo Wi-Fi. Confirma a alteração agora?',
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'alt_device_id', sourceChipLabel: 'ID Equipamento', valueType: 'text' },
              { argumentName: 'ssid', sourceType: 'collected_field', sourceChipKey: 'novo_nome_wifi', sourceChipLabel: 'Novo Nome Wi-Fi', valueType: 'text' },
              { argumentName: 'band', sourceType: 'static_value', sourceChipKey: 'both', sourceChipLabel: 'Banda', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'CommandID', chipKey: 'alt_command_id', chipLabel: 'ID Comando', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_alt_status',
          order: 6,
          type: 'mcp_tool_call',
          title: 'Consultar status da alteração de Wi-Fi',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_alt_config'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:get_operation_status`,
            friendlyToolName: 'Consultar status do comando Wi-Fi',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'command_id', sourceType: 'step_output', sourceChipKey: 'alt_command_id', sourceChipLabel: 'ID Comando', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'Status', chipKey: 'alt_op_status', chipLabel: 'Status da Operação', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_alt_reply',
          order: 7,
          type: 'respond',
          title: 'Confirmar alteração de nome do Wi-Fi',
          messageText: 'Nome da rede Wi-Fi alterado com sucesso! Lembre-se de reconectar seus celulares, computadores e televisores no novo nome de rede.'
        },
        {
          id: 'step_alt_handoff',
          order: 8,
          type: 'handoff',
          title: 'Transferir ao Suporte Técnico',
          handoffTeam: supportTeamId,
          handoffReason: 'Falha ou necessidade de suporte após alteração de Wi-Fi.'
        }
      ]
    },

    // 7. Confirmar reinício do roteador
    {
      id: 'a1000001-0000-4000-8000-000000000007',
      name: 'Reinício Remoto Auditado do Roteador',
      description: 'Reinício preventivo e auditado da CPE mediante confirmação explícita prévia.',
      objective: 'Avisar sobre a interrupção temporária, obter consentimento e executar reboot remoto com segurança.',
      priority: 175,
      whenToUse: 'Quando indicado tecnicamente após testes orientados ou quando o cliente pedir para reiniciar a conexão.',
      whenNotToUse: 'Não usar quando houver falha física evidente (LOS vermelha/fibra rompida) nem reiniciar repetidas vezes.',
      triggerKeywords: ['reiniciar roteador', 'reinicia meu roteador', 'pode reiniciar', 'dar reboot', 'reiniciar conexao', 'resetar conexao'],
      exampleRequests: ['Pode reiniciar meu roteador?', 'Quero reiniciar a conexão', 'Reinicia aí para ver se volta'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('reboot', 1),
        createContractStep('reboot', 2),
        {
          id: 'step_reboot_list',
          order: 3,
          type: 'mcp_tool_call',
          title: 'Localizar roteador para reinício',
          adaptiveAccess: { enabled: true, requiresSteps: [] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:list_routers`,
            friendlyToolName: 'Localizar roteador',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'limit', sourceType: 'static_value', sourceChipKey: '5', sourceChipLabel: 'Limite', valueType: 'number' }
            ],
            outputMappings: [
              { jsonPath: '[0].ID', chipKey: 'reboot_device_id', chipLabel: 'ID Equipamento', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_reboot_exec',
          order: 4,
          type: 'mcp_tool_call',
          title: 'Executar reinício remoto auditado',
          subtitle: 'Reinicia o equipamento após consentimento do cliente',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_reboot_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:reboot_router`,
            friendlyToolName: 'Reiniciar roteador',
            riskLevel: 'reversible',
            requiresConfirmation: true,
            confirmationPrompt: 'O reinício vai interromper a conexão por alguns minutos e pode afetar chamadas ou outros aparelhos. Posso reiniciar agora?',
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'reboot_device_id', sourceChipLabel: 'ID Equipamento', valueType: 'text' },
              { argumentName: 'confirm', sourceType: 'static_value', sourceChipKey: 'true', sourceChipLabel: 'Confirmar', valueType: 'boolean' },
              { argumentName: 'reason', sourceType: 'static_value', sourceChipKey: 'Reinício preventivo solicitado no atendimento de suporte técnico', sourceChipLabel: 'Motivo', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'CommandID', chipKey: 'reboot_cmd_id', chipLabel: 'ID Comando Reboot', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_reboot_status',
          order: 5,
          type: 'mcp_tool_call',
          title: 'Consultar status do comando de reinício',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_reboot_exec'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:get_operation_status`,
            friendlyToolName: 'Consultar status do reinício',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'command_id', sourceType: 'step_output', sourceChipKey: 'reboot_cmd_id', sourceChipLabel: 'ID Comando Reboot', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'Status', chipKey: 'reboot_op_status', chipLabel: 'Status da Operação', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_reboot_reply',
          order: 6,
          type: 'respond',
          title: 'Avisar sobre reinício em andamento',
          messageText: 'Comando de reinício enviado com sucesso ao roteador. A conexão retornará em alguns instantes. Assim que as luzes estabilizarem, por favor me informe se voltou a navegar!'
        },
        {
          id: 'step_reboot_handoff',
          order: 7,
          type: 'handoff',
          title: 'Transferir ao Suporte Técnico',
          handoffTeam: supportTeamId,
          handoffReason: 'Conexão não restabelecida após reinício do equipamento.'
        }
      ]
    },

    // 8. Falar com suporte humano
    {
      id: 'a1000001-0000-4000-8000-000000000008',
      name: 'Transferência para Suporte Humano',
      description: 'Encaminhamento imediato ao time de suporte técnico humano sem novos testes ou insistência.',
      objective: 'Transferir com agilidade o atendimento para a fila do Suporte com registro de contexto prévio.',
      priority: 195,
      whenToUse: 'Quando o cliente solicitar atendente humano, pessoa ou manifestar que não quer mais falar com a IA.',
      whenNotToUse: 'Não usar quando o cliente fizer uma pergunta técnica que pode ser diagnosticada.',
      triggerKeywords: ['atendente', 'falar com humano', 'atendente humano', 'falar com pessoa', 'suporte humano', 'passa para alguem', 'atendente por favor'],
      exampleRequests: ['Quero falar com um atendente', 'Me transfira para uma pessoa', 'Não quero mais fazer testes'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        {
          id: 'step_hum_msg',
          order: 1,
          type: 'message',
          title: 'Avisar sobre transferência humana',
          messageText: 'Com certeza! Vou te transferir agora mesmo para a nossa equipe de Suporte Especializado dar continuidade ao seu atendimento.'
        },
        {
          id: 'step_hum_handoff',
          order: 2,
          type: 'handoff',
          title: 'Transferir para o Suporte',
          handoffTeam: supportTeamId,
          handoffReason: 'Cliente solicitou atendimento com especialista humano.'
        }
      ]
    },

    // 9. Financeiro, comercial ou visita (outro setor)
    {
      id: 'a1000001-0000-4000-8000-000000000009',
      name: 'Encaminhamento Comercial ou Financeiro',
      description: 'Direcionamento correto de assuntos não técnicos para as equipes Financeira ou Comercial.',
      objective: 'Encaminhar pedidos de 2ª via de boleto/PIX para o Financeiro e novas contratações/mudança de plano para o Comercial.',
      priority: 185,
      whenToUse: 'Quando o cliente pedir boleto, fatura, código de barras, PIX, contratação de novos planos ou visita técnica.',
      whenNotToUse: 'Não usar para suporte técnico de conexão.',
      triggerKeywords: ['segunda via', 'boleto', 'fatura', 'pagamento', 'pix da fatura', 'contratar plano', 'novo plano', 'comercial', 'financeiro'],
      exampleRequests: ['Quero a segunda via da fatura', 'Me manda o PIX do boleto', 'Quero contratar mais velocidade'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        {
          id: 'step_outro_decision',
          order: 1,
          type: 'decision',
          title: 'Identificar setor correto',
          decisionBranches: [
            {
              id: 'branch_fin',
              conditionLabel: 'Cliente solicitou atendimento financeiro, fatura, boleto ou PIX',
              actionType: 'handoff',
              actionValue: financeTeamId
            },
            {
              id: 'branch_com',
              conditionLabel: 'Cliente solicitou contratação de novo plano ou atendimento comercial',
              actionType: 'handoff',
              actionValue: salesTeamId
            },
            {
              id: 'branch_sup_def',
              conditionLabel: 'Demais solicitações ou visita técnica',
              isDefault: true,
              actionType: 'handoff',
              actionValue: supportTeamId
            }
          ]
        }
      ]
    },

    // 10. Encerramento resolvido
    {
      id: 'a1000001-0000-4000-8000-000000000010',
      name: 'Encerramento de Atendimento Concluído',
      description: 'Encerramento seguro do atendimento após confirmação de resolução do cliente.',
      objective: 'Finalizar a conversa no Dialogy com cortesia após confirmação do cliente.',
      priority: 150,
      whenToUse: 'Quando o cliente confirmar que a conexão voltou ao normal, que o teste funcionou ou pedir para encerrar.',
      whenNotToUse: 'Nunca usar se o cliente ainda relatar falha, lentidão ou dúvida pendente.',
      triggerKeywords: ['voltou a internet', 'ja resolveu', 'esta funcionando', 'ficou bom', 'pode encerrar', 'obrigado deu certo', 'tudo resolvido'],
      exampleRequests: ['Voltou aqui, obrigado!', 'Já está funcionando normalmente', 'Deu certo, pode finalizar'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        {
          id: 'step_encerrar_close',
          order: 1,
          type: 'native_action',
          title: 'Encerrar conversa no sistema',
          subtitle: 'Finaliza o atendimento resolvido',
          nativeActionType: 'close_chat',
          adaptiveAccess: { enabled: true, requiresSteps: [] }
        }
      ]
    },

    // 11. Consulta a manuais técnicos MCP
    {
      id: 'a1000001-0000-4000-8000-000000000011',
      name: 'Consulta de Manuais Técnicos MCP',
      description: 'Consulta do manual técnico oficial das ferramentas TR-069 e parâmetros operacionais.',
      objective: 'Recuperar especificações técnicas e parâmetros de ferramentas MCP para apoio operacional.',
      priority: 140,
      whenToUse: 'Quando for necessário validar limites, comandos ou especificações de uma ferramenta técnica.',
      whenNotToUse: 'Não usar para atendimento direto a queixas de clientes.',
      triggerKeywords: ['manual tecnico', 'como usar ferramenta', 'parametros do roteador', 'especificacao tecnica'],
      exampleRequests: ['Qual o manual da ferramenta de Wi-Fi?', 'Quais parâmetros o reboot aceita?'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        {
          id: 'step_manual_tool',
          order: 1,
          type: 'mcp_tool_call',
          title: 'Consultar manual técnico MCP',
          adaptiveAccess: { enabled: true, requiresSteps: [] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:get_tool_manual`,
            friendlyToolName: 'Consultar manual das ferramentas',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [],
            outputMappings: [],
            fallbackAction: 'message',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_manual_reply',
          order: 2,
          type: 'respond',
          title: 'Informar consulta ao manual',
          messageText: 'Especificações técnicas das ferramentas MCP consultadas com sucesso.'
        }
      ]
    }
  ];

  // Build Document
  const document: AgentStudioDocument = {
    id: agentId,
    workspaceId,
    name: 'Lucas Suporte Técnico',
    objective: 'Atender solicitações técnicas de internet fibra óptica com excelência, cordialidade e agilidade. Identificar obrigatoriamente o cliente via CPF/CNPJ e contrato no início do atendimento. Executar diagnósticos remotos precisos no roteador via TR-069 (sinal óptico, atenuação de fibra, canais Wi-Fi, clientes conectados e interferência RF), orientar testes simples sem interrogar o cliente, aplicar reinício preventivo e alteração de SSID com consentimento prévio e transferir com rapidez para o suporte humano ou setores responsáveis quando necessário.',
    serviceType: 'support',
    language: 'pt-BR',
    aiModel: 'deepseek/deepseek-flash',
    status: 'published',
    publishedVersion: nextVersion,
    draftRevision: 11,
    migrationReview: {
      sourceHash: 'f49a0b4b1ad0600513450eeb43b5e84237c9be11d5e065fea2c6dc96cf7c25d8',
      acknowledgedKeys: ['knowledge', 'workflow', 'tools', 'activation', 'policies']
    },
    inlineKnowledge: [
      {
        id: '99000001-0000-4000-8000-000000000001',
        name: 'Diretrizes Técnicas e Blindagem Operacional do Suporte Velpro',
        sourceType: 'manual',
        content: `# LUCAS — SUPORTE TÉCNICO VELPRO TELECOM

## 1. IDENTIFICAÇÃO OBRIGATÓRIA E TRIAGEM INICIAL
- Todo atendimento de suporte técnico de conexão de internet inicia pela identificação do titular via CPF ou CNPJ e confirmação do contrato ou endereço de instalação.
- Nunca afirme ao cliente que você não acessa contratos ou dados cadastrais. Você é o assistente oficial de suporte técnico da Velpro e utiliza a identificação para localizar o roteador correto do assinante nos sistemas de rede.
- Reaproveite CPF e contrato já informados na conversa; não pergunte novamente se já foram fornecidos.
- Nunca peça dados técnicos internos (como IP WAN, PPPoE, MAC, número de série da ONU) ao cliente; descubra via ferramentas de rede.
- Nunca revele senhas de Wi-Fi, tokens ou credenciais sensíveis no chat.

## 2. EXECUÇÃO SEGURA E CONTINUIDADE (ANTI-INTERROGATÓRIO)
- Faça no máximo UMA pergunta simples por vez. Nunca sobrecarregue o cliente com múltiplas dúvidas.
- Se o cliente responder "não sei", "não tenho como ver" ou "não consigo", aceite prontamente, marque como indisponível e avance imediatamente para uma alternativa útil. Não repita perguntas já respondidas.
- Não recomece saudações nem se apresente repetidamente ao retomar a conversa. Vá direto ao ponto.
- Planeje o diagnóstico conforme o sintoma relatado: queda total (verificar sinal óptico Rx/Tx dBm), lentidão (verificar canais Wi-Fi e clientes conectados), intermitência (verificar uptime e rádios).

## 3. AÇÕES CONDICIONAIS E ESCRITAS NO EQUIPAMENTO
- Diagnóstico em leitura não autoriza reinício nem troca de parâmetros.
- O reinício do roteador exige pedido ou indicação técnica justificada, explicação prévia do impacto (interrupção temporária) e autorização explícita imediatamente anterior. Nunca reinicie com luz LOS vermelha (falha física de fibra).
- A alteração do nome do Wi-Fi (SSID) exige autorização explícita e aviso prévio de que os dispositivos serão desconectados. Não altere senha de Wi-Fi pelo chat (transfira para suporte humano seguro).
- Não prometa prazos de visita técnica ou reparo sem confirmação real do sistema.

## 4. RESOLUÇÃO E ENCERRAMENTO
- Só encerre o atendimento quando o cliente confirmar que a internet voltou ou solicitar explicitamente o término.
- Pedidos de atendimento humano têm prioridade imediata e devem ser transferidos sem novos testes ou burocracia.`
      }
    ],
    understandStage: {
      welcomeMessage: 'Olá! Sou o Lucas, suporte técnico da Velpro Telecom. Para iniciarmos o seu atendimento e localizarmos a sua conexão com precisão, por favor me informe o CPF ou CNPJ do titular do contrato:',
      askInitialData: true,
      initialFields: [
        {
          id: 'field_initial_cpf',
          name: 'CPF ou CNPJ do titular',
          variableKey: 'customer_cpf',
          type: 'cpf_cnpj',
          required: true,
          promptMessage: 'Para iniciarmos o atendimento e localizarmos a sua conexão com precisão, por favor informe o CPF ou CNPJ do titular do contrato:',
          errorMessage: 'Por favor, informe um CPF ou CNPJ válido com apenas os números.',
          maxAttempts: 3,
          requiresConfirmation: false,
          isSensitive: true,
        },
        {
          id: 'field_initial_contract',
          name: 'Número do contrato ou endereço da instalação',
          variableKey: 'customer_contract',
          type: 'text',
          required: true,
          promptMessage: 'Perfeito! E qual é o número do contrato ou o endereço da instalação onde está o roteador? (Se tiver apenas um contrato nessa residência, pode responder com o endereço ou apenas "único"):',
          errorMessage: 'Por favor, informe o endereço ou número do contrato.',
          maxAttempts: 3,
          requiresConfirmation: false,
          isSensitive: false,
        }
      ],
      outOfScopeMessage: 'Não consegui concluir esta verificação com segurança. Vou encaminhar seu atendimento ao nosso suporte com o que já identificamos.'
    },
    resolveStage: {
      conversationMode: 'adaptive',
      reasoning: {
        enabled: true,
        effort: 'high',
        supportModel: null,
        maxDecisions: 8,
        maxTurnMs: 90000
      },
      knowledgeCollectionIds: ['99000001-0000-4000-8000-000000000001'],
      procedures,
      allowGeneralAiChat: true
    },
    concludeStage: {
      confirmResolutionQuestion: 'Conseguiu resolver tudo o que precisava no seu atendimento técnico?',
      successClosingMessage: 'Excelente! Ficamos felizes em ajudar. Conte sempre com a Velpro Telecom! Tenha um ótimo dia!',
      handoffTeam: supportTeamId,
      handoffMessage: 'Vou transferir seu atendimento para a nossa equipe de Suporte Especializado dar continuidade.',
      maxRetriesBeforeHandoff: 3
    },
    appearance: {
      botTitle: 'Lucas · Suporte Técnico Velpro',
      colorTheme: 'emerald',
      showAvatar: true
    },
    rules: {
      operatingHoursEnabled: false,
      operatingHoursStart: '08:00',
      operatingHoursEnd: '18:00',
      outOfHoursMessage: 'Nosso suporte técnico opera de segunda a sexta, das 08h às 18h.',
      toneOfVoice: 'técnico, empático, objetivo, ágil e resolutivo. Identificar CPF/CNPJ e contrato no início. Fazer no máximo UMA pergunta simples por vez para não interrogar o cliente. Reaproveitar dados e sintomas já relatados. Nunca pedir dados técnicos internos (IP, MAC, serial) ao cliente. Aceitar prontamente respostas como "não sei" e avançar. Sigilo absoluto de senhas. Nunca reiniciar roteador ou alterar Wi-Fi sem consentimento explícito prévio.',
      timeZone: 'America/Sao_Paulo',
      operatingDays: [1, 2, 3, 4, 5, 6],
      maxTurnsPerSession: 40,
      maxToolCallsPerSession: 15,
      excludedTopics: ['política partidária', 'apostas e jogos de azar', 'conteúdo sexual'],
      prohibitedDataLabels: ['senha', 'token', 'código de autenticação', 'CVV', 'dados do cartão']
    },
    updatedAt: new Date().toISOString()
  };

  // 1. Zod Schema Validation
  console.log('1. Validando AgentStudioDocumentSchema...');
  const parsedDoc = AgentStudioDocumentSchema.parse(document);
  console.log('✔ Schema Zod validado com sucesso!');

  // 2. Assistant Publication Validator
  console.log('2. Validando com validateAgentForPublication...');
  const validation = validateAgentForPublication(parsedDoc);
  if (!validation.valid) {
    console.error('❌ Falha na validação para publicação:', validation.issues);
    throw new Error('Falha de validação do Agent Studio');
  }
  console.log('✔ Validação do Estúdio passou sem nenhum erro!');

  // 3. Compute MCP Fingerprints
  console.log('3. Resolvendo ferramentas e calculando fingerprints MCP...');
  const mcpServerToolFingerprints: Record<string, string> = {};
  for (const proc of parsedDoc.resolveStage.procedures) {
    for (const step of proc.steps) {
      if (step.mcpTool) {
        const resolved = await resolveStudioMcpTool(workspaceId, step.mcpTool);
        mcpServerToolFingerprints[step.mcpTool.qualifiedToolName] = resolved.fingerprint;
      }
    }
  }
  console.log(`✔ ${Object.keys(mcpServerToolFingerprints).length} ferramentas MCP vinculadas e assinadas com sucesso.`);

  // 4. Build Release Manifest
  console.log('4. Construindo e validando AgentReleaseManifest...');
  const manifest: AgentReleaseManifest = {
    releaseId: randomUUID(),
    agentId: agentId,
    workspaceId: workspaceId,
    version: nextVersion,
    agentSnapshot: document,
    publishedProcedures: document.resolveStage.procedures,
    referencedConnectionIds: [],
    connectionFingerprints: {},
    mcpServerToolFingerprints,
    createdAt: new Date().toISOString(),
    publishedByUserId: userId,
    runtimeVersion: 'studio-v1',
    runtimeConfig: {
      aiModel: 'deepseek/deepseek-flash'
    },
    knowledgeSnapshot: (document.inlineKnowledge || []).map((k) => ({
      id: k.id,
      name: k.name,
      content: k.content,
      collectionIds: [k.id]
    }))
  };

  const parsedManifest = AgentReleaseManifestSchema.parse(manifest);
  console.log('✔ Manifesto de liberação validado com sucesso!');

  // 5. Test Adaptive Reasoning Capability Compilation
  console.log('5. Testando compilação de capacidades adaptativas pelo Reasoning Engine...');
  for (const proc of parsedDoc.resolveStage.procedures) {
    const caps = compileStudioReasoningCapabilities(parsedDoc, proc.id, { values: {} }, new Set());
    console.log(`   - Procedimento "${proc.name}": ${caps.length} capacidades adaptativas.`);
  }
  console.log('✔ Todas as capacidades adaptativas compilaram perfeitamente!');

  // 6. Database Transaction
  console.log('6. Gravando publicação no banco de dados (Transação PostgreSQL)...');
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Fetch existing snapshot to retain baseline fields
    const v60Row = (await client.query(
      `SELECT snapshot FROM autopilot_config_versions WHERE config_id = $1 AND version_number = 60`,
      [agentId]
    )).rows[0];

    const enabledToolNames = [
      'sgp_fetch_contracts',
      'sgp_fetch_contact_panel_data',
      'add_internal_note',
      'transfer_chat',
      'close_chat',
      ...Object.keys(mcpServerToolFingerprints)
    ];

    const snapshot = {
      ...(v60Row?.snapshot || {}),
      name: parsedDoc.name,
      ai_model: parsedDoc.aiModel,
      is_active: true,
      enabled_tool_names: enabledToolNames,
      agent_studio_document: parsedDoc,
      agent_release_manifest: parsedManifest,
      workflow_runtime_v2_mode: 'off'
    };

    // Update autopilot_configs
    await client.query(
      `UPDATE autopilot_configs
       SET name = $3,
           ai_model = $4,
           is_active = true,
           enabled_tool_names = $5::jsonb,
           knowledge_base = $6,
           updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2`,
      [
        agentId,
        workspaceId,
        parsedDoc.name,
        parsedDoc.aiModel,
        JSON.stringify(enabledToolNames),
        document.inlineKnowledge?.[0]?.content || document.objective
      ]
    );
    console.log('✔ autopilot_configs atualizado.');

    // Clean existing nextVersion if present
    await client.query(
      `DELETE FROM autopilot_config_versions WHERE config_id = $1 AND version_number = $2`,
      [agentId, nextVersion]
    );

    // Insert version nextVersion
    await client.query(
      `INSERT INTO autopilot_config_versions (config_id, workspace_id, user_id, version_number, label, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        agentId,
        workspaceId,
        userId,
        nextVersion,
        `Estúdio de IA v${nextVersion}: Triagem Obrigatória de CPF/CNPJ e Contrato antes de Diagnósticos`,
        JSON.stringify(snapshot)
      ]
    );
    console.log(`✔ autopilot_config_versions v${nextVersion} inserido com sucesso.`);

    // Clear drafts
    await client.query(
      `DELETE FROM autopilot_config_drafts WHERE config_id = $1 AND workspace_id = $2`,
      [agentId, workspaceId]
    );
    console.log('✔ autopilot_config_drafts limpo.');

    // CRITICAL: Reset session state for active chats of 5561995215930 so they immediately pick up V64!
    const resetResult = await client.query(
      `UPDATE autopilot_conversation_states s
       SET metadata = jsonb_set(s.metadata, '{agent_studio}', 'null'::jsonb)
       FROM chats ch
       JOIN contacts co ON co.id = ch.contact_id
       WHERE ch.id = s.chat_id AND co.phone LIKE '%5561995215930%'`
    );
    console.log(`✔ Sessões anteriores de teste do contato 5561995215930 resetadas (${resetResult.rowCount} chats atualizados).`);

    await client.query('COMMIT');
    console.log('✔ Transação PostgreSQL confirmada com SUCESSO!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro na transação, rollback executado:', err);
    throw err;
  } finally {
    client.release();
  }

  // 7. Save file artifact
  const artifactDir = 'c:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/artifacts/agents';
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }
  const artifactPath = path.join(artifactDir, 'lucas-support-adaptive.json');
  fs.writeFileSync(artifactPath, JSON.stringify(parsedDoc, null, 2), 'utf8');
  console.log(`✔ Artefato salvo em: ${artifactPath}`);

  console.log(`========================================================================`);
  console.log(`=== PUBLICAÇÃO V${nextVersion} CONCLUÍDA COM SUCESSO! ===`);
  console.log(`========================================================================`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
