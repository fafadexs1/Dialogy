import type { AgentStudioDocument, ProcedureStep } from './types';
import { readStudioValue, resolveStudioMapping, type StudioDataContext } from './data-mapping';
import { StudioCatalogImageSchema, resolveStudioCatalogImage } from './catalog-media';
import { studioReasoningPaths } from './reasoning-paths';

export type StudioReasoningCapability = {
  id: string; procedureId: string; stepId: string; title: string; purpose: string;
  readOnly: boolean; requiresConfirmation: boolean; prerequisites: string[];
  ready: boolean; blockedReason: string | null;
  outputs: string[];
  inputs: Array<{ sourceType: string; sourceKey: string | null; ready: boolean }>;
};

export function studioStepIsReadOnly(step: ProcedureStep) {
  return step.type === 'http_request' ? step.httpRequest?.method === 'GET'
    : step.type === 'mcp_tool_call' ? step.mcpTool?.riskLevel === 'read_only'
    : step.type === 'native_action' && ['sgp_fetch_contracts', 'sgp_fetch_contact_panel_data'].includes(step.nativeActionType || '');
}

/** Only explicit publication grants flexible ordering. Legacy sequence edges grant no new capabilities. */
export function compileStudioReasoningCapabilities(document: AgentStudioDocument, procedureId: string | null,
  context: StudioDataContext, completedSteps: Set<string>, selectedBranches: Record<string, string> = {}): StudioReasoningCapability[] {
  const procedure = document.resolveStage.procedures.find((p) => p.id === procedureId && p.status !== 'archived');
  if (!procedure) return [];
  const paths = studioReasoningPaths(procedure, context, completedSteps, selectedBranches);
  return procedure.steps.filter((step) => step.adaptiveAccess?.enabled
    && ['http_request', 'mcp_tool_call', 'native_action'].includes(step.type)).map((step) => {
    const readOnly = studioStepIsReadOnly(step);
    // Sending a published product photo is conversational output. Keep effect reservation
    // and uncertain-delivery protection, but do not ask consent as if it were a purchase.
    const conversationalMedia = step.type === 'native_action' && step.nativeActionType === 'show_catalog_image';
    let blockedReason: string | null = null;
    if (!step.httpRequest && !step.mcpTool && !step.nativeActionType) blockedReason = 'Capacidade incompleta.';
    const prerequisites = step.adaptiveAccess!.requiresSteps;
    if (prerequisites.some((id) => !completedSteps.has(id))) blockedReason = 'Etapas obrigatórias ainda não concluídas.';
    const mappings = [...(step.httpRequest?.sentDataMappings || []), ...(step.nativeActionType === 'show_catalog_image' && step.nativeActionPayload?.selectionMode === 'recommendation' ? [] : step.nativeDataMappings || []),
      ...(step.mcpTool?.argumentMappings || []).map((m) => ({ sourceType: m.sourceType, sourceValue: m.sourceChipKey, valueType: m.valueType }))];
    const inputs = mappings.map((mapping) => {
      let ready = true;
      try { resolveStudioMapping(mapping, context); }
      catch { ready = false; blockedReason = 'Faltam entradas válidas para esta capacidade.'; }
      return { sourceType: mapping.sourceType || 'collected_field',
        sourceKey: mapping.sourceType === 'static_value' ? null : mapping.sourceValue, ready };
    });
    if (conversationalMedia) {
      const config = StudioCatalogImageSchema.safeParse(step.nativeActionPayload);
      if (!config.success) blockedReason = 'Configure o catálogo e a foto antes de executar esta ação.';
      else {
        const sources = procedure.steps.filter((source) => (source.httpRequest?.outputMappings || source.mcpTool?.outputMappings || [])
          .some((output) => output.chipKey === config.data.catalogKey && !output.sensitive));
        if (!sources.some((source) => completedSteps.has(source.id))) blockedReason = 'Consulte o catálogo deste procedimento antes de mostrar uma foto.';
        else try {
          const catalog = readStudioValue(context.values, config.data.catalogKey);
          if (!Array.isArray(catalog) || !catalog.length || catalog.length > 100) throw new Error('Catálogo indisponível.');
          if (config.data.selectionMode !== 'recommendation') {
            const selection = step.nativeDataMappings?.find((mapping) => mapping.apiField === 'productId');
            if (!selection) throw new Error('Produto não configurado.');
            resolveStudioCatalogImage(config.data, resolveStudioMapping(selection, context), context.values);
          }
        } catch { blockedReason = 'O catálogo ou a foto do produto estão indisponíveis. Consulte os dados atuais ou escolha outra opção válida.'; }
      }
    }
    if (!paths.reachable.has(step.id)) blockedReason = 'Esta ação depende de um caminho comercial ainda não autorizado pelos dados ou pela avaliação da situação.';
    return { id: `${procedure.id}:${step.id}`, procedureId: procedure.id, stepId: step.id,
      title: step.title, purpose: step.nativeActionType === 'show_catalog_image' && step.nativeActionPayload?.selectionMode === 'recommendation'
        ? `${step.title}. Recomende um produto real do catálogo ${String(step.nativeActionPayload.catalogKey)}. Em query, envie o identificador do produto como JSON (string entre aspas ou número). Não registre a recomendação como escolha do cliente.`
        : step.nativeActionType === 'sgp_fetch_contracts'
        ? `${step.title}. Consulta no SGP os contratos ativos, planos e endereços vinculados ao CPF ou CNPJ do titular. Use sempre que o cliente informar o CPF ou perguntar quais contratos ele tem, para listar os contratos ou identificar a instalação correta.`
        : step.nativeActionType === 'sgp_fetch_contact_panel_data'
        ? `${step.title}. Consulta os dados completos do cliente e status de conexão no SGP para o contrato selecionado.`
        : step.subtitle || step.httpRequest?.objective || step.title,
      readOnly, requiresConfirmation: (!readOnly && !conversationalMedia) || Boolean(step.httpRequest?.requiresConfirmation || step.mcpTool?.requiresConfirmation),
      prerequisites, ready: !blockedReason, blockedReason, inputs,
      outputs: [
        ...(step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []).filter((o) => !o.sensitive).map((o) => o.chipKey),
        ...(step.nativeActionType === 'sgp_fetch_contracts' ? ['contracts', 'contracts_count', 'customer_name', 'cpf_cnpj'] : []),
        ...(step.nativeActionType === 'sgp_fetch_contact_panel_data' ? ['contracts', 'customer_name', 'online_contracts', 'invoices', 'open_invoices', 'overdue_invoices', 'ip_address', 'login', 'mac_address', 'connection_status'] : []),
      ] };
  });
}
