import type {
  AgentStudioDocument,
  CollectedFieldDefinition,
  ProcedureDocument,
} from './types';
import { checkStudioDependencies } from './publication-checks';
import { matchProhibitedStudioField, matchProhibitedStudioRequest } from './policy';

export type ProcedureAssistanceSuggestion = {
  id: string;
  type: 'missing_data_step' | 'unused_data' | 'missing_fallback' | 'sensitive_unconfirmed';
  title: string;
  description: string;
  recommendedField?: Partial<CollectedFieldDefinition>;
  missingVariableName?: string;
  suggestedStepIndex: number;
};

export type PublicationValidationIssue = {
  code: string;
  severity: 'error' | 'warning';
  title: string;
  description: string;
  stageId?: 'understand' | 'resolve' | 'conclude';
  procedureId?: string;
  stepId?: string;
};

export type PublicationValidationResult = {
  valid: boolean;
  issues: PublicationValidationIssue[];
};

/**
 * Analyses a procedure and finds missing dependencies (e.g. API/MCP requires CPF, but no preceding collect_data step exists).
 */
export function analyzeProcedureAssistance(procedure: ProcedureDocument, initialFields: CollectedFieldDefinition[] = []): ProcedureAssistanceSuggestion[] {
  const suggestions: ProcedureAssistanceSuggestion[] = [];
  const collectedKeys = new Set<string>(initialFields.flatMap((field) => [field.variableKey.toLowerCase(), field.name.toLowerCase()]));

  procedure.steps.forEach((step, index) => {
    if (step.type === 'collect_data' && step.collectField) {
      collectedKeys.add(step.collectField.variableKey.toLowerCase());
      collectedKeys.add(step.collectField.name.toLowerCase());
    }

    // Check HTTP Request requirements
    if (step.type === 'http_request' && step.httpRequest) {
      step.httpRequest.sentDataMappings.forEach((mapping) => {
        if (mapping.sourceType === 'collected_field') {
          const key = mapping.sourceValue.toLowerCase();
          if (!collectedKeys.has(key) && !collectedKeys.has(mapping.apiField.toLowerCase())) {
            suggestions.push({
              id: `suggest_${step.id}_${mapping.apiField}`,
              type: 'missing_data_step',
              title: `Esta ação precisa de: ${mapping.apiField.toUpperCase()}`,
              description: `A etapa "${step.title}" envia o campo "${mapping.apiField}", mas ele ainda não foi coletado do cliente. Deseja adicionar uma etapa para coletá-lo?`,
              suggestedStepIndex: index,
              missingVariableName: mapping.sourceValue,
              recommendedField: {
                name: mapping.apiField.toUpperCase(),
                variableKey: mapping.sourceValue,
                type: mapping.apiField.toLowerCase().includes('cpf')
                  ? 'cpf'
                  : mapping.apiField.toLowerCase().includes('email')
                  ? 'email'
                  : mapping.apiField.toLowerCase().includes('phone')
                  ? 'phone'
                  : 'text',
                promptMessage: `Por favor, informe seu ${mapping.apiField}.`,
                required: true,
              },
            });
          }
        }
      });
    }

    // Check MCP Tool argument requirements
    if (step.type === 'mcp_tool_call' && step.mcpTool) {
      step.mcpTool.argumentMappings.forEach((arg) => {
        const key = arg.sourceChipKey.toLowerCase();
        if ((!arg.sourceType || ['collected_field', 'step_output'].includes(arg.sourceType)) && !collectedKeys.has(key)) {
          suggestions.push({
            id: `suggest_mcp_${step.id}_${arg.argumentName}`,
            type: 'missing_data_step',
            title: `A ferramenta precisa de: ${arg.sourceChipLabel || arg.argumentName}`,
            description: `A ferramenta MCP "${step.mcpTool?.friendlyToolName}" exige o argumento "${arg.argumentName}". Deseja adicionar uma etapa de coleta antes de executá-la?`,
            suggestedStepIndex: index,
            missingVariableName: arg.sourceChipKey,
            recommendedField: {
              name: arg.sourceChipLabel || arg.argumentName,
              variableKey: arg.sourceChipKey,
              type: 'text',
              promptMessage: `Por favor, informe o dado: ${arg.sourceChipLabel || arg.argumentName}.`,
              required: true,
            },
          });
        }
      });
    }
    for (const output of step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || []) collectedKeys.add(output.chipKey.toLowerCase());
  });

  return suggestions;
}

/**
 * Validates the entire Agent Studio Document before publication.
 */
export function validateAgentForPublication(doc: AgentStudioDocument): PublicationValidationResult {
  const issues: PublicationValidationIssue[] = checkStudioDependencies(doc);
  const allFields: Array<{ field: CollectedFieldDefinition; stageId: 'understand' | 'resolve'; procedureId?: string; stepId?: string }> = [
    ...doc.understandStage.initialFields.map((field) => ({ field, stageId: 'understand' as const })),
    ...doc.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').flatMap((procedure) => procedure.steps.flatMap((step) => step.collectField
      ? [{ field: step.collectField, stageId: 'resolve' as const, procedureId: procedure.id, stepId: step.id }] : [])),
  ];
  for (const item of allFields) {
    const prohibited = matchProhibitedStudioField(item.field, doc);
    if (prohibited) issues.push({ code: 'PROHIBITED_DATA_COLLECTION', severity: 'error', title: `Coleta proibida: ${item.field.name}`,
      description: `Remova a solicitação de “${prohibited}”. Este dado é bloqueado pelo sistema ou pelas regras do agente.`,
      stageId: item.stageId, procedureId: item.procedureId, stepId: item.stepId });
  }
  const authoredMessages: Array<{ text: string; stageId: 'understand' | 'resolve' | 'conclude'; procedureId?: string; stepId?: string }> = [
    { text: doc.understandStage.welcomeMessage, stageId: 'understand' as const },
    { text: doc.understandStage.outOfScopeMessage, stageId: 'understand' as const },
    { text: doc.concludeStage.confirmResolutionQuestion, stageId: 'conclude' as const },
    { text: doc.concludeStage.successClosingMessage, stageId: 'conclude' as const },
    { text: doc.concludeStage.handoffMessage, stageId: 'conclude' as const },
    ...doc.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').flatMap((procedure) => procedure.steps.flatMap((step) => step.messageText
      ? [{ text: step.messageText, stageId: 'resolve' as const, procedureId: procedure.id, stepId: step.id }] : [])),
  ];
  for (const item of authoredMessages) {
    const prohibited = matchProhibitedStudioRequest(item.text || '', doc);
    if (prohibited) issues.push({ code: 'PROHIBITED_DATA_MESSAGE', severity: 'error', title: 'Mensagem solicita dado proibido',
      description: `A mensagem parece solicitar “${prohibited}”. Reescreva-a sem pedir esse dado.`, stageId: item.stageId,
      procedureId: item.procedureId, stepId: item.stepId });
  }

  if (!doc.name?.trim()) {
    issues.push({
      code: 'AGENT_NAME_EMPTY',
      severity: 'error',
      title: 'Nome do agente ausente',
      description: 'Defina um nome para o seu agente de IA.',
    });
  }

  // 1. Stage 1 Validation
  if (!doc.understandStage.welcomeMessage?.trim()) {
    issues.push({
      code: 'MISSING_WELCOME_MESSAGE',
      severity: 'error',
      title: 'Mensagem de boas-vindas ausente',
      description: 'Informe o texto de recepção do cliente na etapa 1 (Entender o cliente).',
      stageId: 'understand',
    });
  }

  // 2. Stage 2 Validation (Procedures)
  if (!doc.resolveStage.procedures.some((procedure) => procedure.status !== 'archived') && doc.resolveStage.knowledgeCollectionIds.length === 0) {
    issues.push({
      code: 'NO_RESOLUTION_CAPABILITY',
      severity: 'warning',
      title: 'Nenhum procedimento ou base conectada',
      description: doc.resolveStage.allowGeneralAiChat ? 'O agente poderá apenas orientar a identificação do pedido, sem fontes da empresa nem ações operacionais.' : 'O agente não possui fontes nem procedimentos para resolver pedidos. Configure ao menos uma capacidade.',
      stageId: 'resolve',
    });
  }

  doc.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').forEach((proc) => {
    if (!proc.name?.trim()) {
      issues.push({
        code: 'PROCEDURE_NAME_EMPTY',
        severity: 'error',
        title: 'Nome do procedimento vazio',
        description: 'Todo procedimento precisa de um nome identificável.',
        procedureId: proc.id,
      });
    }

    if (proc.steps.length === 0) {
      issues.push({
        code: 'PROCEDURE_STEPS_EMPTY',
        severity: 'error',
        title: `Procedimento "${proc.name}" sem etapas`,
        description: 'Adicione pelo menos uma etapa (ex: Coletar dados, Executar ação ou Responder).',
        procedureId: proc.id,
      });
    }

    proc.steps.forEach((step) => {
      if (step.type === 'collect_data' && !step.collectField?.promptMessage?.trim()) {
        issues.push({
          code: 'COLLECT_DATA_PROMPT_EMPTY',
          severity: 'error',
          title: `Pergunta não configurada na etapa "${step.title}"`,
          description: 'Defina o texto que a IA deve enviar para solicitar o dado ao cliente.',
          procedureId: proc.id,
          stepId: step.id,
        });
      }

      if (step.type === 'http_request' && !step.httpRequest?.url?.trim()) {
        issues.push({
          code: 'HTTP_URL_EMPTY',
          severity: 'error',
          title: `URL da API ausente na etapa "${step.title}"`,
          description: 'Informe o endpoint da chamada HTTP.',
          procedureId: proc.id,
          stepId: step.id,
        });
      }

      if (step.type === 'http_request' && step.httpRequest?.url?.trim()) {
        try {
          if (step.httpRequest.connectionId) {
            if (!step.httpRequest.url.startsWith('/')) throw new Error('relative_path');
          } else {
            const endpoint = new URL(step.httpRequest.url);
            if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('protocol');
          }
        } catch {
          issues.push({
            code: 'HTTP_URL_INVALID',
            severity: 'error',
            title: `URL da API inválida na etapa "${step.title}"`,
            description: 'Use uma URL completa iniciada por https:// (ou http:// em ambiente permitido).',
            procedureId: proc.id,
            stepId: step.id,
          });
        }
      }

      if (step.type === 'mcp_tool_call' && (!step.mcpTool?.serverId || !step.mcpTool.qualifiedToolName)) {
        issues.push({
          code: 'MCP_TOOL_MISSING',
          severity: 'error',
          title: `Ferramenta MCP não configurada na etapa "${step.title}"`,
          description: 'Conecte um servidor MCP e escolha uma ferramenta descoberta antes de publicar.',
          procedureId: proc.id,
          stepId: step.id,
        });
      }
    });
  });

  // 3. Stage 3 Validation (Conclude)
  if (!doc.concludeStage.handoffTeam?.trim()) {
    issues.push({
      code: 'MISSING_HANDOFF_TEAM',
      severity: 'error',
      title: 'Equipe de transferência não definida',
      description: 'Informe para qual equipe transferir quando a IA não puder resolver.',
      stageId: 'conclude',
    });
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return {
    valid: !hasErrors,
    issues,
  };
}
