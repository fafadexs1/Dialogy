import { upgradeVelproSupportIdentification } from './velpro-support-identification';
import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import type { WorkflowDefinition, WorkflowNode } from '@/services/workflow-runtime/types';

/** Patch the current editor definition rather than rebuilding the legacy import. */
export function upgradeVelproIdentification(original: WorkflowDefinition): WorkflowDefinition {
  const flow = structuredClone(original);
  if (flow.metadata?.velproIdentificationVersion === 3) return flow;
  if (flow.metadata?.velproIdentificationVersion === 2) return upgradeVelproSupportIdentification(flow);
  if (flow.metadata?.velproIdentificationVersion === 1) {
    for (const candidate of flow.nodes.filter(n => n.type === 'dialogy.sgp_identify_customer')) candidate.config.saveDocumentIfEmpty = true;
    flow.metadata.velproIdentificationVersion = 2;
    flow.updatedAt = new Date().toISOString();
    return upgradeVelproSupportIdentification(WorkflowDefinitionSchema.parse(flow));
  }
  if (flow.name !== 'Fluxo Velpro Final') throw new Error('O fluxo selecionado não é o Fluxo Velpro Final.');
  const node = (id: string) => {
    const found = flow.nodes.find(candidate => candidate.id === id);
    if (!found) throw new Error(`Bloco obrigatório não encontrado: ${id}`);
    return found;
  };
  const add = (type: string, id: string, name: string, x: number, y: number, config: Record<string, unknown>) => {
    if (flow.nodes.some(n => n.id === id)) throw new Error(`Bloco já existe: ${id}`);
    const created = createWorkflowNode(type, { id, name, position: { x, y }, config });
    flow.nodes.push(created);
    return created;
  };
  const connect = (from: WorkflowNode, port: string, to: WorkflowNode) => {
    const output = from.outputPorts.find(p => p.id === port);
    if (!output) throw new Error(`Saída não encontrada: ${from.id}:${port}`);
    flow.connections.push({ id: `identify_${from.id}_${port}`, sourceNodeId: from.id, sourcePortId: port,
      targetNodeId: to.id, targetPortId: output.connectionType === 'error' ? 'error' : 'main', connectionType: output.connectionType });
  };
  const back = node('velpro_back_to_main_loop');
  const commercial = node('velpro_commercial_availability');
  const finance = node('velpro_finance_availability');
  const identify = (area: string, label: string, x: number, y: number, destination: WorkflowNode, allowNewCustomer = false) => {
    const selection = add('dialogy.sgp_identify_customer', `velpro_${area}_identify`, `Identificar cliente · ${label}`, x, y,
      { outputKey: 'sgpIdentification', allowNewCustomer, saveDocumentIfEmpty: true });
    const unavailable = add('output.respond', `velpro_${area}_sgp_unavailable`, `SGP indisponível · ${label}`, x + 280, y + 180,
      { channel: 'source', message: 'Não consegui consultar seu cadastro agora. Vou seguir com o atendimento para a equipe conferir seus dados.', idempotent: true });
    const recovery = add('error.handler', `velpro_${area}_sgp_recovery`, `Recuperar consulta · ${label}`, x, y + 180, { mode: 'recover' });
    connect(selection, 'selected', destination);
    connect(selection, 'new_customer', allowNewCustomer ? destination : back);
    connect(selection, 'cancelled', back);
    connect(selection, 'error', recovery);
    connect(recovery, 'recovered', unavailable);
    connect(unavailable, 'success', destination);
    return selection;
  };
  const commercialIncoming = flow.connections.filter(e => e.targetNodeId === commercial.id && e.sourceNodeId === 'velpro_referral_menu');
  const financeIncoming = flow.connections.filter(e => e.targetNodeId === finance.id);
  if (!commercialIncoming.length || !financeIncoming.length) throw new Error('Rotas de entrada esperadas não encontradas.');
  const commercialSelection = identify('commercial', 'Comercial', 1680, -680, commercial, true);
  const financeSelection = identify('finance', 'Financeiro', 2800, 480, finance);
  commercialIncoming.forEach(e => { e.targetNodeId = commercialSelection.id; });
  financeIncoming.forEach(e => { e.targetNodeId = financeSelection.id; });
  node('velpro_commercial_handoff').config.reason = 'Atendimento comercial. {{sgpIdentification.summary}}';
  node('velpro_commercial_handoff').config.persistReason = true;
  node('velpro_finance_handoff').config.reason = 'Solicitação financeira. {{sgpIdentification.summary}}';
  node('velpro_finance_handoff').config.persistReason = true;

  // Dedicated address-transfer branch, retaining the Commercial team's existing hours.
  const addressAvailability = add('dialogy.team_availability', 'velpro_address_availability', 'Expediente · Transferência de endereço', 2800, -1400, { ...commercial.config, outputKey: 'addressAvailability' });
  const addressInput = add('interaction.input', 'velpro_address_new_address', 'Novo endereço de instalação', 2520, -1400,
    { prompt: 'Qual é o novo endereço de instalação? Informe rua, número, bairro e cidade. Se ainda não souber, pode responder “não sei”.', outputKey: 'novo_endereco', validation: 'text', timeoutMs: 86_400_000 });
  connect(addressInput, 'resumed', addressAvailability);
  connect(addressInput, 'expired', node('velpro_session_expired'));
  const addressSelection = identify('address', 'Transferência de endereço', 2240, -1400, addressInput);
  const entry = flow.connections.find(e => e.sourceNodeId === 'velpro_main_menu' && e.sourcePortId === 'address_transfer');
  if (!entry) throw new Error('Opção de transferência de endereço não encontrada.');
  entry.targetNodeId = addressSelection.id;
  const addressTag = add('dialogy.chat_tag', 'velpro_address_tag', 'Etiquetar transferência de endereço', 3080, -1500, { ...node('velpro_commercial_open_tag').config });
  const addressMessage = add('output.respond', 'velpro_address_message', 'Encaminhar transferência de endereço', 3360, -1500,
    { channel: 'source', message: 'Vou encaminhar sua solicitação de transferência de endereço ao Comercial, que verificará a disponibilidade e as condições para a mudança.', idempotent: true });
  const addressHandoff = add('output.handoff', 'velpro_address_handoff', 'Transferência de endereço · Comercial', 3640, -1500,
    { ...node('velpro_commercial_handoff').config, reason: 'Transferência de endereço. {{sgpIdentification.summary}}. Novo endereço informado: {{novo_endereco}}' });
  const addressEnd = add('output.end', 'velpro_address_end', 'Finalizar encaminhamento de mudança', 3920, -1500, { output: { outcome: 'address_transfer_handoff' } });
  connect(addressAvailability, 'open', addressTag);
  connect(addressTag, 'success', addressMessage);
  connect(addressMessage, 'success', addressHandoff);
  connect(addressHandoff, 'completed', addressEnd);
  // Keep the current configured out-of-hours destination, including editor changes.
  const closed = flow.connections.find(e => e.sourceNodeId === commercial.id && e.sourcePortId === 'closed');
  if (!closed) throw new Error('Rota de comercial fechado não encontrada.');
  connect(addressAvailability, 'closed', node(closed.targetNodeId));
  flow.metadata = { ...flow.metadata, velproIdentificationVersion: 2 };
  flow.version = 'draft';
  flow.status = 'draft';
  flow.updatedAt = new Date().toISOString();
  return upgradeVelproSupportIdentification(WorkflowDefinitionSchema.parse(flow));
}
