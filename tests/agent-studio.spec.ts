import { describe, expect, it } from 'vitest';
import {
  createDefaultAgentStudioDocument,
  createInvoiceAgentStudioTemplate,
  AgentStudioDocumentSchema,
  CollectedFieldDefinitionSchema,
  HttpRequestStepConfigSchema,
  McpToolStepConfigSchema,
} from '@/services/agent-studio/types';
import {
  analyzeProcedureAssistance,
  validateAgentForPublication,
} from '@/services/agent-studio/assistant-validator';

describe('Agent Studio Types & Schemas', () => {
  it('creates a valid default Agent Studio document with 3 structural stages', () => {
    const doc = createDefaultAgentStudioDocument('agent-1', 'ws-1', 'Assistente Virtual', 'support');

    expect(doc.id).toBe('agent-1');
    expect(doc.workspaceId).toBe('ws-1');
    expect(doc.name).toBe('Assistente Virtual');
    expect(doc.serviceType).toBe('support');
    expect(doc.understandStage).toBeDefined();
    expect(doc.resolveStage).toBeDefined();
    expect(doc.concludeStage).toBeDefined();
    expect(doc.resolveStage.procedures).toEqual([]);
    expect(doc.publishedVersion).toBeNull();

    // Validate with Zod
    const parsed = AgentStudioDocumentSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
  });

  it('validates first-class collected field definitions with privacy/LGPD flags', () => {
    const field = {
      id: 'f_cpf',
      name: 'CPF do Titular',
      variableKey: 'customer_cpf',
      type: 'cpf' as const,
      required: true,
      promptMessage: 'Por favor, digite seu CPF para prosseguir.',
      maxAttempts: 3,
      requiresConfirmation: true,
      isSensitive: true,
    };

    const parsed = CollectedFieldDefinitionSchema.safeParse(field);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.isSensitive).toBe(true);
      expect(parsed.data.type).toBe('cpf');
    }
  });

  it('validates HTTP API step configs with mapped inputs and outputs', () => {
    const httpConfig = {
      name: 'Consultar Débitos',
      method: 'POST' as const,
      url: 'https://api.erp.com/v1/debits',
      authType: 'bearer_token' as const,
      authSecretOrToken: 'token-xyz',
      sentDataMappings: [
        {
          apiField: 'document',
          sourceType: 'collected_field' as const,
          sourceValue: 'customer_cpf',
        },
      ],
      outputMappings: [
        {
          jsonPath: 'data.invoices',
          chipLabel: 'Faturas em aberto',
          chipKey: 'open_invoices',
        },
      ],
      timeoutSeconds: 20,
      maxRetries: 2,
      fallbackAction: 'handoff' as const,
      fallbackMessage: 'Erro ao consultar débitos.',
    };

    const parsed = HttpRequestStepConfigSchema.safeParse(httpConfig);
    expect(parsed.success).toBe(true);
  });

  it('validates MCP tool step configs with parameters and error handling', () => {
    const mcpConfig = {
      serverId: 'srv_crm',
      friendlyToolName: 'Criar Ticket no CRM',
      qualifiedToolName: 'mcp:crm:create_ticket',
      riskLevel: 'destructive' as const,
      requiresConfirmation: true,
      argumentMappings: [
        {
          argumentName: 'subject',
          sourceChipKey: 'customer_cpf',
          sourceChipLabel: 'CPF do Cliente',
        },
      ],
      outputMappings: [
        {
          jsonPath: 'ticket_id',
          chipLabel: 'Número do Chamado',
          chipKey: 'crm_ticket_id',
        },
      ],
      fallbackAction: 'handoff' as const,
    };

    const parsed = McpToolStepConfigSchema.safeParse(mcpConfig);
    expect(parsed.success).toBe(true);
  });
});

describe('Agent Studio Proactive Assistant', () => {
  it('detects missing data collection prior to an API step and suggests adding it', () => {
    const proc = {
      id: 'proc_test',
      name: 'Consultar Fatura',
      description: 'Buscar faturas',
      objective: 'Localizar faturas do cliente',
      priority: 100,
      triggerKeywords: ['fatura'],
      exampleRequests: ['Quero fatura'],
      status: 'published' as const,
      publishedVersion: 1,
      updatedAt: new Date().toISOString(),
      steps: [
        {
          id: 'step_1',
          order: 1,
          type: 'http_request' as const,
          title: 'Buscar faturas',
          subtitle: 'Chamada à API de cobrança',
          httpRequest: {
            name: 'API Cobrança',
            method: 'GET' as const,
            url: 'https://api.cobranca.com/debits',
            authType: 'none' as const,
            sentDataMappings: [
              {
                apiField: 'cpf',
                sourceType: 'collected_field' as const,
                sourceValue: 'customer_cpf',
              },
            ],
            outputMappings: [],
            timeoutSeconds: 15,
            maxRetries: 1,
            fallbackAction: 'handoff' as const,
          },
        },
      ],
    };

    const suggestions = analyzeProcedureAssistance(proc);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].type).toBe('missing_data_step');
    expect(suggestions[0].recommendedField?.variableKey).toBe('customer_cpf');
    expect(suggestions[0].recommendedField?.type).toBe('cpf');
  });

  it('does not suggest collection if data is already collected in an earlier step', () => {
    const proc = {
      id: 'proc_test_2',
      name: 'Consultar Fatura',
      description: 'Buscar faturas',
      objective: 'Localizar faturas do cliente',
      priority: 100,
      triggerKeywords: ['fatura'],
      exampleRequests: ['Quero fatura'],
      status: 'published' as const,
      publishedVersion: 1,
      updatedAt: new Date().toISOString(),
      steps: [
        {
          id: 'step_1',
          order: 1,
          type: 'collect_data' as const,
          title: 'Pedir CPF',
          subtitle: 'Coletar documento',
          collectField: {
            id: 'f1',
            name: 'CPF',
            variableKey: 'customer_cpf',
            type: 'cpf' as const,
            required: true,
            promptMessage: 'Digite seu CPF:',
            maxAttempts: 3,
            requiresConfirmation: false,
            isSensitive: true,
          },
        },
        {
          id: 'step_2',
          order: 2,
          type: 'http_request' as const,
          title: 'Buscar faturas',
          subtitle: 'Chamada à API de cobrança',
          httpRequest: {
            name: 'API Cobrança',
            method: 'GET' as const,
            url: 'https://api.cobranca.com/debits',
            authType: 'none' as const,
            sentDataMappings: [
              {
                apiField: 'cpf',
                sourceType: 'collected_field' as const,
                sourceValue: 'customer_cpf',
              },
            ],
            outputMappings: [],
            timeoutSeconds: 15,
            maxRetries: 1,
            fallbackAction: 'handoff' as const,
          },
        },
      ],
    };

    const suggestions = analyzeProcedureAssistance(proc);
    expect(suggestions).toHaveLength(0);
  });
});

describe('Agent Studio Publication Validator', () => {
  it('validates a complete agent and returns valid=true', () => {
    const doc = createInvoiceAgentStudioTemplate('agent-pub-1', 'ws-1', 'Agente Completo', 'support');
    const apiStep = doc.resolveStage.procedures[0].steps.find((step) => step.type === 'http_request');
    const mcpStep = doc.resolveStage.procedures[0].steps.find((step) => step.type === 'mcp_tool_call');
    if (apiStep?.httpRequest) apiStep.httpRequest.url = 'https://api.example.com/v1/invoices';
    if (mcpStep?.mcpTool) {
      mcpStep.mcpTool.serverId = 'billing';
      mcpStep.mcpTool.qualifiedToolName = 'mcp:billing:generate_invoice';
      mcpStep.mcpTool.friendlyToolName = 'Gerar fatura';
    }
    const decision = doc.resolveStage.procedures[0].steps.find((step) => step.type === 'decision')!;
    decision.decisionBranches = [
      { id: 'found', conditionLabel: 'Uma fatura', condition: { fieldKey: 'invoices_list', operator: 'count_equals', value: '1' }, actionType: 'continue' },
      { id: 'other', conditionLabel: 'Caso contrário', isDefault: true, actionType: 'respond', actionValue: 'Precisamos confirmar a fatura desejada.' },
    ];
    const result = validateAgentForPublication(doc);

    expect(result.valid).toBe(true);
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('blocks publication if agent name is blank or procedures have invalid URLs', () => {
    const doc = createInvoiceAgentStudioTemplate('agent-pub-2', 'ws-1', '', 'support');
    doc.resolveStage.procedures[0].steps.push({
      id: 'step_bad_url',
      order: 99,
      type: 'http_request',
      title: 'API sem URL',
      subtitle: 'Teste',
      httpRequest: {
        name: 'API Quebrada',
        method: 'GET',
        url: '',
        authType: 'none',
        sentDataMappings: [],
        outputMappings: [],
        timeoutSeconds: 15,
        maxRetries: 1,
        fallbackAction: 'handoff',
      },
    });

    const result = validateAgentForPublication(doc);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.title.includes('Nome do agente'))).toBe(true);
    expect(result.issues.some((i) => i.title.includes('URL da API ausente'))).toBe(true);
  });

  it('blocks system-prohibited and administrator-prohibited data requests before publication', () => {
    const doc = createDefaultAgentStudioDocument('agent-policy', 'ws-1');
    doc.concludeStage.handoffTeam = 'Suporte';
    doc.rules.prohibitedDataLabels = ['renda mensal'];
    doc.understandStage.askInitialData = true;
    doc.understandStage.initialFields = [
      CollectedFieldDefinitionSchema.parse({ id: 'password', name: 'Senha', variableKey: 'password', type: 'text', promptMessage: 'Informe sua senha.' }),
      CollectedFieldDefinitionSchema.parse({ id: 'income', name: 'Renda mensal', variableKey: 'income', type: 'currency', promptMessage: 'Qual sua renda mensal?' }),
    ];
    const result = validateAgentForPublication(doc);
    expect(result.valid).toBe(false);
    expect(result.issues.filter((issue) => issue.code === 'PROHIBITED_DATA_COLLECTION')).toHaveLength(2);
  });

  it('blocks authored response text that asks for prohibited data', () => {
    const doc = createInvoiceAgentStudioTemplate('agent-message-policy', 'ws-1');
    doc.concludeStage.handoffTeam = 'Suporte';
    doc.resolveStage.procedures[0].steps.push({ id: 'unsafe-message', order: 99, type: 'respond', title: 'Solicitar', messageText: 'Envie seu código de autenticação.' });
    expect(validateAgentForPublication(doc).issues.some((issue) => issue.code === 'PROHIBITED_DATA_MESSAGE')).toBe(true);
  });
});
