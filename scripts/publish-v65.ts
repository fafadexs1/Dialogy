import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../src/lib/db';
import {
  AgentStudioDocumentSchema,
  AgentReleaseManifestSchema,
  type AgentStudioDocument,
  type AgentReleaseManifest,
  type ProcedureDocument,
} from '../src/services/agent-studio/types';
import { validateAgentForPublication } from '../src/services/agent-studio/assistant-validator';
import { resolveStudioMcpTool } from '../src/services/agent-studio/integrations';
import { compileStudioReasoningCapabilities } from '../src/services/agent-studio/reasoning-capabilities';

async function main() {
  const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
  const agentId = '7d7259ab-a6c3-4057-a9ca-28ddbb15db95';
  const userId = '8fe1f4da-9305-475c-95d1-83bda9f29b22';
  const mcpServerId = '8171892c-827b-4216-a631-02839d36af85';
  const supportTeamId = 'b9a74d62-7f65-46c1-a5ae-4887fde9926e';
  const salesTeamId = 'b3b71514-098f-49fa-b922-f38a40065ef6';
  const financeTeamId = 'e4991d0b-917c-42e7-8cde-014b0bdf5bb8';
  const nextVersion = 65;

  console.log(`========================================================================`);
  console.log(`=== PUBLICANDO LUCAS V${nextVersion}: INTEGRAÇÃO SGP + MCP TR-069 ===`);
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

  function createSgpContractsStep(procPrefix: string, order: number) {
    return {
      id: `step_${procPrefix}_sgp_contracts`,
      order,
      type: 'native_action' as const,
      title: 'Consultar contratos do titular no SGP',
      subtitle: 'Consulta no SGP os contratos ativos, planos e endereços vinculados ao CPF/CNPJ',
      nativeActionType: 'sgp_fetch_contracts' as const,
      adaptiveAccess: { enabled: true, requiresSteps: [] },
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
        createSgpContractsStep('sem_int', 2),
        createContractStep('sem_int', 3),
        {
          id: 'step_sem_int_list',
          order: 4,
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
          order: 5,
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
          order: 6,
          type: 'respond',
          title: 'Informar diagnóstico da fibra',
          messageText: 'Diagnóstico da conexão realizado com sucesso. Analisamos o status óptico do seu roteador para verificar se há falha física na fibra ou se a conexão está operando normalmente.'
        },
        {
          id: 'step_sem_int_handoff',
          order: 7,
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
      objective: 'Analisar contratos SGP, rádios 2.4G/5G, clientes conectados, sinal RSSI e varredura de espectro RF dos vizinhos.',
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
        createSgpContractsStep('lent', 2),
        createContractStep('lent', 3),
        {
          id: 'step_lent_list',
          order: 4,
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
          order: 5,
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
          order: 6,
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
          order: 7,
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
          order: 8,
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
          order: 9,
          type: 'respond',
          title: 'Informar diagnóstico da lentidão',
          messageText: 'Análise de lentidão concluída. Verificamos o sinal óptico, frequências Wi-Fi e nível de interferência dos canais.'
        },
        {
          id: 'step_lent_handoff',
          order: 10,
          type: 'handoff',
          title: 'Transferir ao Suporte Técnico',
          handoffTeam: supportTeamId,
          handoffReason: 'Lentidão persistente após diagnóstico Wi-Fi e canais.'
        }
      ]
    },

    // 3. Quedas e instabilidade de conexão
    {
      id: 'a1000001-0000-4000-8000-000000000003',
      name: 'Diagnóstico de Conexão Intermitente e Quedas Frequentes',
      description: 'Análise de instabilidade crônica, reinícios espontâneos do roteador e quedas periódicas da WAN.',
      objective: 'Verificar uptime do roteador, histórico de conexão WAN e quedas nos logs TR-069.',
      priority: 180,
      whenToUse: 'Quando o cliente relatar que a internet cai e volta sozinha várias vezes ao dia.',
      whenNotToUse: 'Não usar para rompimento definitivo ou internet totalmente parada.',
      triggerKeywords: ['caindo toda hora', 'intermitente', 'cai e volta', 'oscilando', 'instavel', 'conexao caindo', 'quedas frequentes'],
      exampleRequests: ['Minha internet fica caindo e voltando', 'A conexão está muito instável', 'Cai toda hora'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('interm', 1),
        createSgpContractsStep('interm', 2),
        createContractStep('interm', 3),
        {
          id: 'step_interm_list',
          order: 4,
          type: 'mcp_tool_call',
          title: 'Localizar equipamento para checagem de instabilidade',
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
              { jsonPath: '[0].ID', chipKey: 'interm_device_id', chipLabel: 'ID do Equipamento', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_interm_details',
          order: 5,
          type: 'mcp_tool_call',
          title: 'Verificar Uptime e histórico WAN',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_interm_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:get_router_details`,
            friendlyToolName: 'Checar Uptime',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'interm_device_id', sourceChipLabel: 'ID do Equipamento', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'UptimeSeconds', chipKey: 'interm_uptime', chipLabel: 'Tempo Ligado', required: false },
              { jsonPath: 'OpticalPower.RxPowerdBm', chipKey: 'interm_rx_dbm', chipLabel: 'Potência Rx', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_interm_reply',
          order: 6,
          type: 'respond',
          title: 'Informar diagnóstico de instabilidade',
          messageText: 'Análise de estabilidade da conexão concluída com verificação de uptime e integridade da WAN.'
        },
        {
          id: 'step_interm_handoff',
          order: 7,
          type: 'handoff',
          title: 'Transferir ao Suporte Técnico',
          handoffTeam: supportTeamId,
          handoffReason: 'Instabilidade ou quedas frequentes persistentes.'
        }
      ]
    },

    // 4. Alteração de nome do Wi-Fi (SSID)
    {
      id: 'a1000001-0000-4000-8000-000000000004',
      name: 'Alteração do Nome da Rede Wi-Fi (SSID)',
      description: 'Procedimento assistido e seguro para troca do nome da rede sem fio (SSID) a pedido do titular.',
      objective: 'Validar novo nome de rede Wi-Fi, solicitar confirmação do cliente e aplicar alteração via TR-069.',
      priority: 175,
      whenToUse: 'Quando o cliente solicitar explicitamente a alteração ou personalização do nome do Wi-Fi.',
      whenNotToUse: 'Não usar para alteração de senha de Wi-Fi ou problemas de lentidão.',
      triggerKeywords: ['mudar nome do wifi', 'trocar nome da rede', 'alterar ssid', 'mudar ssid', 'trocar nome do wifi', 'renomear rede'],
      exampleRequests: ['Quero mudar o nome do meu Wi-Fi', 'Como mudo o nome da minha rede?', 'Pode trocar o nome do meu Wi-Fi?'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('ssid', 1),
        createSgpContractsStep('ssid', 2),
        createContractStep('ssid', 3),
        {
          id: 'step_ssid_collect_name',
          order: 4,
          type: 'collect_data',
          title: 'Coletar novo nome da rede Wi-Fi',
          collectField: {
            id: 'field_new_ssid',
            name: 'Novo Nome da Rede Wi-Fi (SSID)',
            variableKey: 'new_wifi_ssid',
            type: 'text',
            promptMessage: 'Qual é o novo nome que você gostaria de colocar na sua rede Wi-Fi?',
            errorMessage: 'Por favor, informe um nome com até 32 caracteres.',
            required: true,
            maxAttempts: 3,
            requiresConfirmation: true,
            isSensitive: false
          }
        },
        {
          id: 'step_ssid_list',
          order: 5,
          type: 'mcp_tool_call',
          title: 'Localizar roteador para configuração',
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
              { jsonPath: '[0].ID', chipKey: 'ssid_device_id', chipLabel: 'ID do Equipamento', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_ssid_apply',
          order: 6,
          type: 'mcp_tool_call',
          title: 'Aplicar novo SSID nas frequências Wi-Fi',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_ssid_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:configure_wifi`,
            friendlyToolName: 'Configurar Nome do Wi-Fi',
            riskLevel: 'sensitive',
            requiresConfirmation: true,
            confirmationPrompt: 'Confirma a alteração do nome da rede Wi-Fi? Todos os seus aparelhos precisarão se reconectar na nova rede.',
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'ssid_device_id', sourceChipLabel: 'ID do Equipamento', valueType: 'text' },
              { argumentName: 'ssid', sourceType: 'collected_field', sourceChipKey: 'new_wifi_ssid', sourceChipLabel: 'Novo Nome Wi-Fi', valueType: 'text' },
              { argumentName: 'band', sourceType: 'static_value', sourceChipKey: 'both', sourceChipLabel: 'Ambas as Bandas', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'status', chipKey: 'ssid_status', chipLabel: 'Status da Alteração', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_ssid_reply',
          order: 7,
          type: 'respond',
          title: 'Confirmar alteração do SSID',
          messageText: 'O nome da sua rede Wi-Fi foi alterado com sucesso! Seus dispositivos serão desconectados e você já pode reconectar com o novo nome informado.'
        }
      ]
    },

    // 5. Verificação de interferência RF e canais
    {
      id: 'a1000001-0000-4000-8000-000000000005',
      name: 'Verificação de Interferência RF e Otimização de Canais Wi-Fi',
      description: 'Varredura e checagem de poluição eletromagnética e canais congestionados por redes vizinhas.',
      objective: 'Escanear espectro 2.4GHz e 5GHz para identificar congestionamento e orientar melhor posicionamento.',
      priority: 170,
      whenToUse: 'Quando o cliente tiver problemas em horários de pico ou suspeitar de interferência de vizinhos.',
      whenNotToUse: 'Não usar para queda de fibra com LOS vermelho.',
      triggerKeywords: ['interferencia', 'canal wifi', 'redes vizinhas', 'muitas redes', 'canal congestionado', 'espectro'],
      exampleRequests: ['Tem muita interferência no meu Wi-Fi', 'Os canais do Wi-Fi estão congestionados?', 'Pode verificar as redes vizinhas?'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('rf', 1),
        createSgpContractsStep('rf', 2),
        createContractStep('rf', 3),
        {
          id: 'step_rf_list',
          order: 4,
          type: 'mcp_tool_call',
          title: 'Localizar roteador para análise de RF',
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
              { jsonPath: '[0].ID', chipKey: 'rf_device_id', chipLabel: 'ID do Equipamento', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_rf_scan',
          order: 5,
          type: 'mcp_tool_call',
          title: 'Executar varredura de espectro RF',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_rf_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:scan_wifi_spectrum`,
            friendlyToolName: 'Varredura RF',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'rf_device_id', sourceChipLabel: 'ID do Equipamento', valueType: 'text' },
              { argumentName: 'use_cached', sourceType: 'static_value', sourceChipKey: 'false', sourceChipLabel: 'Scan em Tempo Real', valueType: 'boolean' }
            ],
            outputMappings: [
              { jsonPath: 'Count', chipKey: 'rf_neighbors', chipLabel: 'Redes Detectadas', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_rf_reply',
          order: 6,
          type: 'respond',
          title: 'Informar resultado da varredura de canais',
          messageText: 'Varredura de espectro eletromagnético finalizada com levantamento de redes vizinhas e ocupação de canais.'
        }
      ]
    },

    // 6. Inspeção de aparelhos conectados
    {
      id: 'a1000001-0000-4000-8000-000000000006',
      name: 'Inspeção de Aparelhos Conectados na Rede Local',
      description: 'Inventário completo de dispositivos conectados ao roteador com identificação de banda e RSSI.',
      objective: 'Listar quantidade de aparelhos na rede local, sinal de cada um e identificar possíveis ladrões de Wi-Fi.',
      priority: 165,
      whenToUse: 'Quando o cliente quiser saber quem está usando a sua rede ou se há aparelhos desconhecidos consumindo banda.',
      whenNotToUse: 'Não usar para suporte financeiro.',
      triggerKeywords: ['quem esta conectado', 'aparelhos conectados', 'quantos celulares', 'ladrao de wifi', 'dispositivos na rede'],
      exampleRequests: ['Quantos aparelhos estão conectados no meu Wi-Fi?', 'Tem alguém roubando meu Wi-Fi?', 'Quem está usando minha internet?'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('disp', 1),
        createSgpContractsStep('disp', 2),
        createContractStep('disp', 3),
        {
          id: 'step_disp_list',
          order: 4,
          type: 'mcp_tool_call',
          title: 'Localizar roteador para listagem de clientes',
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
              { jsonPath: '[0].ID', chipKey: 'disp_device_id', chipLabel: 'ID do Equipamento', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_disp_clients',
          order: 5,
          type: 'mcp_tool_call',
          title: 'Buscar inventário de dispositivos conectados',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_disp_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:list_connected_clients`,
            friendlyToolName: 'Listar Dispositivos',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'disp_device_id', sourceChipLabel: 'ID do Equipamento', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'TotalCount', chipKey: 'disp_total', chipLabel: 'Total de Conectados', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_disp_reply',
          order: 6,
          type: 'respond',
          title: 'Informar dispositivos conectados',
          messageText: 'Inventário de dispositivos conectados à rede obtido com sucesso.'
        }
      ]
    },

    // 7. Reinício preventivo do roteador (Reboot)
    {
      id: 'a1000001-0000-4000-8000-000000000007',
      name: 'Reinício Preventivo e Remoto do Roteador (Reboot)',
      description: 'Comando controlado de reinicialização remota do roteador após consentimento prévio do cliente.',
      objective: 'Enviar comando seguro de reboot ao equipamento após validação e autorização do assinante.',
      priority: 160,
      whenToUse: 'Quando indicado tecnicamente para limpar cache do roteador e após confirmação explícita do cliente.',
      whenNotToUse: 'Nunca reiniciar com luz LOS vermelha (falha física) ou sem consentimento prévio.',
      triggerKeywords: ['reiniciar roteador', 'reinicia o aparelho', 'dar reboot', 'reiniciar modem', 'reiniciar conexao'],
      exampleRequests: ['Pode reiniciar meu roteador remotamente?', 'Reinicia o modem pra mim por favor', 'Quero reiniciar meu roteador'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('reboot', 1),
        createSgpContractsStep('reboot', 2),
        createContractStep('reboot', 3),
        {
          id: 'step_reboot_list',
          order: 4,
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
              { jsonPath: '[0].ID', chipKey: 'reboot_device_id', chipLabel: 'ID do Equipamento', required: true }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_reboot_apply',
          order: 5,
          type: 'mcp_tool_call',
          title: 'Enviar comando de reboot ao roteador',
          adaptiveAccess: { enabled: true, requiresSteps: ['step_reboot_list'] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:reboot_router`,
            friendlyToolName: 'Reiniciar Roteador',
            riskLevel: 'sensitive',
            requiresConfirmation: true,
            confirmationPrompt: 'O reinício do roteador causará uma interrupção temporária de cerca de 2 minutos em todos os aparelhos da residência. Posso reiniciar agora?',
            argumentMappings: [
              { argumentName: 'device_id', sourceType: 'step_output', sourceChipKey: 'reboot_device_id', sourceChipLabel: 'ID do Equipamento', valueType: 'text' },
              { argumentName: 'confirm', sourceType: 'static_value', sourceChipKey: 'true', sourceChipLabel: 'Confirmar', valueType: 'boolean' },
              { argumentName: 'reason', sourceType: 'static_value', sourceChipKey: 'Reinicio preventivo solicitado pelo cliente para restabelecimento de conexao', sourceChipLabel: 'Motivo Técnico', valueType: 'text' }
            ],
            outputMappings: [
              { jsonPath: 'status', chipKey: 'reboot_status', chipLabel: 'Status do Comando', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_reboot_reply',
          order: 6,
          type: 'respond',
          title: 'Confirmar envio de comando de reboot',
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
    },

    // 12. NOVO PROCEDIMENTO: Consulta e Seleção de Contratos no SGP
    {
      id: 'a1000001-0000-4000-8000-000000000012',
      name: 'Consulta e Seleção de Contratos no SGP',
      description: 'Consulta da lista de contratos ativos, planos e endereços do titular no SGP quando o cliente solicita saber seus contratos ou não sabe o número de cor.',
      objective: 'Consultar no SGP e apresentar ao cliente os contratos vinculados ao seu CPF/CNPJ para que ele possa escolher qual deseja atendimento.',
      priority: 215,
      whenToUse: 'Quando o cliente perguntar quais contratos tem, não souber o número do contrato, pedir para informar os contratos ou quiser escolher entre múltiplos contratos.',
      whenNotToUse: 'Não usar para clientes que já informaram diretamente o número do contrato ou endereço e relataram outro problema.',
      triggerKeywords: ['quais contratos', 'meus contratos', 'qual meu contrato', 'nao sei meu contrato', 'nao sei o contrato', 'listar contratos', 'pode me informar os contratos', 'quais contratos eu tenho', 'ver contratos', 'nao sei de cor'],
      exampleRequests: ['Pode me informar os contratos? Eu não sei o número de cor', 'Quais contratos estão no meu nome?', 'Qual o número do meu contrato?'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('sgp_proc', 1),
        createSgpContractsStep('sgp_proc', 2),
        createContractStep('sgp_proc', 3),
        {
          id: 'step_sgp_proc_reply',
          order: 4,
          type: 'respond',
          title: 'Apresentar lista de contratos consultados',
          messageText: 'Contratos localizados com sucesso no sistema SGP da Velpro.'
        }
      ]
    },

    // 13. NOVO PROCEDIMENTO: Consulta do Nome da Rede Wi-Fi (SSID)
    {
      id: 'a1000001-0000-4000-8000-000000000013',
      name: 'Consulta do Nome da Rede Wi-Fi (SSID)',
      description: 'Consulta do nome atual da rede sem fio (SSID) configurado no roteador quando o cliente esquece ou deseja saber o nome do seu Wi-Fi.',
      objective: 'Localizar o roteador do cliente via TR-069 e informar o nome atual da rede Wi-Fi (PrimarySSID) sem alterar nenhuma configuração.',
      priority: 176,
      whenToUse: 'Quando o cliente perguntar qual é o nome do seu Wi-Fi, disser que esqueceu o nome da rede ou quiser apenas saber/consultar o SSID atual sem alterar.',
      whenNotToUse: 'Não usar quando o cliente quiser alterar ou trocar o nome do Wi-Fi (usar o procedimento de Alteração) ou para suporte financeiro.',
      triggerKeywords: ['qual o nome do wifi', 'esqueci o nome do wifi', 'nome da rede', 'qual meu wifi', 'consultar wifi', 'saber o nome da rede', 'ver nome do wifi', 'apenas saber o nome atual', 'qual meu ssid', 'esqueci o nome'],
      exampleRequests: ['Esqueci o nome do meu Wi-Fi', 'Qual é o nome da minha rede?', 'Apenas saber o nome atual', 'Por incrível que pareça esqueci o nome do meu Wi-Fi'],
      status: 'published',
      publishedVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      steps: [
        createCpfStep('consult_ssid', 1),
        createSgpContractsStep('consult_ssid', 2),
        createContractStep('consult_ssid', 3),
        {
          id: 'step_consult_ssid_list',
          order: 4,
          type: 'mcp_tool_call',
          title: 'Localizar roteador e consultar SSID atual',
          adaptiveAccess: { enabled: true, requiresSteps: [] },
          mcpTool: {
            serverId: mcpServerId,
            serverName: 'MCP-TR069-Routers',
            qualifiedToolName: `mcp:${mcpServerId}:list_routers`,
            friendlyToolName: 'Localizar roteador e Wi-Fi',
            riskLevel: 'read_only',
            requiresConfirmation: false,
            argumentMappings: [
              { argumentName: 'limit', sourceType: 'static_value', sourceChipKey: '5', sourceChipLabel: 'Limite', valueType: 'number' }
            ],
            outputMappings: [
              { jsonPath: '[0].ID', chipKey: 'consult_device_id', chipLabel: 'ID do Equipamento', required: true },
              { jsonPath: '[0].PrimarySSID', chipKey: 'consult_primary_ssid', chipLabel: 'Nome da Rede Wi-Fi (SSID)', required: false }
            ],
            fallbackAction: 'handoff',
            fallbackHandoffTeam: supportTeamId
          }
        },
        {
          id: 'step_consult_ssid_reply',
          order: 5,
          type: 'respond',
          title: 'Informar nome atual da rede Wi-Fi',
          messageText: 'Nome da rede Wi-Fi (SSID) consultado com sucesso no equipamento do assinante.'
        }
      ]
    }
  ];

  // Build Document
  const document: AgentStudioDocument = {
    id: agentId,
    workspaceId,
    name: 'Lucas Suporte Técnico',
    objective: 'Atender solicitações técnicas de internet fibra óptica com excelência, cordialidade e agilidade. Identificar obrigatoriamente o cliente via CPF/CNPJ no início do atendimento e consultar imediatamente seus contratos no SGP da Velpro. Apresentar os contratos ao assinante quando ele solicitar ou não souber de cor. Executar diagnósticos remotos precisos no roteador via TR-069 (sinal óptico, atenuação de fibra, canais Wi-Fi, clientes conectados e interferência RF), orientar testes simples sem interrogar o cliente, aplicar reinício preventivo e alteração de SSID com consentimento prévio e transferir com rapidez para o suporte humano ou setores responsáveis quando necessário.',
    serviceType: 'support',
    language: 'pt-BR',
    aiModel: 'deepseek/deepseek-flash',
    status: 'published',
    publishedVersion: nextVersion,
    draftRevision: 12,
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

## 1. ACESSO OFICIAL AO SGP E LISTAGEM DE CONTRATOS DO ASSINANTE
- Você É o assistente virtual oficial de suporte técnico da Velpro Telecom e POSSUI ACESSO INTEGRADO E AUTORIZADO ao SGP (Sistema de Gestão de Provedores).
- NUNCA afirme ao cliente que você "não tem acesso à lista de contratos do titular", que "por segurança dos dados não pode repassar esse número" ou peça para ele passar o endereço completo em vez de listar os contratos. Você TEM acesso direto à ferramenta de consulta no SGP!
- Sempre que o cliente informar o CPF/CNPJ ou perguntar pelos contratos (ex: "Pode me informar os contratos? Eu não sei o número de cor", "Quais contratos tenho?", "Qual o contrato?"), execute IMEDIATAMENTE a capacidade de sistema "Consultar contratos do titular no SGP" (sgp_fetch_contracts).
- O SGP retornará a lista completa de contratos vinculados àquele CPF, com seus respectivos planos e endereços de instalação.
- Ao receber o resultado do SGP:
  - Se o titular possuir MÚLTIPLOS contratos (como 2, 3 ou 20 contratos): liste para o cliente os contratos encontrados com o número do contrato, o plano e o endereço/bairro (exemplo: "Localizei os seguintes contratos em seu nome:\n1. Contrato 12438 - PLANO 500 MEGA - Taguatinga Norte\n2. Contrato 10102 - Empresarial 1G - Águas Claras\n...\nQual deles você gostaria de verificar hoje?").
  - Se o titular possuir apenas 1 contrato: confirme o plano e localidade e avance imediatamente para os testes técnicos.
- Após a escolha ou confirmação do contrato, utilize as ferramentas TR-069 do roteador (list_routers, get_router_details, etc.) para realizar o diagnóstico técnico.

## 2. IDENTIFICAÇÃO OBRIGATÓRIA E TRIAGEM INICIAL
- Todo atendimento de suporte técnico de conexão de internet inicia pela identificação do titular via CPF ou CNPJ e confirmação do contrato ou endereço de instalação.
- Reaproveite CPF e contrato já informados na conversa; não pergunte novamente se já foram fornecidos.
- Nunca peça dados técnicos internos (como IP WAN, PPPoE, MAC, número de série da ONU) ao cliente; descubra via ferramentas de rede.
- Nunca revele senhas de Wi-Fi, tokens ou credenciais sensíveis no chat.

## 3. EXECUÇÃO SEGURA E CONTINUIDADE (ANTI-INTERROGATÓRIO)
- Faça no máximo UMA pergunta simples por vez. Nunca sobrecarregue o cliente com múltiplas dúvidas.
- Se o cliente responder "não sei", "não tenho como ver" ou "não consigo", aceite prontamente, marque como indisponível e avance imediatamente para uma alternativa útil. Não repita perguntas já respondidas.
- Não recomece saudações nem se apresente repetidamente ao retomar a conversa. Vá direto ao ponto.
- Planeje o diagnóstico conforme o sintoma relatado: queda total (verificar sinal óptico Rx/Tx dBm), lentidão (verificar canais Wi-Fi e clientes conectados), intermitência (verificar uptime e rádios).

## 4. CONSULTA E ALTERAÇÃO DO NOME DO WI-FI (SSID)
- Se o cliente perguntar qual é o nome do seu Wi-Fi, disser que esqueceu o nome da rede ou quiser "Apenas saber o nome atual", execute a consulta via TR-069 (list_routers) e informe com precisão o nome exato da rede (PrimarySSID) encontrado no roteador dele.
- Se o cliente quiser ALTERAR ou TROCAR o nome da rede, colete o novo nome desejado (com até 32 caracteres) e aplique via configure_wifi após consentimento prévio e aviso de que os aparelhos serão desconectados.
- Não altere nem revele senhas de Wi-Fi pelo chat (transfira para suporte humano seguro).

## 5. RESOLUÇÃO E ENCERRAMENTO
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
      toneOfVoice: 'técnico, empático, objetivo, ágil e resolutivo. Identificar CPF/CNPJ e consultar contratos no SGP. Fazer no máximo UMA pergunta simples por vez para não interrogar o cliente. Reaproveitar dados e sintomas já relatados. Nunca pedir dados técnicos internos (IP, MAC, serial) ao cliente. Aceitar prontamente respostas como "não sei" e avançar. Sigilo absoluto de senhas. Nunca reiniciar roteador ou alterar Wi-Fi sem consentimento explícito prévio.',
      timeZone: 'America/Sao_Paulo',
      operatingDays: [1, 2, 3, 4, 5, 6],
      maxTurnsPerSession: 40,
      maxToolCallsPerSession: 20,
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
      if (step.type === 'mcp_tool_call' && step.mcpTool) {
        const resolved = await resolveStudioMcpTool(workspaceId, step.mcpTool);
        mcpServerToolFingerprints[step.mcpTool.qualifiedToolName] = resolved.fingerprint;
        console.log(`  - Ferramenta MCP autorizada: ${step.mcpTool.qualifiedToolName} (fingerprint: ${resolved.fingerprint.slice(0, 12)}...)`);
      }
    }
  }

  // 4. Build AgentReleaseManifest
  console.log('4. Montando AgentReleaseManifest...');
  const releaseId = randomUUID();
  const manifest: AgentReleaseManifest = {
    releaseId: randomUUID(),
    agentId: agentId,
    workspaceId: workspaceId,
    version: nextVersion,
    agentSnapshot: parsedDoc,
    publishedProcedures: parsedDoc.resolveStage.procedures,
    referencedConnectionIds: [],
    connectionFingerprints: {},
    mcpServerToolFingerprints,
    createdAt: new Date().toISOString(),
    publishedByUserId: userId,
    runtimeVersion: 'studio-v1',
    runtimeConfig: {
      aiModel: 'deepseek/deepseek-flash'
    },
    knowledgeSnapshot: (parsedDoc.inlineKnowledge || []).map((k) => ({
      id: k.id,
      name: k.name,
      content: k.content,
      collectionIds: [k.id]
    }))
  };

  const parsedManifest = AgentReleaseManifestSchema.parse(manifest);
  console.log('✔ Manifest de release validado com sucesso!');

  // 5. Test compileStudioReasoningCapabilities
  console.log('5. Testando compilação de capacidades adaptativas...');
  for (const proc of parsedDoc.resolveStage.procedures) {
    const caps = compileStudioReasoningCapabilities(parsedDoc, proc.id, { values: { customer_cpf: '86675273191' }, input: {} }, new Set());
    console.log(`  - Procedimento "${proc.name}": ${caps.length} capacidades adaptativas.`);
  }

  // 6. Database Transaction
  console.log('6. Iniciando transação no PostgreSQL...');
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Build snapshot
    const enabledToolNames = [
      'sgp_fetch_contracts',
      'sgp_fetch_contact_panel_data',
      'transfer_chat',
      'close_chat',
      ...Object.keys(mcpServerToolFingerprints)
    ];

    const snapshot = {
      id: agentId,
      workspace_id: workspaceId,
      name: parsedDoc.name,
      user_id: userId,
      ai_model: parsedDoc.aiModel,
      is_active: true,
      tool_mode: 'adaptive',
      workflow_builder_mode: 'studio',
      agent_studio_document: parsedDoc,
      agent_release_manifest: parsedManifest,
      enabled_tool_names: enabledToolNames,
      knowledge_base: document.inlineKnowledge?.[0]?.content || document.objective,
      closing_policy: {
        confirm_resolution_question: parsedDoc.concludeStage.confirmResolutionQuestion,
        success_closing_message: parsedDoc.concludeStage.successClosingMessage
      },
      escalation_policy: {
        handoff_team: parsedDoc.concludeStage.handoffTeam,
        handoff_message: parsedDoc.concludeStage.handoffMessage
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
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
        `Estúdio de IA v${nextVersion}: Integração SGP Contratos + MCP TR-069`,
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

    // CRITICAL: Reset session state for active chats of 5561995215930 so they immediately pick up V65!
    const resetResult = await client.query(
      `UPDATE autopilot_conversation_states s
       SET metadata = jsonb_set(COALESCE(s.metadata, '{}'::jsonb), '{agent_studio}', 'null'::jsonb),
           updated_at = NOW()
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
