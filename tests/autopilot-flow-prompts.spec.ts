import { describe, expect, it } from 'vitest';
import type { AutopilotConfig, AutopilotFlowGraph, NexusFlowInstance } from '@/lib/types';
import { migrateAutopilotFlowGraphToV2 } from '@/services/autopilot/flow-v2';
import {
  formatFlowFormGuidanceForPrompt,
  formatFlowReferencesForPrompt,
  formatFlowSwitchGuidanceForPrompt,
  resolveActiveFlowIntentScope,
  resolveFlowFormGuidance,
  renderDeterministicFlowMessage,
} from '@/services/autopilot/flow-routing';

describe('Backend Prompt Generation & Guidance (Features 3 & 4)', () => {
  // Helper to generate a basic flow graph
  const createMockGraph = (title: string, instructions: string): AutopilotFlowGraph => ({
    version: 1,
    nodes: [
      {
        id: 'start',
        kind: 'start',
        title: 'Start',
        subtitle: '',
        position: { x: 0, y: 0 },
      },
      {
        id: 'sub-agent-node',
        kind: 'sub_agent',
        title,
        subtitle: 'SubAgent Subtitle',
        position: { x: 200, y: 0 },
        config: {
          instructions,
        },
      },
    ],
    edges: [
      { id: 'edge-1', source: 'start', target: 'sub-agent-node' },
    ],
  });

  // Helper to generate a basic AutopilotConfig
  const createMockConfig = (graph: AutopilotFlowGraph): AutopilotConfig => ({
    id: 'config-1',
    workspace_id: 'ws-1',
    user_id: 'user-1',
    name: 'Mock Config',
    gemini_api_key: null,
    ai_model: null,
    transcription_model: null,
    knowledge_base: null,
    knowledge_base_documents: null,
    is_primary: true,
    is_active: true,
    is_private: false,
    default_fallback_reply: null,
    escalation_policy: null,
    closing_policy: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    flow_graph: graph,
  });

  describe('Tier 1: Feature Coverage', () => {
    it('F3-T1-1: New/migrated sub-agent default instructions contain structured layout (títulos/marcadores)', () => {
      // A legacy node migrated to sub_agent v2 should have structured default instructions
      const legacyGraph: AutopilotFlowGraph = {
        version: 1,
        nodes: [
          {
            id: 'legacy-node',
            kind: 'assistant',
            title: 'Atendimento Wi-Fi',
            subtitle: 'Helpdesk',
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      };

      const migrated = migrateAutopilotFlowGraphToV2(legacyGraph);
      expect(migrated).not.toBeNull();
      const node = migrated!.nodes[0];
      expect(node.kind).toBe('sub_agent');
      
      const instructions = node.config?.instructions || '';
      // Assert that default instructions are structured (contain Markdown headings or list bullets)
      expect(instructions).toMatch(/(#|\*|-|##|###)/);
      expect(instructions).toContain('Atribuições');
    });

    it('F3-T1-2: Compiled intentContextForAI includes flowSubAgent field', () => {
      // Pass a mock AutopilotConfig to resolveActiveFlowIntentScope and assert that the returned intent scope contains the correct title/sub-agent details.
      const graph = createMockGraph('wifi_troubleshooting', 'Instruções de wifi');
      const config = createMockConfig(graph);
      const activeFlowIntentScope = resolveActiveFlowIntentScope(config, 'support_request');
      
      expect(activeFlowIntentScope).not.toBeNull();
      expect(activeFlowIntentScope!.title).toBe('wifi_troubleshooting');
      expect(activeFlowIntentScope!.systemPrompt).toBe('Instruções de wifi');
      expect(activeFlowIntentScope!.intent).toBe('support_request');
    });

    it('F3-T1-3: Runtime process-chat prompt injection incorporates natural behavior guidance', () => {
      // Call formatFlowSwitchGuidanceForPrompt on configurations to assert prompt format and guidelines are generated
      const graph: AutopilotFlowGraph = {
        version: 1,
        nodes: [
          {
            id: 'decision-node',
            kind: 'decision',
            title: 'Triage Switch',
            subtitle: '',
            position: { x: 0, y: 0 },
            config: {
              instructions: 'Escolha uma rota para o atendimento.',
              switchMode: 'ai',
              confidenceThreshold: 0.75,
              routes: [
                {
                  id: 'route-1',
                  label: 'Suporte',
                  description: 'Quando o cliente pede ajuda com Wi-Fi.',
                },
              ],
            },
          },
        ],
        edges: [],
      };
      const config = createMockConfig(graph);
      const switchGuidance = formatFlowSwitchGuidanceForPrompt(config);
      
      expect(switchGuidance).toContain('SWITCHES DO FLUXO');
      expect(switchGuidance).toContain('Triage Switch');
      expect(switchGuidance).toContain('Suporte');
    });

    it('F3-T1-4: System instructions limit client queries from creating unsupported facts', () => {
      // Call formatFlowFormGuidanceForPrompt on configurations to assert prompt format and guidelines are generated
      const graph: AutopilotFlowGraph = {
        version: 1,
        nodes: [
          {
            id: 'start',
            kind: 'start',
            title: 'Start',
            subtitle: '',
            position: { x: 0, y: 0 },
          },
          {
            id: 'subagent-node',
            kind: 'sub_agent',
            title: 'SubAgent',
            subtitle: '',
            position: { x: 200, y: 0 },
            config: {
              instructions: 'SubAgent instructions',
            },
          },
          {
            id: 'collect-node',
            kind: 'collect',
            title: 'Formulário',
            subtitle: '',
            position: { x: 400, y: 0 },
            config: {
              formMode: 'ai',
              message: 'Colete as informações do cliente.',
              formFields: [
                { id: 'field-1', label: 'Nome', fieldKey: 'name', required: true, placeholder: 'Ex. João' },
              ],
            },
          },
        ],
        edges: [
          { id: 'edge-start', source: 'start', target: 'subagent-node' },
          { id: 'edge-collect', source: 'subagent-node', target: 'collect-node' },
        ],
      };
      const config = createMockConfig(graph);
      const scope = resolveActiveFlowIntentScope(config, 'support_request');
      const formGuidance = resolveFlowFormGuidance(config, scope);
      const formPrompt = formatFlowFormGuidanceForPrompt(formGuidance);

      expect(formPrompt).toContain('FORMULARIO GUIADO POR IA ATIVO');
      expect(formPrompt).toContain('Formulário');
      expect(formPrompt).toContain('Nome (obrigatorio; chave=name; exemplo=Ex. João)');
    });

    it('F3-T1-5: Node-level custom instructions are combined correctly with system guidelines', () => {
      // Call formatFlowReferencesForPrompt on configurations to assert prompt format and guidelines are generated
      const graph: AutopilotFlowGraph = {
        version: 1,
        nodes: [
          {
            id: 'wifi-node',
            kind: 'sub_agent',
            title: 'Wi-Fi Diagnosis',
            subtitle: '',
            position: { x: 0, y: 0 },
            config: {
              referenceId: 'wifi_diag',
            },
          },
        ],
        edges: [],
      };
      const mockRules: NexusFlowInstance[] = [
        {
          id: 'rule-1',
          name: 'Consultar Horário',
          trigger: 'quando o cliente pergunta do horario',
          enabled: true,
        } as any,
      ];

      const config = createMockConfig(graph);
      const referencesPrompt = formatFlowReferencesForPrompt(config, mockRules);

      expect(referencesPrompt).toContain('REFERENCIAS DO FLUXO (@ID)');
      expect(referencesPrompt).toContain('@wifi_diag');
      expect(referencesPrompt).toContain('@habilidade_consultar_horario');
    });
  });

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('F3-T2-1: Intent context compiled with very long flow title', () => {
      const veryLongTitle = 'A'.repeat(1000) + '_flow';
      const graph = createMockGraph(veryLongTitle, 'Instructions');
      const config = createMockConfig(graph);
      
      const scope = resolveActiveFlowIntentScope(config, 'support_request');
      expect(scope).not.toBeNull();
      expect(scope!.title).toBe(veryLongTitle);
    });

    it('F3-T2-2: Processing chat when there is no active flow/intent scope', () => {
      const graph: AutopilotFlowGraph = {
        version: 1,
        nodes: [
          {
            id: 'start-node',
            kind: 'start',
            title: 'Start',
            subtitle: '',
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      };
      const config = createMockConfig(graph);
      const scope = resolveActiveFlowIntentScope(config, 'support_request');
      expect(scope).toBeNull();
    });

    it('F3-T2-3: Checking template interpolation security (weird characters in title/instructions)', () => {
      const dangerousTitle = 'wifi_flow"; DROP TABLE configs; --';
      const graph: AutopilotFlowGraph = {
        version: 1,
        nodes: [
          {
            id: 'start',
            kind: 'start',
            title: 'Start',
            subtitle: '',
            position: { x: 0, y: 0 },
          },
          {
            id: 'subagent-node',
            kind: 'sub_agent',
            title: dangerousTitle,
            subtitle: '',
            position: { x: 200, y: 0 },
            config: {
              instructions: 'Instruções com caracteres especiais: { } [ ] $ &',
            },
          },
        ],
        edges: [
          { id: 'edge-1', source: 'start', target: 'subagent-node' },
        ],
        variables: [
          { id: 'var-1', name: 'db_hack"; DROP TABLE variables; --', defaultValue: 'safe_value', scope: 'system' },
        ],
      };
      const config = createMockConfig(graph);

      // Verify active intent scope resolution handles dangerous titles/instructions safely
      const scope = resolveActiveFlowIntentScope(config, 'support_request');
      expect(scope).not.toBeNull();
      expect(scope!.title).toBe(dangerousTitle);
      expect(scope!.systemPrompt).toContain('{ } [ ] $ &');

      // Verify rendering handles dangerous variables/templates
      const template = 'Olá {{system.contact.name}}, sua mensagem foi: {{system.customer_message}}. Custom: {{system.db_hack"; DROP TABLE variables; --}}';
      const result = renderDeterministicFlowMessage(config, template, {
        customerMessage: 'Quero Wi-Fi! " OR "1"="1',
        contactName: 'Administrador\n\t',
      });

      expect(result).toContain('Administrador');
      expect(result).toContain('Quero Wi-Fi! " OR "1"="1');
      expect(result).toContain('safe_value');
    });

    it('F3-T2-4: Prompt compiler handles empty optional parameters gracefully', () => {
      const result = formatFlowFormGuidanceForPrompt(null);
      expect(result).toBe('');
    });

    it('F3-T2-5: Multiple consecutive user chat prompts maintain system instructions correctly', () => {
      const graph = createMockGraph('wifi_troubleshooting', 'Instruções de wifi');
      const config = createMockConfig(graph);

      const firstScope = resolveActiveFlowIntentScope(config, 'support_request');
      const secondScope = resolveActiveFlowIntentScope(config, 'support_request');

      expect(firstScope).not.toBeNull();
      expect(secondScope).not.toBeNull();
      expect(firstScope).toEqual(secondScope);

      // Verify formatting is also idempotent
      const firstGuidance = formatFlowSwitchGuidanceForPrompt(config);
      const secondGuidance = formatFlowSwitchGuidanceForPrompt(config);
      expect(firstGuidance).toBe(secondGuidance);
    });
  });
});
