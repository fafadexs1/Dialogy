import { describe, expect, it } from 'vitest';
import type { AutopilotFlowGraph } from '@/lib/types';
import { auditAutopilotFlowGraph } from '@/services/autopilot/flow-audit';
import { compileProcedureFromFlowGraph } from '@/services/autopilot/procedure-flow-compiler';

describe('Cross-Feature Combinations & Real-World Scenarios (Tiers 3 & 4)', () => {
  describe('Tier 3: Cross-Feature Combinations', () => {
    it('F-T3-1: Valid flow graph passes audit and compiles successfully', () => {
      const graph: AutopilotFlowGraph = {
        version: 1,
        nodes: [
          {
            id: 'start-node',
            kind: 'start',
            title: 'Início',
            subtitle: 'Start',
            position: { x: 0, y: 0 },
          },
          {
            id: 'msg-node',
            kind: 'message',
            title: 'Boas-vindas',
            subtitle: 'Message',
            position: { x: 200, y: 0 },
            config: {
              message: 'Olá! Sou seu assistente de Wi-Fi.',
            },
          },
          {
            id: 'collect-node',
            kind: 'collect',
            title: 'Coletar CPF',
            subtitle: 'Collect',
            position: { x: 400, y: 0 },
            config: {
              formFields: [
                { id: 'cpf', label: 'CPF', type: 'text', required: true },
              ],
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'start-node', target: 'msg-node' },
          { id: 'e2', source: 'msg-node', target: 'collect-node' },
        ],
      };

      // 1. Audit passes
      const audit = auditAutopilotFlowGraph(graph);
      expect(audit.status).toBe('passed');
      expect(audit.issues.length).toBe(0);

      // 2. Compilation succeeds
      const compiled = compileProcedureFromFlowGraph({ flowGraph: graph });
      expect(compiled.success).toBe(true);
      expect(compiled.graph).not.toBeNull();
      
      const steps = compiled.graph!.steps;
      expect(steps.length).toBe(2); // message and collect are executable
      expect(steps.some(s => s.visualNodeKind === 'message')).toBe(true);
      expect(steps.some(s => s.visualNodeKind === 'collect')).toBe(true);
    });

    it('F-T3-2: Invalid elements fail audit and block compilation/publishing', () => {
      const graph: AutopilotFlowGraph = {
        version: 1,
        nodes: [
          {
            id: 'start-node',
            kind: 'start',
            title: 'Início',
            subtitle: 'Start',
            position: { x: 0, y: 0 },
          },
          {
            id: 'msg-node',
            kind: 'message',
            title: 'Boas-vindas',
            subtitle: 'Message',
            position: { x: 200, y: 0 },
            config: {
              message: '', // invalid: empty message
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'start-node', target: 'msg-node' },
        ],
      };

      // 1. Audit fails
      const audit = auditAutopilotFlowGraph(graph);
      expect(audit.status).toBe('failed');
      expect(audit.issues.some(i => i.code === 'message_node_empty_message')).toBe(true);

      // 2. Simulating that publishing is blocked when audit fails
      const publishAllowed = audit.status === 'passed';
      expect(publishAllowed).toBe(false);
    });
  });

  describe('Tier 4: Real-World Application Scenarios', () => {
    it('Scenario 1: Full Agent Publishing Lifecycle (Validation -> Compilation -> Success)', () => {
      // Complete valid flow graph representing a real-world helpdesk routine
      const graph: AutopilotFlowGraph = {
        version: 1,
        nodes: [
          {
            id: 'start-node',
            kind: 'start',
            title: 'Início do Fluxo',
            subtitle: 'Trigger',
            position: { x: 0, y: 0 },
          },
          {
            id: 'welcome-msg',
            kind: 'message',
            title: 'Mensagem de Boas-vindas',
            subtitle: 'Welcome message',
            position: { x: 200, y: 0 },
            config: {
              message: 'Olá, sou o assistente virtual da Conexão. Vamos resolver sua dúvida.',
            },
          },
          {
            id: 'collect-name-phone',
            kind: 'collect',
            title: 'Identificação do Cliente',
            subtitle: 'Formulário',
            position: { x: 400, y: 0 },
            config: {
              formFields: [
                { id: 'fullname', label: 'Nome Completo', type: 'text', required: true },
                { id: 'phone', label: 'Telefone de Contato', type: 'text', required: true },
              ],
            },
          },
          {
            id: 'support-agent',
            kind: 'sub_agent',
            title: 'Suporte Técnico',
            subtitle: 'Auxiliar de Conectividade',
            position: { x: 600, y: 0 },
            config: {
              instructions: 'Tente diagnosticar problemas de conexão Wi-Fi ou banda larga lenta.',
            },
          },
          {
            id: 'human-handoff',
            kind: 'handoff',
            title: 'Transbordo Comercial',
            subtitle: 'Commercial Team',
            position: { x: 800, y: 0 },
            config: {
              message: 'Entendido. Passarei você para um atendente de vendas.',
              destination: 'comercial_fila',
            },
          },
        ],
        edges: [
          { id: 'edge-start-welcome', source: 'start-node', target: 'welcome-msg' },
          { id: 'edge-welcome-collect', source: 'welcome-msg', target: 'collect-name-phone' },
          { id: 'edge-collect-support', source: 'collect-name-phone', target: 'support-agent' },
          { id: 'edge-support-handoff', source: 'support-agent', target: 'human-handoff' },
        ],
      };

      // Phase 1: Audit Validation
      const audit = auditAutopilotFlowGraph(graph);
      expect(audit.status).toBe('passed');
      expect(audit.issues).toEqual([]);

      // Phase 2: Backend Compilation
      const compiled = compileProcedureFromFlowGraph({ flowGraph: graph });
      expect(compiled.success).toBe(true);
      expect(compiled.graph).not.toBeNull();

      const compiledGraph = compiled.graph!;
      
      // Phase 3: Runtime Structure Verification
      // Verify sequence of steps
      const steps = compiledGraph.steps;
      expect(steps.length).toBe(4); // welcome-msg, collect-name-phone, support-agent, human-handoff are executable
      
      const welcomeStep = steps.find(s => s.visualNodeId === 'welcome-msg');
      const collectStep = steps.find(s => s.visualNodeId === 'collect-name-phone');
      const supportStep = steps.find(s => s.visualNodeId === 'support-agent');
      const handoffStep = steps.find(s => s.visualNodeId === 'human-handoff');

      expect(welcomeStep).toBeDefined();
      expect(collectStep).toBeDefined();
      expect(supportStep).toBeDefined();
      expect(handoffStep).toBeDefined();

      // Check transitions
      expect(welcomeStep!.nextStepId).toBe(collectStep!.id);
      expect(collectStep!.nextStepId).toBe(supportStep!.id);
      expect(supportStep!.nextStepId).toBe(handoffStep!.id);
      expect(handoffStep!.nextStepId).toBeNull();
    });

    it('Scenario 2: Invalid Draft to Clean Publish (Error -> Correction -> Success)', () => {
      // Phase 1: Editor starts with an invalid graph containing an empty message node
      const invalidGraph: AutopilotFlowGraph = {
        version: 1,
        nodes: [
          {
            id: 'start-node',
            kind: 'start',
            title: 'Início',
            subtitle: 'Start',
            position: { x: 0, y: 0 },
          },
          {
            id: 'invalid-msg',
            kind: 'message',
            title: 'Boas-vindas',
            subtitle: 'Empty Message',
            position: { x: 200, y: 0 },
            config: {
              message: '', // Invalid empty message
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'start-node', target: 'invalid-msg' },
        ],
      };

      const audit1 = auditAutopilotFlowGraph(invalidGraph);
      expect(audit1.status).toBe('failed');
      expect(audit1.issues.some(i => i.code === 'message_node_empty_message')).toBe(true);

      // Phase 2: User corrects the message node to contain a valid text
      const correctedGraph: AutopilotFlowGraph = {
        ...invalidGraph,
        nodes: invalidGraph.nodes.map(node => {
          if (node.id === 'invalid-msg') {
            return {
              ...node,
              config: {
                ...node.config,
                message: 'Olá! Como posso ajudar você hoje?',
              },
            };
          }
          return node;
        }),
      };

      const audit2 = auditAutopilotFlowGraph(correctedGraph);
      expect(audit2.status).toBe('passed');
      expect(audit2.issues.length).toBe(0);

      // Phase 3: Compile and publish updated flow
      const compiled = compileProcedureFromFlowGraph({ flowGraph: correctedGraph });
      expect(compiled.success).toBe(true);
    });
  });
});
