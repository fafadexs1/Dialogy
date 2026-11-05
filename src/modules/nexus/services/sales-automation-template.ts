import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import type { WorkflowDefinition, WorkflowNode } from '@/services/workflow-runtime/types';

/** An editable draft; its author must select real releases, endpoints and credentials. */
export function populateSalesAutomation(definition: WorkflowDefinition, webhook: boolean) {
  const add = (type: string, id: string, name: string, x: number, y: number, config: Record<string, unknown> = {}) => {
    const node = createWorkflowNode(type, { id, name, position: { x, y }, config });
    if (node.outputPorts.some(port => port.connectionType === 'error')) node.config.customErrorRoute = true;
    definition.nodes.push(node); return node;
  };
  const link = (source: WorkflowNode, port: string, target: WorkflowNode, targetPort = 'main', connectionType: 'main' | 'model' | 'error' = 'main') => definition.connections.push({ id: `${source.id}_${port}_${target.id}`, sourceNodeId: source.id, sourcePortId: port, targetNodeId: target.id, targetPortId: targetPort, connectionType });
  const root = webhook ? 'input.body' : 'input';
  const audioPath = `${root}.${webhook ? 'audioUrl' : 'metadata.audioUrl'}`;
  const trigger = add(webhook ? 'trigger.webhook' : 'trigger.received_message', 'sales_start', webhook ? 'Lead recebido por webhook' : 'Mensagem do cliente', 80, 200, webhook ? { responseMode: 'queued', conversationIdPath: 'body.chatId' } : { matchMode: 'all', messageTypes: ['text', 'audio'], startPolicy: 'unassigned_only' });
  const hasAudio = add('logic.if', 'sales_has_audio', 'Há URL de áudio para transcrever?', 430, 200, { left: `{{${audioPath}}}`, operator: 'exists' });
  const download = add('integration.http_request', 'sales_download_audio', 'Baixar áudio recebido', 780, 20, { method: 'GET', url: `{{${audioPath}}}`, responseFormat: 'file', fileName: 'entrada.ogg', outputKey: 'incomingAudio', maxResponseBytes: 10000000 });
  const transcribe = add('audio.transcribe', 'sales_transcribe', 'Transcrever para qualificação', 1120, 20, { file: '{{variables.incomingAudio}}', outputKey: 'transcription' });
  const audioText = add('data.set', 'sales_audio_text', 'Usar texto transcrito', 1460, 20, { assignments: { message: '{{variables.transcription.text}}' } });
  const text = add('data.set', 'sales_text', 'Usar mensagem de texto', 1120, 380, { assignments: { message: `{{${root}.text}}` } });
  const extract = add('data.extract', 'sales_extract', 'Extrair e classificar o lead', 1810, 200, { outputKey: 'lead', schema: { type: 'object', properties: { name: { type: 'string' }, interest: { type: 'string' }, intent: { type: 'string', enum: ['sales', 'support', 'human'] } }, required: ['intent'], additionalProperties: false } });
  const model = add('ai.model', 'sales_model', 'Selecionar modelo de extração', 1810, 650, { supportsStructuredOutput: true });
  const route = add('logic.switch', 'sales_route', 'Vendas ou atendimento humano', 2160, 200, { value: '{{variables.lead.intent}}', cases: [{ value: 'sales', operator: 'equals', output: 'sales' }] });
  route.outputPorts.push({ id: 'sales', label: 'Vendas', direction: 'output', connectionType: 'main', required: false, multiple: false });
  const catalog = add('integration.http_request', 'sales_catalog', 'Configurar consulta ao catálogo', 2540, 200, { url: '', responseFormat: 'json', outputKey: 'catalog' });
  const agent = add('ai.studio_agent', 'sales_agent', 'Selecionar vendedor do IA Studio', 2880, 200, { mode: 'task', task: 'Use os dados públicos mapeados para recomendar uma oferta real do catálogo. Não invente preços, disponibilidade ou condições. Retorne a resposta ao cliente e os dados comerciais previstos no contrato.', outputKey: 'salesAgent' });
  const approval = add('logic.approval', 'sales_approval', 'Revisar resposta comercial', 3220, 200, { title: 'Aprovar a resposta e o destinatário', arguments: { response: '{{variables.salesAgent.response}}', lead: '{{variables.lead}}' } });
  const voice = add('audio.elevenlabs', 'sales_voice', 'Configurar voz ElevenLabs', 3560, 200, { text: '{{variables.salesAgent.response}}', outputKey: 'salesAudio' });
  const send = add('output.media', 'sales_send_audio', 'Enviar resposta em áudio', 3900, 200, { mediaType: 'audio', file: '{{variables.salesAudio}}' });
  const crm = add('dialogy.crm_update', 'sales_crm', 'Escolher campos do CRM', 4240, 200, { fields: {} });
  const wait = add('logic.wait', 'sales_wait', 'Aguardar retorno por até quatro horas', 4580, 200, { mode: 'message', expireEvents: true, pauseTimeoutWhileWaiting: true, timeoutMs: 14400000 });
  const follow = add('output.respond', 'sales_follow_up', 'Follow-up após o prazo', 4940, 20, { message: 'Olá! Ficou alguma dúvida sobre a oferta que conversamos?' });
  const human = add('output.handoff', 'sales_human', 'Selecionar equipe de atendimento', 4940, 520, { reason: 'Lead solicita ajuda humana ou precisa de revisão.' });
  const end = add('output.end', 'sales_end', 'Concluir esta automação', 5300, 200, { output: { success: true } });
  const error = add('error.handler', 'sales_error', 'Registrar falha sem repetir ações', 4240, 850, { mode: 'fail', publicMessage: 'A automação foi interrompida. Revise os resultados antes de repetir ações externas.' });
  const errorEnd = add('output.end', 'sales_error_end', 'Finalizar com falha registrada', 4580, 850, { output: { success: false } });
  link(trigger, webhook ? 'request' : 'message', hasAudio); link(hasAudio, 'true', download); link(hasAudio, 'false', text); link(download, 'success', transcribe); link(transcribe, 'success', audioText);
  link(audioText, 'success', extract); link(text, 'success', extract); link(model, 'model', extract, 'model', 'model'); link(extract, 'success', route); link(extract, 'invalid_output', human);
  link(route, 'sales', catalog); link(route, 'default', human); link(catalog, 'success', agent); link(agent, 'completed', approval);
  for (const port of ['needs_input', 'handoff', 'close_requested', 'limit_reached']) link(agent, port, human);
  link(approval, 'approved', voice); link(approval, 'denied', human); link(approval, 'expired', human); link(voice, 'success', send); link(send, 'success', crm); link(crm, 'success', wait);
  link(wait, 'resumed', human); link(wait, 'expired', follow); link(follow, 'success', end); link(human, 'completed', end); link(error, 'failed', errorEnd);
  for (const node of definition.nodes) if (node.outputPorts.some(port => port.id === 'error' && port.connectionType === 'error')) link(node, 'error', error, 'error', 'error');
  definition.metadata = { ...definition.metadata, automationReference: { version: 1, name: 'sales', requiresConfiguration: ['modelo de extração', 'catálogo por API', 'versão e mapeamentos do Studio', 'credencial e voz ElevenLabs', 'campos de CRM', 'equipe de atendimento'], homologatedWithRealProviders: false }, flowBuilderUi: { version: 1, groups: [
    { id: 'sales_input', title: '1 · Entrada e qualificação', nodeIds: [trigger.id, hasAudio.id, download.id, transcribe.id, audioText.id, text.id, extract.id, model.id] },
    { id: 'sales_ai', title: '2 · Catálogo e vendedor do Studio', nodeIds: [route.id, catalog.id, agent.id] },
    { id: 'sales_voice_group', title: '3 · Aprovação e voz', nodeIds: [approval.id, voice.id, send.id] },
    { id: 'sales_operations', title: '4 · CRM, retorno e follow-up', nodeIds: [crm.id, wait.id, follow.id, human.id, end.id] },
  ] } };
}
