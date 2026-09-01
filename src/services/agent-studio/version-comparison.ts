import type { AgentStudioDocument } from './types';

export function compareStudioVersions(previous: AgentStudioDocument, current: AgentStudioDocument) {
  const changes: string[] = [];
  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  if (changed(previous.aiModel, current.aiModel)) changes.push('Modelo de IA alterado.');
  if (changed([previous.name, previous.objective, previous.serviceType, previous.language], [current.name, current.objective, current.serviceType, current.language])) changes.push('Identidade, objetivo ou idioma alterados.');
  if (changed(previous.understandStage, current.understandStage)) changes.push('Boas-vindas, dados iniciais ou resposta fora do escopo alterados.');
  if (changed(previous.concludeStage, current.concludeStage)) changes.push('Conclusão, equipe ou tentativas alteradas.');
  if (changed(previous.rules, current.rules)) changes.push('Regras de atendimento alteradas.');
  if (changed([previous.appearance, previous.avatarUrl], [current.appearance, current.avatarUrl])) changes.push('Aparência alterada.');
  if (changed([previous.inlineKnowledge, previous.resolveStage.knowledgeCollectionIds, previous.resolveStage.allowGeneralAiChat], [current.inlineKnowledge, current.resolveStage.knowledgeCollectionIds, current.resolveStage.allowGeneralAiChat])) changes.push('Fontes ou permissões de conhecimento alteradas.');
  const comparable = (value: AgentStudioDocument['resolveStage']['procedures'][number]) => ({ ...value, updatedAt: '', publishedVersion: null, status: value.status === 'archived' ? 'archived' : 'active' });
  for (const procedure of current.resolveStage.procedures) {
    const before = previous.resolveStage.procedures.find((item) => item.id === procedure.id);
    if (!before) changes.push(`Procedimento adicionado: ${procedure.name}.`);
    else if (changed(comparable(before), comparable(procedure))) changes.push(`Procedimento alterado: ${procedure.name} (${before.steps.length} → ${procedure.steps.length} etapas).`);
  }
  for (const procedure of previous.resolveStage.procedures) if (!current.resolveStage.procedures.some((item) => item.id === procedure.id)) changes.push(`Procedimento removido: ${procedure.name}.`);
  return changes;
}
