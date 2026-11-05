import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import type { WorkflowDefinition, WorkflowNode } from '@/services/workflow-runtime/types';

/** Add support identification to the existing v2 draft without re-asking in Finance. */
export function upgradeVelproSupportIdentification(original: WorkflowDefinition): WorkflowDefinition {
  const flow = structuredClone(original);
  if (flow.metadata?.velproIdentificationVersion === 3) return flow;
  if (flow.metadata?.velproIdentificationVersion !== 2) throw new Error('A identificação Velpro v2 é obrigatória antes do ajuste de Suporte.');
  for (const node of flow.nodes.filter(n => n.type === 'dialogy.sgp_identify_customer')) node.config.customErrorRoute = true;
  const get = (id: string) => {
    const node = flow.nodes.find(n => n.id === id);
    if (!node) throw new Error(`Bloco obrigatório não encontrado: ${id}`);
    return node;
  };
  const add = (type: string, id: string, name: string, x: number, y: number, config: Record<string, unknown>) => {
    if (flow.nodes.some(n => n.id === id)) throw new Error(`Bloco já existe: ${id}`);
    const node = createWorkflowNode(type, { id, name, position: { x, y }, config });
    flow.nodes.push(node);
    return node;
  };
  const connect = (source: WorkflowNode, port: string, target: WorkflowNode) => {
    const output = source.outputPorts.find(p => p.id === port);
    if (!output) throw new Error(`Saída inexistente: ${source.id}:${port}`);
    flow.connections.push({ id: `support_identify_${source.id}_${port}`, sourceNodeId: source.id, sourcePortId: port,
      targetNodeId: target.id, targetPortId: output.connectionType === 'error' ? 'error' : 'main', connectionType: output.connectionType });
  };
  const support = get('velpro_support_availability');
  const finance = get('velpro_finance_availability');
  const identify = add('dialogy.sgp_identify_customer', 'velpro_support_identify', 'Identificar contrato · Suporte', 1400, -40,
    { outputKey: 'sgpIdentification', allowNewCustomer: false, saveDocumentIfEmpty: true, customErrorRoute: true });
  const router = add('logic.switch', 'velpro_support_contract_route', 'Situação do contrato selecionado', 1680, -40, {
    value: '{{sgpIdentification.statusTone}}', cases: [
      { value: 'active', operator: 'equals', output: 'active' },
      { value: 'suspended', operator: 'equals', output: 'finance' },
      { value: 'cancelled', operator: 'equals', output: 'finance' },
    ], defaultOutput: 'default',
  });
  for (const [id, label] of [['active', 'Ativo · Suporte'], ['finance', 'Suspenso ou cancelado · Financeiro']]) {
    router.outputPorts.push({ id: id!, label: label!, direction: 'output', connectionType: 'main', required: false, multiple: false });
  }
  const notice = add('output.respond', 'velpro_support_finance_notice', 'Informar encaminhamento ao Financeiro', 1960, -180,
    { channel: 'source', idempotent: true, message: 'O contrato {{sgpIdentification.contractId}} está {{sgpIdentification.statusLabel}} no cadastro. Vou direcionar seu atendimento ao Financeiro para verificar a situação.' });
  const recovery = add('error.handler', 'velpro_support_sgp_recovery', 'Recuperar consulta · Suporte', 1400, 180, { mode: 'recover' });
  const unknown = add('output.respond', 'velpro_support_sgp_unavailable', 'Conferência manual · Suporte', 1680, 180,
    { channel: 'source', idempotent: true, message: 'Não consegui confirmar a situação do contrato. Vou seguir com o Suporte para a equipe conferir seus dados.' });
  const entry = flow.connections.find(e => e.sourceNodeId === 'velpro_main_menu' && e.sourcePortId === 'support');
  if (!entry || entry.targetNodeId !== support.id) throw new Error('A entrada do Suporte foi alterada; confira a rota atual.');
  entry.targetNodeId = identify.id;
  connect(identify, 'selected', router);
  connect(identify, 'new_customer', get('velpro_back_to_main_loop'));
  connect(identify, 'cancelled', get('velpro_back_to_main_loop'));
  connect(identify, 'error', recovery);
  connect(recovery, 'recovered', unknown);
  connect(router, 'active', support);
  connect(router, 'finance', notice);
  connect(router, 'default', unknown);
  connect(notice, 'success', finance);
  connect(unknown, 'success', support);
  get('velpro_support_handoff').config.reason = 'Solicitação de suporte técnico. {{sgpIdentification.summary}}';
  get('velpro_support_handoff').config.persistReason = true;
  flow.metadata = { ...flow.metadata, velproIdentificationVersion: 3 };
  flow.updatedAt = new Date().toISOString();
  return WorkflowDefinitionSchema.parse(flow);
}
