import type { WorkflowNodeManifest } from './catalog';
import type { NodePort } from './types';

const port = (id: string, label: string, connectionType: NodePort['connectionType'], direction: NodePort['direction'], multiple = false): NodePort => ({ id, label, connectionType, direction, multiple, required: false });
export function studioFlowManifests(): WorkflowNodeManifest[] {
  return ([
    ['ai.studio_agent', 'Agente do Studio no fluxo', false, false],
    ['integration.studio_procedure', 'Habilidade do Studio', false, true],
    ['tool.studio_agent', 'Agente especialista', true, false],
    ['tool.studio_procedure', 'Habilidade como ferramenta', true, true],
  ] as const).map(([type, label, attachment, procedure]) => ({
    type, label, category: attachment ? 'tools' : 'ai', icon: procedure ? 'Wrench' : 'Bot', tone: 'cyan',
    description: procedure ? 'Reutiliza um procedimento exportado por uma versão publicada do Studio.' : attachment ? 'Disponibiliza um agente publicado como especialista, devolvendo dados ao agente principal.' : 'Conversa ou executa uma tarefa usando uma versão publicada e devolve o controle ao fluxo.',
    inputPorts: [...(!attachment ? [port('main', 'Entrada', 'main', 'input', true)] : []), ...(!procedure ? [port('model', 'Modelo', 'model', 'input'), port('tools', 'Ferramentas e especialistas', 'tool', 'input', true), port('knowledge', 'Conhecimento', 'knowledge', 'input', true), port('memory', 'Memória', 'memory', 'input')] : [])],
    outputPorts: attachment ? [port('tool', 'Ferramenta', 'tool', 'output', true)] : [port('completed', 'Concluído', 'main', 'output'), port('needs_input', 'Dados ausentes', 'main', 'output'), port('handoff', 'Encaminhar', 'main', 'output'), port('close_requested', 'Encerramento solicitado', 'main', 'output'), port('limit_reached', 'Limite atingido', 'main', 'output'), port('error', 'Erro', 'error', 'output')],
    defaultConfig: { agentId: '', releaseId: '', ...(procedure ? { procedureId: '' } : {}), mode: attachment ? 'task' : 'conversation', inputMappings: [], outputKey: 'studioResult', ...(attachment ? { name: '', description: '' } : { task: '', maxModelCalls: 8, maxToolCalls: 20, timeoutMs: 90000, customErrorRoute: false }) },
    defaultTimeoutMs: 180000,
    defaultRetryPolicy: { maxAttempts: 1, initialDelayMs: 1000, backoffMultiplier: 1, maxDelayMs: 1000, retryableErrorCodes: [] },
    attachment, availability: 'stable', editorFields: [], requiredCapabilities: ['studio_flow'],
  }));
}
