import { createHash } from 'node:crypto';
import { createDefaultAgentStudioDocument, type AgentStudioDocument } from './types';
import type { StudioMigrationInventory } from './migration-inventory';

export type StudioMigrationItem = { key: string; title: string; detail: string; status: 'preserved' | 'review' };
export type StudioMigrationReport = { sourceHash: string; items: StudioMigrationItem[]; requiresReview: boolean; inventory?: StudioMigrationInventory };

/** Deliberate allowlist: never copy API keys or arbitrary config-row properties into authoring responses. */
export function legacyStudioBackup(row: Record<string, unknown>) {
  return Object.fromEntries(['name', 'ai_model', 'transcription_model', 'knowledge_base', 'knowledge_base_documents',
    'knowledge_collections', 'enabled_tool_names', 'flow_graph', 'workflow_definition', 'workflow_builder_mode',
    'workflow_runtime_v2_mode', 'active_workflow_id', 'active_workflow_version', 'agent_domain_pack_id', 'default_fallback_reply',
    'escalation_policy', 'closing_policy', 'inactivity_timeout_seconds', 'is_active', 'is_private'].map((key) => [key, row[key] ?? null]));
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

export function planStudioMigration(row: Record<string, unknown>, inventory?: StudioMigrationInventory): { report: StudioMigrationReport; document: AgentStudioDocument; backup: Record<string, unknown> } {
  const backup = legacyStudioBackup(row);
  const sourceHash = createHash('sha256').update(JSON.stringify(stable(backup))).digest('hex');
  const document = createDefaultAgentStudioDocument(String(row.id), String(row.workspace_id), String(row.name || 'Agente de atendimento'));
  const items: StudioMigrationItem[] = [
    { key: 'identity', title: 'Identidade e acesso', detail: 'Nome, modelo administrativo e visibilidade permanecem vinculados ao mesmo agente.', status: 'preserved' },
    { key: 'channels', title: 'Conversas e canais', detail: inventory
      ? `${inventory.conversations} conversa(s), ${inventory.systemAgents} vínculo(s) de atendimento, ${inventory.webchatWidgets} widget(s) e ${inventory.publishedWorkflowReferences} fluxo(s) publicado(s) foram encontrados. Nenhum será apagado ou trocado por esta preparação.`
      : 'Nenhuma conversa, canal, widget ou fluxo será apagado ou trocado por esta preparação.', status: 'preserved' },
  ];
  const addReview = (key: string, title: string, detail: string) => items.push({ key, title, detail, status: 'review' });
  if (typeof row.default_fallback_reply === 'string') document.understandStage.outOfScopeMessage = row.default_fallback_reply;
  if (Array.isArray(row.knowledge_collections)) document.resolveStage.knowledgeCollectionIds = row.knowledge_collections.flatMap((value) => value && typeof value.id === 'string' ? [value.id] : []);
  if (row.knowledge_base || (Array.isArray(row.knowledge_base_documents) && row.knowledge_base_documents.length)) {
    addReview('knowledge', 'Conhecimento e instruções anteriores', 'Os documentos permanecem no agente. Revise fontes, instruções e validade; instruções antigas não são convertidas automaticamente em procedimentos.');
  }
  const graph = row.flow_graph && typeof row.flow_graph === 'object' ? row.flow_graph as Record<string, unknown> : {};
  if (Array.isArray(graph.nodes)) for (const [index, node] of graph.nodes.entries()) {
    addReview(`legacy-node-${index}`, String(node.title || `Etapa anterior ${index + 1}`), `Etapa anterior do tipo ${String(node.kind || 'desconhecido')}. Recrie seu comportamento no procedimento ou confirme a retirada intencional; conexões não serão interpretadas silenciosamente.`);
  }
  if (row.workflow_definition || row.active_workflow_id) addReview('workflow', 'Automação vinculada', 'O fluxo e a versão anteriores são preservados. Revise todas as condições e ações antes de substituir o motor deste agente.');
  if (Array.isArray(row.enabled_tool_names) && row.enabled_tool_names.length) addReview('tools', 'Ferramentas autorizadas anteriormente', `${row.enabled_tool_names.length} ferramenta(s) precisam ser vinculadas explicitamente a etapas API, MCP ou ações Dialogy. Nenhuma é liberada automaticamente.`);
  if (row.escalation_policy || row.closing_policy || row.inactivity_timeout_seconds) addReview('policies', 'Transferência, encerramento e inatividade', 'Reproduza ou substitua conscientemente as políticas anteriores nas regras e na conclusão do agente.');
  if (row.is_active) addReview('activation', 'Troca do atendimento em produção', 'Preparar e salvar não muda o atendimento. Publicar a primeira versão do Estúdio substitui o comportamento para novas sessões; faça o aceite antes disso.');
  document.migrationReview = { sourceHash, acknowledgedKeys: [] };
  return { report: { sourceHash, items, requiresReview: items.some((item) => item.status === 'review'), inventory }, document, backup };
}
