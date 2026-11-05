import type { AgentStudioDocument } from './types';
import type { PublicationValidationIssue } from './assistant-validator';
import { StudioCatalogImageSchema } from './catalog-media';

/** Validate executable configuration, without prescribing the model's conversational decisions. */
export function checkStudioReasoningPublication(document: AgentStudioDocument): PublicationValidationIssue[] {
  if (!document.resolveStage.reasoning?.enabled) return [];
  const issues: PublicationValidationIssue[] = [];
  const add = (code: string, title: string, procedureId?: string, stepId?: string) => issues.push({ code, title, description: title,
    severity: 'error', stageId: 'resolve', procedureId, stepId });
  if (document.resolveStage.conversationMode !== 'adaptive') add('REASONING_MODE_REQUIRED', 'Selecione o modo adaptativo para habilitar o raciocínio.');
  for (const model of [document.aiModel, document.resolveStage.reasoning.supportModel].filter(Boolean)) {
    if (!/^(openai|deepseek)\//.test(model!)) add('REASONING_PROVIDER_UNSUPPORTED', 'Selecione um modelo OpenAI ou DeepSeek configurado para o novo núcleo.');
  }
  for (const procedure of document.resolveStage.procedures.filter((p) => p.status !== 'archived')) {
    const operations = procedure.steps.filter((s) => ['http_request', 'mcp_tool_call', 'native_action'].includes(s.type));
    const enabled = new Map(operations.filter((s) => s.adaptiveAccess?.enabled).map((s) => [s.id, s]));
    for (const step of operations) {
      if (step.nativeActionType === 'show_catalog_image') {
        const image = StudioCatalogImageSchema.safeParse(step.nativeActionPayload);
        const product = step.nativeDataMappings?.filter((mapping) => mapping.apiField === 'productId');
        const outputs = procedure.steps.flatMap((source) => source.httpRequest?.outputMappings || source.mcpTool?.outputMappings || []);
        if (!image.success || (image.data.selectionMode !== 'recommendation' && product?.length !== 1) || !outputs.some((output) => image.success && output.chipKey === image.data.catalogKey && !output.sensitive)) {
          add('REASONING_IMAGE_CONFIGURATION', 'Configure uma imagem vinculada a um catálogo de integração publicado e ao produto selecionado.', procedure.id, step.id);
        }
      }
      if (!step.adaptiveAccess) add('REASONING_CAPABILITY_REVIEW', `Revise se a IA pode usar a ação “${step.title}” no atendimento adaptativo.`, procedure.id, step.id);
      if (!step.adaptiveAccess?.enabled) continue;
      for (const prerequisite of step.adaptiveAccess.requiresSteps) {
        if (!enabled.has(prerequisite) || prerequisite === step.id) add('REASONING_DEPENDENCY_INVALID', `A ação “${step.title}” depende de uma ação indisponível ou dela mesma.`, procedure.id, step.id);
      }
    }
    const visiting = new Set<string>(), visited = new Set<string>();
    const cycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const dependency of enabled.get(id)?.adaptiveAccess?.requiresSteps || []) if (enabled.has(dependency) && cycle(dependency)) return true;
      visiting.delete(id); visited.add(id); return false;
    };
    if ([...enabled.keys()].some(cycle)) add('REASONING_DEPENDENCY_CYCLE', 'As dependências das ações formam um ciclo que impede a execução.', procedure.id);
    for (const step of procedure.steps) if (['decision', 'validate_data'].includes(step.type)) {
      const branches = step.decisionBranches || [];
      if (!branches.length) add('REASONING_BRANCH_EMPTY', `Defina os caminhos de “${step.title}”.`, procedure.id, step.id);
      for (const branch of branches) {
        if (!branch.condition) continue;
        const key = branch.condition.fieldKey;
        const producers = operations.filter((source) => (source.httpRequest?.outputMappings || source.mcpTool?.outputMappings || [])
          .some((output) => key === output.chipKey || key.startsWith(`${output.chipKey}.`)));
        if (producers.length && !producers.some((source) => enabled.has(source.id))) {
          add('REASONING_CONDITION_SOURCE_UNAVAILABLE', `A condição “${step.title}” depende de uma consulta não disponibilizada à IA.`, procedure.id, step.id);
        }
      }
    }
  }
  return issues;
}
