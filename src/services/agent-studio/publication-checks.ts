import { StudioFlowContractSchema, validateStudioFlowPublication } from './flow-contract';
import { matchProhibitedStudioRequest } from './policy';
import type { AgentStudioDocument, CollectedFieldDefinition } from './types';
import type { PublicationValidationIssue } from './assistant-validator';
import { readStudioValue, resolveStudioEndpoint } from './data-mapping';
import { isSafeStudioPattern } from './collection';
import { studioDataAtSteps } from './data-availability';
import { checkStudioReasoningPublication } from './reasoning-publication';
import { StudioCatalogImageSchema } from './catalog-media';

/** Publication is stricter than draft storage: reject incomplete paths before any real conversation. */
export function checkStudioDependencies(doc: AgentStudioDocument): PublicationValidationIssue[] {
  const issues: PublicationValidationIssue[] = [];
  const add = (code: string, title: string, procedureId?: string, stepId?: string) => issues.push({ code, title, description: title, severity: 'error', procedureId, stepId });
  if (doc.flowBuilder?.enabled) {
    const contract = StudioFlowContractSchema.safeParse(doc.flowBuilder);
    if (!contract.success) add('FLOW_CONTRACT_INVALID', contract.error.issues.map((issue) => issue.message).join(' '));
    else {
      try { validateStudioFlowPublication(contract.data, doc.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').map((procedure) => procedure.id)); }
      catch (error) { add('FLOW_CONTRACT_INVALID', error instanceof Error ? error.message : 'Revise o contrato do Flowbuilder.'); }
      for (const field of [...contract.data.inputs, ...contract.data.outputs]) if (matchProhibitedStudioRequest(`Informe ${field.label} ${field.key}`, doc)) add('FLOW_PROHIBITED_DATA', `O campo ${field.label} não pode ser exposto ao fluxo segundo as regras do agente.`);
    }
  }
  const safeKey = (key: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key);
  const fieldCheck = (field: CollectedFieldDefinition, procedureId?: string, stepId?: string) => {
    const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const label = normalized(field.name);
    if (/\b(senha|password|secret|token|otp|cvv)\b|codigo de (autenticacao|verificacao|seguranca)/.test(label) ||
      (doc.rules.prohibitedDataLabels || []).some((name) => label.includes(normalized(name)))) add('PROHIBITED_COLLECTION', `O dado “${field.name}” não pode ser solicitado segundo as regras do agente.`, procedureId, stepId);
    if (!field.name.trim() || !field.promptMessage.trim() || !safeKey(field.variableKey)) add('FIELD_INCOMPLETE', 'Preencha o nome e a pergunta do dado coletado.', procedureId, stepId);
    if (['single_select', 'multi_select'].includes(field.type) && !field.optionsSourceKey && (!field.options?.length || field.options.some((option) => !option.trim()) || new Set(field.options).size !== field.options.length)) add('FIELD_OPTIONS_INVALID', 'Defina opções distintas e não vazias para a pergunta.', procedureId, stepId);
    if (field.minValue !== undefined && field.maxValue !== undefined && field.minValue > field.maxValue) add('FIELD_LIMITS_INVALID', 'O valor mínimo não pode superar o máximo.', procedureId, stepId);
    if (field.reuseFrom) {
      try { if (!field.reuseFrom.sourceValue.trim()) throw new Error(); readStudioValue({}, field.reuseFrom.sourceValue); } catch { add('FIELD_SOURCE_INVALID', 'Selecione uma origem válida para reaproveitar o dado.', procedureId, stepId); }
      if (field.reuseFrom.sourceType === 'contact_property' && !['name', 'email', 'phone', 'address'].includes(field.reuseFrom.sourceValue) && !field.reuseFrom.sourceValue.startsWith('custom_fields.')) add('FIELD_SOURCE_FORBIDDEN', 'Este dado do contato não está disponível para coleta.', procedureId, stepId);
      if (field.type === 'file') add('FILE_SOURCE_FORBIDDEN', 'Arquivos devem ser recebidos pelo canal autorizado.', procedureId, stepId);
    }
    if (field.validationRegex) {
      try { if (!isSafeStudioPattern(field.validationRegex)) throw new Error(); }
      catch { add('FIELD_PATTERN_INVALID', 'Revise a expressão de validação deste campo.', procedureId, stepId); }
    }
  };
  const globalKeys = new Set<string>();
  if (doc.understandStage.askInitialData) for (const field of doc.understandStage.initialFields) {
    fieldCheck(field); if (globalKeys.has(field.variableKey)) add('DUPLICATE_FIELD', 'Dois dados iniciais usam a mesma identificação.');
    if (field.required) globalKeys.add(field.variableKey);
  }
  if (doc.rules.operatingHoursEnabled) {
    if (![doc.rules.operatingHoursStart, doc.rules.operatingHoursEnd].every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || doc.rules.operatingHoursStart === doc.rules.operatingHoursEnd) add('INVALID_HOURS', 'Defina horários de início e fim diferentes e válidos.');
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: doc.rules.timeZone || 'America/Sao_Paulo' }).format(); } catch { add('INVALID_TIMEZONE', 'Selecione um fuso horário válido.'); }
    if (doc.rules.operatingDays?.length === 0) add('INVALID_DAYS', 'Selecione pelo menos um dia de atendimento.');
  }
  const procedureIds = new Set<string>();
  for (const procedure of doc.resolveStage.procedures.filter((p) => p.status !== 'archived')) {
    if (procedureIds.has(procedure.id)) add('DUPLICATE_PROCEDURE', 'Há procedimentos com a mesma identificação.', procedure.id);
    procedureIds.add(procedure.id);
    const availability = studioDataAtSteps(doc, procedure);
    const indexes = new Map(procedure.steps.map((step, index) => [step.id, index]));
    if (indexes.size !== procedure.steps.length) add('DUPLICATE_STEP', 'Há etapas com a mesma identificação.', procedure.id);
    procedure.steps.forEach((step, index) => {
      const error = (code: string, title: string) => add(code, `${step.title || `Etapa ${index + 1}`}: ${title}`, procedure.id, step.id);
      if (!step.title.trim()) error('STEP_TITLE_EMPTY', 'defina um título.');
      const definite = new Set(availability[index].before);
      if (!availability[index].reachable) error('UNREACHABLE_STEP', 'nenhum caminho chega a esta etapa.');
      const dataRequirement = (key: string) => {
        const root = key.replace(/^\$\./, '').split(/[.[]/)[0];
        if (!definite.has(root)) error('DATA_NOT_AVAILABLE', `o dado “${key}” não está garantido em todos os caminhos anteriores.`);
        try { readStudioValue({}, key); } catch { error('INVALID_DATA_PATH', 'o caminho de um dado é inválido.'); }
      };
      const mappings = [...(step.httpRequest?.sentDataMappings || []), ...(step.nativeDataMappings || []), ...(step.mcpTool?.argumentMappings || []).map((arg) => ({ apiField: arg.argumentName, sourceType: arg.sourceType || 'collected_field', sourceValue: arg.sourceChipKey }))];
      for (const mapping of mappings) {
        if (!mapping.apiField.trim() || !mapping.sourceValue.trim()) error('MAPPING_INCOMPLETE', 'preencha origem e destino de cada dado enviado.');
        if (mapping.sourceType === 'collected_field' || mapping.sourceType === 'step_output') dataRequirement(mapping.sourceValue);
      }
      for (const key of step.messageDataKeys || []) dataRequirement(key);
      if (step.type === 'collect_data' && step.collectField) {
        if (step.collectField.optionsSourceKey) dataRequirement(step.collectField.optionsSourceKey);
        fieldCheck(step.collectField, procedure.id, step.id);
        if (step.collectField.required) definite.add(step.collectField.variableKey);
      }
      if (['message', 'respond'].includes(step.type) && !step.messageText?.trim() && !step.messageDataKeys?.length) error('EMPTY_RESPONSE', 'escreva a mensagem ou escolha um resultado para enviar.');
      if (step.type === 'handoff' && !step.handoffTeam?.trim() && !doc.concludeStage.handoffTeam.trim()) error('MISSING_STEP_TEAM', 'selecione a equipe de destino.');
      if (step.type === 'knowledge_lookup' && !step.knowledgeCollectionId && !doc.resolveStage.knowledgeCollectionIds.length) error('MISSING_KNOWLEDGE', 'selecione uma base de conhecimento.');
      if (step.type === 'native_action') {
        if (step.nativeActionPayload?.flexibleScope === true) {
          if (step.nativeActionType !== 'sgp_fetch_contact_panel_data') error('SGP_SCOPE_ACTION_INVALID', 'escopo variável está disponível apenas para consulta ao painel SGP.');
          if (doc.resolveStage.conversationMode !== 'adaptive' || !doc.resolveStage.reasoning?.enabled) error('SGP_SCOPE_REQUIRES_REASONING', 'ative o atendimento adaptativo com raciocínio para consultar múltiplos contratos por pedido.');
          if (step.nativeDataMappings?.some((mapping) => mapping.apiField === 'contractId')) error('SGP_SCOPE_CONFLICT', 'remova o contrato fixo para permitir que cada pedido selecione seu escopo.');
        }
        if (step.nativeActionType === 'show_catalog_image') {
          const image = StudioCatalogImageSchema.safeParse(step.nativeActionPayload);
          if (!image.success) error('CATALOG_IMAGE_INVALID', 'configure catálogo, campos do produto e servidores autorizados para as fotos.');
          else {
            if (image.data.selectionMode === 'recommendation' && !(doc.resolveStage.conversationMode === 'adaptive' && doc.resolveStage.reasoning?.enabled)) {
              error('CATALOG_RECOMMENDATION_REQUIRES_REASONING', 'ative o novo atendimento adaptativo para a IA recomendar produtos.');
            }
            if (image.data.selectionMode !== 'recommendation' && step.nativeDataMappings?.filter((mapping) => mapping.apiField === 'productId').length !== 1) {
              error('CATALOG_PRODUCT_REQUIRED', 'selecione o dado que identifica o produto escolhido pelo cliente.');
            }
            const catalog = procedure.steps.flatMap((source) => source.httpRequest?.outputMappings || source.mcpTool?.outputMappings || [])
              .find((output) => output.chipKey === image.data.catalogKey && !output.sensitive);
            if (!catalog) error('CATALOG_SOURCE_REQUIRED', 'selecione um catálogo não sensível retornado por uma integração deste procedimento.');
          }
        }
        if (step.nativeActionType === 'close_chat' && index !== procedure.steps.length - 1) error('CLOSE_NOT_TERMINAL', 'o encerramento deve ser a última etapa do procedimento.');
        if (!step.nativeActionType) error('NATIVE_ACTION_MISSING', 'selecione uma ação.');
        if (['add_tag', 'remove_tag'].includes(step.nativeActionType || '') && !step.nativeActionPayload?.tagId) error('TAG_MISSING', 'selecione uma etiqueta.');
        if (step.nativeActionType === 'update_crm_field' && !step.nativeDataMappings?.length) error('CRM_MAPPING_MISSING', 'selecione o campo de CRM e o dado a salvar.');
      }
      if (step.httpRequest) {
        if (step.httpRequest.idempotencyKey?.trim()) error('UNSUPPORTED_IDEMPOTENCY', 'remova a chave de idempotência legada. Escritas não são repetidas automaticamente; resultados incertos seguem para revisão.');
        if (step.httpRequest.fallbackAction === 'retry' && (step.httpRequest.method !== 'GET' || step.httpRequest.requiresConfirmation || step.httpRequest.maxRetries < 1)) error('UNSAFE_RETRY', 'repetição automática exige uma consulta GET sem confirmação e um limite de tentativas.');
        if (step.httpRequest.method === 'GET' && (step.httpRequest.bodyJson?.trim() || step.httpRequest.sentDataMappings.some((mapping) => mapping.location === 'body'))) error('GET_BODY_UNSUPPORTED', 'envie os dados da consulta pelos parâmetros da URL, não pelo corpo.');
        try { resolveStudioEndpoint(step.httpRequest.url.replace(/\{[^}]+\}/g, 'sample'), step.httpRequest.connectionId ? 'https://connection.example' : undefined); }
        catch { error('UNSAFE_HTTP_URL', 'use HTTPS e um caminho dentro da conexão selecionada.'); }
        if (!step.httpRequest.connectionId && step.httpRequest.authType !== 'none') error('AUTH_CONNECTION_MISSING', 'selecione uma conexão segura para autenticar a chamada.');
        if (Object.keys(step.httpRequest.headers || {}).some((key) => /authorization|cookie|api.key/i.test(key))) error('INLINE_CREDENTIAL', 'guarde a autenticação em uma conexão, não nos cabeçalhos do procedimento.');
        if (step.httpRequest.bodyJson?.trim()) { try { const body = JSON.parse(step.httpRequest.bodyJson); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); } catch { error('HTTP_BODY_INVALID', 'o corpo fixo deve ser um objeto JSON válido.'); } }
      }
      for (const output of step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []) {
        if (!output.chipLabel.trim() || !output.jsonPath.trim() || !safeKey(output.chipKey)) error('OUTPUT_INVALID', 'configure nome e caminho de cada resultado.');
        if (definite.has(output.chipKey)) error('OUTPUT_OVERWRITE', 'um resultado sobrescreve um dado anterior. Crie outro resultado.');
        if (output.required !== false) definite.add(output.chipKey);
      }
      const target = (id: string | null | undefined) => {
        if (id === null) return;
        const next = id ? indexes.get(id) : index + 1;
        if (next === undefined || (id && next <= index)) error('INVALID_NEXT_STEP', 'escolha uma etapa posterior válida.');
      };
      if (step.type === 'decision' || step.type === 'validate_data') {
        const branches = step.decisionBranches || [];
        if (!branches.length || branches.filter((branch) => branch.isDefault).length !== 1) error('DECISION_DEFAULT_MISSING', 'defina os caminhos e um único caminho “Caso contrário”.');
        if (new Set(branches.map((branch) => branch.id)).size !== branches.length) error('DUPLICATE_BRANCH', 'os caminhos devem ter identificações diferentes.');
        for (const branch of branches) {
          if (!branch.conditionLabel.trim()) error('BRANCH_NAME_MISSING', 'dê um nome a cada caminho.');
          if (branch.condition) {
            if (!['exists', 'not_exists'].includes(branch.condition.operator)) dataRequirement(branch.condition.fieldKey);
            if (!['exists', 'not_exists'].includes(branch.condition.operator) && !branch.condition.value?.trim()) error('BRANCH_VALUE_MISSING', 'informe o valor da condição.');
          }
          if (branch.actionType === 'handoff' && !branch.actionValue?.trim()) error('BRANCH_TEAM_MISSING', 'selecione a equipe do caminho de transferência.');
          if (branch.actionType === 'respond' && !branch.actionValue?.trim()) error('BRANCH_RESPONSE_MISSING', 'escreva a resposta deste caminho.');
          if (branch.actionType === 'collect_data' && !branch.nextStepId) error('BRANCH_COLLECT_MISSING', 'selecione a próxima etapa de coleta.');
          if (!['respond', 'handoff'].includes(branch.actionType) || branch.nextStepId) target(branch.nextStepId ?? step.nextStepId);
        }
      } else if (!['finish', 'handoff'].includes(step.type) && step.nativeActionType !== 'close_chat') target(step.nextStepId);
    });
  }
  return [...issues, ...checkStudioReasoningPublication(doc)];
}
