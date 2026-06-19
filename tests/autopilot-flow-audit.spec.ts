import { describe, expect, it } from 'vitest';

import type { AutopilotFlowGraph } from '@/lib/types';
import {
  auditAutopilotFlowGraph,
  simulateAutopilotFlowBeforePublish,
  summarizeFlowAuditIssues,
} from '@/services/autopilot/flow-audit';

describe('autopilot flow audit', () => {
  it('blocks switch routes without fallback or target before publishing', () => {
    const graph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'wifi-switch',
          kind: 'switch',
          title: 'Tipo de Wi-Fi',
          subtitle: 'Decisor',
          position: { x: 0, y: 0 },
          config: {
            confidenceThreshold: 0.75,
            routes: [
              {
                id: 'alterar_wifi',
                label: 'Alterar Wi-Fi',
                description: 'Cliente quer alterar nome ou senha.',
              },
              {
                id: 'outro',
                label: 'Outro',
                description: 'Fallback.',
              },
            ],
          },
        },
      ],
      edges: [],
    };

    const audit = auditAutopilotFlowGraph(graph);

    expect(audit.status).toBe('failed');
    expect(audit.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'switch_missing_fallback',
      'switch_route_missing_target',
    ]));
    expect(summarizeFlowAuditIssues(audit.issues)).toContain('precisa de uma rota fallback');
  });

  it('accepts switch route targets declared by route-labeled edges', () => {
    const graph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'wifi-switch',
          kind: 'switch',
          title: 'Tipo de Wi-Fi',
          subtitle: 'Decisor',
          position: { x: 0, y: 0 },
          config: {
            confidenceThreshold: 0.75,
            fallbackRouteId: 'outro',
            routes: [
              {
                id: 'alterar_wifi',
                label: 'Alterar Wi-Fi',
                description: 'Cliente quer alterar nome ou senha.',
              },
              {
                id: 'outro',
                label: 'Outro',
                description: 'Fallback.',
              },
            ],
          },
        },
        {
          id: 'coletar-wifi',
          kind: 'form',
          title: 'Coletar Wi-Fi',
          subtitle: 'Dados',
          position: { x: 200, y: 0 },
          config: {
            formFields: [
              { id: 'wifi_ssid', label: 'Nome da rede', fieldKey: 'wifi_ssid', type: 'text', required: true },
              { id: 'wifi_password', label: 'Senha do Wi-Fi', fieldKey: 'wifi_password', type: 'text', required: true },
            ],
          },
        },
        {
          id: 'perguntar-melhor',
          kind: 'send_message',
          title: 'Perguntar melhor',
          subtitle: 'Fallback',
          position: { x: 200, y: 160 },
        },
      ],
      edges: [
        { id: 'edge-alterar', source: 'wifi-switch', target: 'coletar-wifi', routeId: 'alterar_wifi' },
        { id: 'edge-outro', source: 'wifi-switch', target: 'perguntar-melhor', routeId: 'outro' },
      ],
    };

    const audit = auditAutopilotFlowGraph(graph);
    expect(audit.status).toBe('passed');
    expect(audit.issues).toEqual([]);
    expect(audit.simulations.map((simulation) => simulation.caseId)).toEqual(expect.arrayContaining([
      'direct_customer_route',
      'fallback_clarification',
      'human_handoff_escape',
    ]));
  });

  it('blocks publishing when a risky tool can be reached without confirmation or failure recovery', () => {
    const graph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'trigger',
          kind: 'trigger',
          title: 'Inicio',
          subtitle: '',
          position: { x: 0, y: 0 },
        },
        {
          id: 'reboot-router',
          kind: 'tool',
          title: 'Reiniciar roteador',
          subtitle: 'Acao sensivel',
          position: { x: 200, y: 0 },
          risk: 'high',
          toolName: 'reboot_router',
        },
      ],
      edges: [
        { id: 'edge-tool', source: 'trigger', target: 'reboot-router' },
      ],
    };

    const audit = auditAutopilotFlowGraph(graph);

    expect(audit.status).toBe('failed');
    expect(audit.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'simulation_ambiguous_yes_guard_failed',
      'simulation_skip_confirmation_attempt_failed',
      'simulation_tool_failure_recovery_failed',
      'simulation_write_tool_failure_recovery_failed',
      'simulation_generic_outside_procedure_failed',
    ]));
    expect(summarizeFlowAuditIssues(audit.issues)).toContain('confirmacao');
  });

  it('simulates a safe tool path with confirmation and recovery response', () => {
    const graph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'confirm',
          kind: 'form',
          title: 'Confirmar reinicio',
          subtitle: 'Confirma antes de executar',
          position: { x: 0, y: 0 },
        },
        {
          id: 'reboot-router',
          kind: 'tool',
          title: 'Reiniciar roteador',
          subtitle: 'Acao sensivel',
          position: { x: 200, y: 0 },
          risk: 'high',
          toolName: 'reboot_router',
        },
        {
          id: 'recovery',
          kind: 'send_message',
          title: 'Responder resultado',
          subtitle: 'Informa sucesso ou falha',
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        { id: 'edge-confirm', source: 'confirm', target: 'reboot-router' },
        { id: 'edge-recovery', source: 'reboot-router', target: 'recovery' },
      ],
    };

    const simulations = simulateAutopilotFlowBeforePublish(graph);

    expect(simulations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        caseId: 'ambiguous_yes_guard',
        status: 'passed',
        nodeId: 'reboot-router',
      }),
      expect.objectContaining({
        caseId: 'tool_failure_recovery',
        status: 'passed',
        nodeId: 'reboot-router',
      }),
      expect.objectContaining({
        caseId: 'skip_confirmation_attempt',
        status: 'passed',
        nodeId: 'reboot-router',
      }),
      expect.objectContaining({
        caseId: 'write_tool_failure_recovery',
        status: 'passed',
        nodeId: 'reboot-router',
      }),
    ]));
  });

  it('simulates partial data, topic shifts, RAG gaps and generic out-of-procedure questions', () => {
    const graph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'wifi-switch',
          kind: 'switch',
          title: 'Tipo de Wi-Fi',
          subtitle: 'Decisor',
          position: { x: 0, y: 0 },
          config: {
            confidenceThreshold: 0.75,
            fallbackRouteId: 'outro',
            routes: [
              {
                id: 'alterar_wifi',
                label: 'Alterar Wi-Fi',
                description: 'Cliente quer trocar nome ou senha.',
                examples: ['Quero mudar a senha do Wi-Fi'],
                requiredSlots: ['wifi_ssid', 'wifi_password'],
              },
              {
                id: 'outro',
                label: 'Outro',
                description: 'Perguntar melhor.',
                examples: ['Tenho outra duvida'],
              },
            ],
          },
        },
        {
          id: 'coletar-wifi',
          kind: 'form',
          title: 'Coletar Wi-Fi',
          subtitle: 'Novo nome e senha',
          position: { x: 200, y: 0 },
          config: {
            formFields: [
              { id: 'ssid', label: 'Nome da rede', fieldKey: 'wifi_ssid', required: true },
              { id: 'password', label: 'Senha', fieldKey: 'wifi_password', required: true },
            ],
          },
        },
        {
          id: 'perguntar-melhor',
          kind: 'send_message',
          title: 'Perguntar melhor',
          subtitle: 'Fallback',
          position: { x: 200, y: 160 },
          config: {
            message: 'Nao encontrei isso na base. Pode me explicar melhor para eu ajudar com seguranca?',
          },
        },
        {
          id: 'base',
          kind: 'knowledge',
          title: 'Base Wi-Fi',
          subtitle: 'Consultar documentos',
          position: { x: 400, y: 0 },
          config: {
            instructions: 'Use apenas documentos da base. Se nao encontrar cobertura suficiente, nao invente resposta.',
            knowledgeCollectionIds: ['wifi'],
          },
        },
        {
          id: 'responder-base',
          kind: 'assistant',
          title: 'Responder com base',
          subtitle: 'Sem inventar',
          position: { x: 600, y: 0 },
          config: {
            instructions: 'Se a base for insuficiente, diga que nao encontrou documento suficiente e peca contexto.',
          },
        },
      ],
      edges: [
        { id: 'edge-alterar', source: 'wifi-switch', target: 'coletar-wifi', routeId: 'alterar_wifi' },
        { id: 'edge-outro', source: 'wifi-switch', target: 'perguntar-melhor', routeId: 'outro' },
        { id: 'edge-knowledge', source: 'base', target: 'responder-base' },
      ],
    };

    const simulations = simulateAutopilotFlowBeforePublish(graph);

    expect(simulations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        caseId: 'partial_data_collection',
        status: 'passed',
        nodeId: 'wifi-switch',
        routeId: 'alterar_wifi',
      }),
      expect.objectContaining({
        caseId: 'topic_shift_guard',
        status: 'passed',
        nodeId: 'wifi-switch',
      }),
      expect.objectContaining({
        caseId: 'rag_no_coverage_guard',
        status: 'passed',
        nodeId: 'base',
      }),
      expect.objectContaining({
        caseId: 'generic_outside_procedure',
        status: 'passed',
        nodeId: 'wifi-switch',
      }),
    ]));
  });

  it('blocks RAG gaps that can fall directly into an unsafe action', () => {
    const graph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'base',
          kind: 'knowledge',
          title: 'Base tecnica',
          subtitle: 'Consulta',
          position: { x: 0, y: 0 },
        },
        {
          id: 'reboot-router',
          kind: 'tool',
          title: 'Reiniciar roteador',
          subtitle: 'Acao',
          position: { x: 200, y: 0 },
          risk: 'high',
          toolName: 'reboot_router',
        },
      ],
      edges: [
        { id: 'edge-base-tool', source: 'base', target: 'reboot-router' },
      ],
    };

    const audit = auditAutopilotFlowGraph(graph);

    expect(audit.status).toBe('failed');
    expect(audit.issues.map((issue) => issue.code)).toContain('simulation_rag_no_coverage_guard_failed');
  });

  it('blocks v2 collect nodes without typed required fields', () => {
    const graph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'start',
          kind: 'start',
          title: 'Inicio',
          subtitle: '',
          position: { x: 0, y: 0 },
        },
        {
          id: 'collect',
          kind: 'collect',
          title: 'Coletar dados',
          subtitle: 'Sem tipo',
          position: { x: 200, y: 0 },
          config: {
            formFields: [
              { id: 'phone', label: 'Telefone com DDD', required: true },
            ],
          },
        },
      ],
      edges: [
        { id: 'edge-start-collect', source: 'start', target: 'collect' },
      ],
    };

    const audit = auditAutopilotFlowGraph(graph);

    expect(audit.status).toBe('failed');
    expect(audit.issues.map((issue) => issue.code)).toContain('collect_required_field_missing_type');
  });

  it('blocks cycles without explicit maxAttempts or error handles', () => {
    const graph: AutopilotFlowGraph = {
      version: 1,
      nodes: [
        {
          id: 'a',
          kind: 'message',
          title: 'Pergunta A',
          subtitle: '',
          position: { x: 0, y: 0 },
          config: { message: 'A' },
        },
        {
          id: 'b',
          kind: 'message',
          title: 'Pergunta B',
          subtitle: '',
          position: { x: 200, y: 0 },
          config: { message: 'B' },
        },
      ],
      edges: [
        { id: 'a-b', source: 'a', target: 'b' },
        { id: 'b-a', source: 'b', target: 'a' },
      ],
    };

    const audit = auditAutopilotFlowGraph(graph);

    expect(audit.status).toBe('failed');
    expect(audit.issues.map((issue) => issue.code)).toContain('cycle_without_limit');
  });
});
