import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import type { WorkflowConnection, WorkflowDefinition, WorkflowNode } from '@/services/workflow-runtime/types';
import { createStandaloneNexusWorkflow } from '@/modules/nexus/services/standalone-workflows';
import { createNativeWorkflowLayout } from '@/components/workflow/native-workflow-layout';

/** Synthetic, side-effect-free graphs for local browser verification and profiling. */
export function createWorkflowEditorFixture(count = 9): WorkflowDefinition {
  const base = createStandaloneNexusWorkflow({ id: `editor-fixture-${count}`, workspaceId: 'local-fixture', name: 'Atendimento · Demonstração local', template: 'message' });
  const make = (type: string, id: string, name: string, config: Record<string, unknown> = {}) => createWorkflowNode(type, { id, name, config, position: { x: 0, y: 0 } });
  const nodes: WorkflowNode[] = count >= 300
    ? Array.from({ length: count }, (_, index) => make(index === 0 ? 'trigger.manual' : 'data.set', `step-${index}`, `Etapa ${index + 1}`))
    : [
      make('trigger.received_message', 'start', 'Mensagem recebida'),
      make('output.respond', 'welcome', 'Boas-vindas', { message: 'Olá! Como podemos ajudar você hoje?' }),
      make('interaction.options', 'menu', 'Escolher assunto', { prompt: 'Selecione uma opção para continuar.', options: [{ id: 'sales', label: 'Conhecer nossos planos' }, { id: 'support', label: 'Preciso de suporte' }, { id: 'billing', label: 'Faturas e pagamentos' }] }),
      make('output.respond', 'sales', 'Apresentar os planos', { message: 'Conheça nossas opções de internet e encontre o plano ideal.' }),
      make('output.end', 'sales-end', 'Concluir apresentação'),
      make('output.respond', 'support', 'Entender o problema', { message: 'Descreva o que aconteceu para encaminharmos seu atendimento.' }),
      make('output.end', 'support-end', 'Concluir suporte'),
      make('output.respond', 'billing', 'Consultar informações', { message: 'Vamos ajudar você a localizar os dados da sua fatura.' }),
      make('output.end', 'billing-end', 'Concluir consulta'),
    ];
  const connections: WorkflowConnection[] = [];
  const connect = (source: WorkflowNode, target: WorkflowNode, sourcePortId?: string) => {
    const output = source.outputPorts.find((port) => port.id === sourcePortId) || source.outputPorts.find((port) => port.connectionType === 'main')!;
    const input = target.inputPorts.find((port) => port.connectionType === output.connectionType)!;
    connections.push({ id: `edge-${connections.length}`, sourceNodeId: source.id, sourcePortId: output.id, targetNodeId: target.id, targetPortId: input.id, connectionType: output.connectionType });
  };
  if (count >= 300) nodes.slice(1).forEach((node, index) => connect(nodes[index], node));
  else {
    const menu = nodes[2];
    menu.outputPorts = [...['sales', 'support', 'billing'].map((id) => ({ id, label: id === 'sales' ? 'Planos' : id === 'support' ? 'Suporte' : 'Financeiro', direction: 'output' as const, connectionType: 'main' as const, required: false, multiple: false }))];
    connect(nodes[0], nodes[1]); connect(nodes[1], menu);
    for (const [index, port] of [[3, 'sales'], [5, 'support'], [7, 'billing']] as const) { connect(menu, nodes[index], port); connect(nodes[index], nodes[index + 1]); }
  }
  const positions = createNativeWorkflowLayout(nodes, connections);
  // The preview is server-rendered too; deterministic timestamps avoid a hydration mismatch.
  return { ...base, createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z', nodes: nodes.map((node) => ({ ...node, position: positions.get(node.id)! })), connections };
}
