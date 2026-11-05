import type { WorkflowNodeManifest } from './catalog';
import type { NodePort } from './types';

const port = (id: string, label: string, direction: 'input' | 'output', connectionType: NodePort['connectionType'] = 'main'): NodePort => ({ id, label, direction, connectionType, required: direction === 'input', multiple: direction === 'input' });
export function toolboxManifests(): WorkflowNodeManifest[] {
  const entries: Array<[string, string, string, WorkflowNodeManifest['category'], string, Record<string, unknown>]> = [
    ['data.operation', 'Trabalhar com dados e listas', 'Seleciona campos e índices, divide texto, converte, filtra, ordena, agrupa e combina listas.', 'data', 'ListFilter', { operation: 'pick', source: '{{current}}', field: '', outputKey: 'result' }],
    ['files.read', 'Ler arquivo', 'Extrai texto de PDF, Word, PPTX, TXT e JSON ou linhas de CSV e Excel de um arquivo privado.', 'data', 'FileText', { file: '{{current.file}}', format: 'auto', outputKey: 'document' }],
    ['files.write', 'Gerar arquivo', 'Gera um arquivo privado de texto, JSON, CSV, PDF, DOCX, XLSX ou apresentação PPTX a partir dos dados do fluxo.', 'data', 'FilePlus', { source: '{{current}}', format: 'json', fileName: 'resultado.json', outputKey: 'file' }],
    ['audio.transcribe', 'Transcrever áudio', 'Converte um arquivo de áudio privado em texto usando a transcrição configurada.', 'integrations', 'Mic', { file: '{{current.file}}', outputKey: 'transcription' }],
    ['audio.elevenlabs', 'Gerar voz · ElevenLabs', 'Gera áudio privado a partir de texto, voz e credencial ElevenLabs.', 'integrations', 'AudioLines', { text: '', voiceId: '', modelId: 'eleven_multilingual_v2', credentialId: '', credentialRequired: true, outputKey: 'audio' }],
    ['media.analyze', 'Interpretar imagem ou documento', 'Extrai informações de imagens ou PDFs quando o modelo configurado suporta o formato.', 'ai', 'ScanEye', { file: '{{current.file}}', prompt: 'Descreva as informações relevantes neste arquivo.', outputKey: 'analysis' }],
    ['logic.map_subflow', 'Processar cada item', 'Executa um subfluxo publicado para cada item, com resultados ordenados e erros individuais.', 'logic', 'Repeat', { items: '{{current.items}}', workflowId: '', concurrency: 1, errorMode: 'stop', maxItems: 1000, batchSize: 1, inputTemplate: { item: '{{item}}', index: '{{index}}', total: '{{total}}' }, modelCallsPerChild: 5, toolCallsPerChild: 5, outputKey: 'items' }],
    ['logic.async_subflow', 'Aguardar subfluxo durável', 'Executa um subfluxo publicado, incluindo suas esperas, e retoma com seu resultado.', 'logic', 'Workflow', { workflowId: '', arguments: {}, concurrency: 1, errorMode: 'stop', modelCallsPerChild: 5, toolCallsPerChild: 5, outputKey: 'subflow' }],
    ['logic.fork_subflows', 'Executar subfluxos em paralelo', 'Executa subfluxos isolados e aguarda os resultados, sem compartilhar variáveis entre ramificações.', 'logic', 'GitFork', { branches: [], concurrency: 1, errorMode: 'stop', modelCallsPerChild: 5, toolCallsPerChild: 5, outputKey: 'branches' }],
    ['logic.approval', 'Solicitar aprovação', 'Suspende a execução para um responsável aprovar argumentos exatos, com recusa e expiração.', 'logic', 'UserCheck', { title: 'Revisar operação', arguments: '{{current}}', expiresInMinutes: 1440, outputKey: 'approval' }],
    ['integration.connector', 'Operação reutilizável', 'Executa uma versão publicada de um conector privado do workspace.', 'integrations', 'Plug', { connectorId: '', version: 1, arguments: {}, outputKey: 'connector' }],
    ['output.webhook_response', 'Responder ao webhook', 'Define a resposta HTTP do webhook sem encerrar as etapas seguintes do fluxo.', 'output', 'Webhook', { status: 200, headers: {}, body: '{{current}}' }],
  ];
  const manifests: WorkflowNodeManifest[] = entries.map(([type, label, description, category, icon, defaultConfig]) => ({
    type, label, description, category, icon, tone: category === 'logic' ? 'amber' : 'cyan',
    inputPorts: [port('main', 'Entrada', 'input')],
    outputPorts: type === 'logic.approval' ? [port('approved', 'Aprovado', 'output'), port('denied', 'Recusado', 'output'), port('expired', 'Expirou', 'output'), port('error', 'Erro', 'output', 'error')] : [port('success', 'Continuar', 'output'), port('error', 'Erro', 'output', 'error')],
    defaultConfig: ['audio.elevenlabs', 'integration.connector'].includes(type) ? { ...defaultConfig, permissionScope: 'integrations:http' } : defaultConfig,
    sensitive: ['audio.elevenlabs', 'integration.connector'].includes(type), attachment: false, availability: 'stable', editorFields: [], requiredCapabilities: [],
    defaultTimeoutMs: 120000,
    defaultRetryPolicy: { maxAttempts: 1, initialDelayMs: 0, backoffMultiplier: 1, maxDelayMs: 0, retryableErrorCodes: [] },
  }));
  manifests.push({ ...manifests.find(entry => entry.type === 'integration.connector')!, type: 'tool.connector', label: 'Conector como ferramenta', category: 'tools', attachment: true,
    inputPorts: [], outputPorts: [{ ...port('tool', 'Ferramenta', 'output', 'tool'), multiple: true }],
    defaultConfig: { connectorId: '', version: 1, name: '', description: '', permissionScope: 'integrations:http' } });
  manifests.push({ ...manifests.find(entry => entry.type === 'integration.connector')!, type: 'tool.schedule_workflow', label: 'Agendar tarefa',
    description: 'Agenda um fluxo publicado em uma data futura após aprovação humana.', category: 'tools', icon: 'CalendarDays', attachment: true,
    inputPorts: [], outputPorts: [{ ...port('tool', 'Ferramenta', 'output', 'tool'), multiple: true }],
    defaultConfig: { workflowId: '', name: 'schedule_workflow', description: 'Agenda a execução do fluxo autorizado após aprovação.' } });
  manifests.push({ ...manifests.find(entry => entry.type === 'integration.connector')!, type: 'tool.email_notification', label: 'Enviar notificação por e-mail',
    description: 'Envia um alerta por SMTP ao destinatário configurado após aprovação humana.', category: 'tools', icon: 'Mail', attachment: true,
    inputPorts: [], outputPorts: [{ ...port('tool', 'Ferramenta', 'output', 'tool'), multiple: true }],
    defaultConfig: { credentialId: '', recipient: '', name: 'send_email_notification', description: 'Envia um alerta ao destinatário autorizado após aprovação.' } });
  manifests.push({ ...manifests.find(entry => entry.type === 'audio.elevenlabs')!, type: 'tool.text_to_speech', label: 'Gerar voz como ferramenta', category: 'tools', attachment: true,
    inputPorts: [], outputPorts: [{ ...port('tool', 'Ferramenta', 'output', 'tool'), multiple: true }],
    defaultConfig: { name: 'text_to_speech', description: 'Gera voz a partir de texto.', voiceId: '', modelId: 'eleven_multilingual_v2', credentialId: '', credentialRequired: true, permissionScope: 'integrations:http' } });
  manifests.push({ ...manifests.find(entry => entry.type === 'integration.connector')!, type: 'tool.zapier', label: 'Acionar Zapier', description: 'Aciona um Catch Hook autorizado após aprovação.', category: 'tools', attachment: true,
    inputPorts: [], outputPorts: [{ ...port('tool', 'Ferramenta', 'output', 'tool'), multiple: true }],
    defaultConfig: { credentialId: '', name: 'trigger_zapier', description: 'Aciona automação Zapier aprovada.' } });
  manifests.push({ ...manifests.find(entry => entry.type === 'integration.connector')!, type: 'tool.google_ads_report', label: 'Relatório Google Ads', description: 'Consulta métricas das campanhas da conta conectada ao workspace.', category: 'tools', attachment: true,
    inputPorts: [], outputPorts: [{ ...port('tool', 'Ferramenta', 'output', 'tool'), multiple: true }],
    defaultConfig: { name: 'google_ads_campaign_report', description: 'Consulta campanhas Google Ads.' } });
  manifests.push({ ...manifests.find(entry => entry.type === 'integration.connector')!, type: 'tool.whatsapp_reply', label: 'Responder WhatsApp Business', description: 'Responde ao atendimento atual pelo canal oficial após aprovação humana.', category: 'tools', attachment: true,
    inputPorts: [], outputPorts: [{ ...port('tool', 'Ferramenta', 'output', 'tool'), multiple: true }], defaultConfig: { name:'reply_whatsapp_business', description:'Responde ao atendimento oficial atual após aprovação.' } });
  manifests.push({ ...manifests.find(entry => entry.type === 'integration.connector')!, type: 'tool.whatsapp_history', label: 'Ler conversa WhatsApp Business', description: 'Lê o histórico autorizado da conversa atual, sem notas internas.', category: 'tools', attachment: true,
    inputPorts: [], outputPorts: [{ ...port('tool', 'Ferramenta', 'output', 'tool'), multiple: true }], defaultConfig: { name:'read_whatsapp_conversation', description:'Consulta a conversa oficial atual.' } });
  return manifests;
}
