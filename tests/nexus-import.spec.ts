import { describe, expect, it } from 'vitest';

import { importLegacyNexusFlow, repairLegacyNexusText } from '@/modules/nexus/services/legacy-import';
import type { ModelConfiguration } from '@/services/workflow-runtime';

const dialogyModel: ModelConfiguration = {
  provider: 'google',
  model: 'gemini-2.5-flash',
  temperature: 0.2,
  maxOutputTokens: 2048,
  supportsTools: true,
  supportsStructuredOutput: true,
  supportsStreaming: true,
  timeoutMs: 60_000,
  maxRetries: 2,
};

describe('legacy Nexus import', () => {
  it('repairs legacy Windows-1252 mojibake without damaging valid UTF-8 text', () => {
    expect(repairLegacyNexusText('InÃ­cio do Fluxo')).toBe('Início do Fluxo');
    expect(repairLegacyNexusText('ðŸš€ Assinar Internet')).toBe('🚀 Assinar Internet');
    expect(repairLegacyNexusText('NÃƒO')).toBe('NÃO');
    expect(repairLegacyNexusText('âŒ Opção inválida')).toBe('❌ Opção inválida');
    expect(repairLegacyNexusText('â†©ï¸ Voltar')).toBe('↩️ Voltar');
    expect(repairLegacyNexusText('ðŸ‘©ðŸ½â€ðŸ’» Atendimento')).toBe('👩🏽‍💻 Atendimento');
    expect(repairLegacyNexusText('Texto válido com ação e 🚀')).toBe('Texto válido com ação e 🚀');
    expect(repairLegacyNexusText('Âmbito comercial')).toBe('Âmbito comercial');
  });

  it('rebuilds AI blocks on Dialogy AI and discards legacy credentials', () => {
    const secret = 'legacy-secret-that-must-not-survive';
    const result = importLegacyNexusFlow({
      raw: {
        version: '1.0',
        name: 'Atendimento antigo',
        nodes: [
          { id: 'start', type: 'start', title: 'Início' },
          {
            id: 'agent',
            type: 'intelligent-agent',
            title: 'Agente antigo',
            agentName: 'Comercial',
            agentSystemPrompt: 'Ajude o cliente.',
            userInputVariable: '{{mensagem_cliente}}',
            agentResponseVariable: 'resposta_agente',
            maxConversationTurns: 6,
            temperature: 0.35,
            aiApiKey: secret,
            memoryConnectionString: secret,
          },
          { id: 'end', type: 'end-flow', title: 'Fim' },
        ],
        connections: [
          { id: 'c1', from: 'start', to: 'agent' },
          { id: 'c2', from: 'agent', to: 'end' },
        ],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Atendimento importado',
      model: dialogyModel,
      now: new Date('2026-08-25T12:00:00.000Z'),
    });

    expect(result.workflow.metadata).toMatchObject({
      source: 'nexusflow_legacy_import',
      aiRuntime: 'dialogy_native',
    });
    expect(result.workflow.nodes.find((node) => node.type === 'ai.agent')?.config).toMatchObject({
      inputPath: '$.variables.mensagem_cliente',
      inputVariable: 'mensagem_cliente',
      outputKey: 'resposta_agente',
      maxConversationTurns: 6,
      temperature: 0.35,
      conversationMode: true,
      autoSendResponse: true,
    });
    expect(result.workflow.nodes.find((node) => node.type === 'ai.model')?.config).toMatchObject(dialogyModel);
    expect(JSON.stringify(result.workflow)).not.toContain(secret);
    expect(result.report.discardedSecretFields).toBe(2);
    expect(result.report.warnings.some((warning) => warning.code === 'legacy_ai_replaced')).toBe(true);
    expect(result.report.warnings.filter((warning) => warning.code === 'legacy_secret_discarded')).toHaveLength(2);
  });

  it('preserves deterministic condition blocks in Workflow Runtime V2', () => {
    const result = importLegacyNexusFlow({
      raw: {
        nodes: [
          { id: 'start', type: 'start' },
          {
            id: 'condition',
            type: 'condition',
            conditionVariable: 'cliente.vencimento',
            conditionOperator: 'isDateAfter',
            conditionValue: '25/08/2026',
            conditionDataType: 'date',
          },
          { id: 'end', type: 'end-flow' },
        ],
        connections: [
          { from: 'start', to: 'condition' },
          { from: 'condition', to: 'end', sourceHandle: 'true' },
        ],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Condição importada',
      model: dialogyModel,
    });

    expect(result.workflow.nodes.find((node) => node.type === 'logic.if')).toMatchObject({
      config: { operator: 'date_after', right: '25/08/2026', dataType: 'date' },
    });
    expect(result.report.placeholders).toBe(0);
  });

  it('imports Evolution message triggers with phrase routes, thresholds and variable mappings', () => {
    const result = importLegacyNexusFlow({
      raw: {
        nodes: [
          {
            id: 'start',
            type: 'start',
            title: 'Início',
            triggers: [{
              id: 'webhook',
              name: 'Webhook',
              type: 'webhook',
              enabled: true,
              keyword: '600 MEGA + Site, Segunda via',
              keywordThresholds: { '600 MEGA + Site': 80, 'Segunda via': 100 },
              sessionTimeoutSeconds: 3600,
              variableMappings: [{ id: 'map', jsonPath: 'contact.name', flowVariable: 'cliente.nome' }],
            }],
          },
          { id: 'site', type: 'end-flow', title: 'Plano com site' },
          { id: 'invoice', type: 'end-flow', title: 'Segunda via' },
        ],
        connections: [
          { id: 'site-route', from: 'start', to: 'site', sourceHandle: '600 MEGA + Site' },
          { id: 'invoice-route', from: 'start', to: 'invoice', sourceHandle: 'Segunda via' },
        ],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Gatilhos importados',
      model: dialogyModel,
    });
    const trigger = result.workflow.nodes.find((node) => node.id === 'nexus_start');
    expect(trigger).toMatchObject({
      type: 'trigger.received_message',
      config: {
        matchMode: 'any_keyword',
        keywords: ['600 MEGA + Site', 'Segunda via'],
        keywordThresholds: { '600 MEGA + Site': 80, 'Segunda via': 100 },
        sessionTimeoutMs: 3_600_000,
        variableMappings: [{ id: 'map', jsonPath: 'contact.name', flowVariable: 'cliente.nome' }],
      },
    });
    expect(trigger?.config.keywordOutputPorts).toEqual({
      '600 MEGA + Site': '600_MEGA_Site',
      'Segunda via': 'Segunda_via',
    });
    expect(result.workflow.connections.map((connection) => connection.sourcePortId)).toEqual(expect.arrayContaining(['600_MEGA_Site', 'Segunda_via']));
    expect(result.report.validation.valid).toBe(true);
  });

  it('preserves message and manual routes from the same legacy start block', () => {
    const result = importLegacyNexusFlow({
      raw: {
        nodes: [
          {
            id: 'start',
            type: 'start',
            triggers: [
              { id: 'incoming', name: 'Ao receber', type: 'webhook', enabled: true, keyword: 'quero contratar' },
              { id: 'manual', name: 'Teste manual', type: 'manual', enabled: true },
            ],
          },
          { id: 'incoming-end', type: 'end-flow' },
          { id: 'manual-end', type: 'end-flow' },
        ],
        connections: [
          { id: 'incoming-route', from: 'start', to: 'incoming-end', sourceHandle: 'quero contratar' },
          { id: 'manual-route', from: 'start', to: 'manual-end', sourceHandle: 'Teste manual' },
        ],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Início misto',
      model: dialogyModel,
    });

    const messageTrigger = result.workflow.nodes.find((node) => node.type === 'trigger.received_message');
    const manualTrigger = result.workflow.nodes.find((node) => node.type === 'trigger.manual');
    expect(result.workflow.metadata?.allowMultipleTriggers).toBe(true);
    expect(messageTrigger).toBeDefined();
    expect(manualTrigger).toBeDefined();
    expect(result.workflow.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: messageTrigger?.id, targetNodeId: 'nexus_incoming-end' }),
      expect.objectContaining({ sourceNodeId: manualTrigger?.id, targetNodeId: 'nexus_manual-end' }),
    ]));
    expect(result.report.validation.valid).toBe(true);
  });

  it('ports SGP journeys and WhatsApp group creation to native operational blocks', () => {
    const result = importLegacyNexusFlow({
      raw: {
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'status', type: 'dialogy-sgp-contract-status', sgpContractStatusCpfCnpj: '{{cpf}}' },
          {
            id: 'second-copy',
            type: 'dialogy-sgp-second-copy',
            sgpSecondCopyDeliveryMode: 'cloud-template',
            sgpSecondCopyPixTemplateInstance: 'principal',
            sgpSecondCopyPixTemplateName: 'pix_code',
            sgpSecondCopyBoletoTemplateInstance: 'principal',
            sgpSecondCopyBoletoTemplateName: 'boleto_code',
          },
          { id: 'promise', type: 'dialogy-sgp-payment-promise' },
          { id: 'wa-text', type: 'whatsapp-text', instanceName: 'principal', phoneNumber: '{{cliente.telefone}}', textMessage: 'Olá, {{cliente.nome}}!' },
          { id: 'wa-media', type: 'whatsapp-media', instanceName: 'principal', phoneNumber: '{{cliente.telefone}}', mediaType: 'document', mediaUrl: 'https://cdn.example.com/fatura.pdf', caption: 'Sua fatura' },
          { id: 'group', type: 'whatsapp-group', instanceName: 'principal', groupName: 'Clientes', participants: '5511999999999\n5521999999999' },
          { id: 'end', type: 'end-flow' },
        ],
        connections: [
          { from: 'start', to: 'status' },
          { from: 'status', to: 'second-copy', sourceHandle: 'active' },
          { from: 'second-copy', to: 'promise', sourceHandle: 'success' },
          { from: 'promise', to: 'group', sourceHandle: 'status-1' },
          { from: 'group', to: 'end' },
        ],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Jornada SGP importada',
      model: dialogyModel,
    });

    expect(result.workflow.nodes.find((node) => node.type === 'dialogy.sgp_contract_status')?.config.outputKey).toBe('_sgp_contract_status_status');
    expect(result.workflow.nodes.find((node) => node.type === 'dialogy.sgp_second_copy')?.config).toMatchObject({
      deliveryMode: 'cloud-template',
      outputKey: '_sgp_payment_code_second_copy',
      pixTemplateName: 'pix_code',
      boletoTemplateName: 'boleto_code',
    });
    expect(result.workflow.nodes.find((node) => node.type === 'dialogy.sgp_payment_promise')?.config.outputKey).toBe('_sgp_payment_promise_promise');
    expect(result.workflow.nodes.find((node) => node.id === 'nexus_wa-text')).toMatchObject({
      type: 'whatsapp.send_text',
      config: { instanceName: 'principal', phoneNumber: '{{cliente.telefone}}', message: 'Olá, {{cliente.nome}}!' },
    });
    expect(result.workflow.nodes.find((node) => node.id === 'nexus_wa-media')).toMatchObject({
      type: 'whatsapp.send_media',
      config: { instanceName: 'principal', phoneNumber: '{{cliente.telefone}}', mediaType: 'document', url: 'https://cdn.example.com/fatura.pdf', caption: 'Sua fatura' },
    });
    expect(result.workflow.nodes.find((node) => node.type === 'whatsapp.group_create')?.config.participants).toEqual(['5511999999999', '5521999999999']);
    expect(result.report.placeholders).toBe(0);
  });

  it('imports legacy transfers as an immediately executable deterministic handoff', () => {
    const result = importLegacyNexusFlow({
      raw: {
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'transfer', type: 'dialogy-transfer-team', dialogyTeamId: 'team-1' },
          { id: 'end', type: 'end-flow' },
        ],
        connections: [
          { from: 'start', to: 'transfer' },
          { from: 'transfer', to: 'end', sourceHandle: 'completed' },
        ],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Transferência importada',
      model: dialogyModel,
    });

    expect(result.workflow.nodes.find((node) => node.id === 'nexus_transfer')?.config).toMatchObject({
      destinationType: 'human',
      teamId: 'team-1',
      requireConfirmation: false,
      confirmationPath: '',
    });
    expect(result.report.validation.errors.some((issue) => issue.code === 'handoff_confirmation_missing')).toBe(false);
  });

  it('imports historical Supabase blocks and legacy field names without neutral placeholders', () => {
    const result = importLegacyNexusFlow({
      raw: {
        version: '1.0',
        nodes: [
          { id: 'start', type: 'start', triggers: [{ id: 'manual', name: 'Manual', type: 'manual', enabled: true }] },
          {
            id: 'read',
            type: 'supabase-read-row',
            supabaseTableName: 'clientes',
            supabaseIdentifierColumn: 'cpf',
            supabaseIdentifierValue: '{{cpf}}',
            supabaseColumnsToSelect: 'id, nome',
            supabaseResultVariable: 'cliente',
          },
          {
            id: 'create',
            type: 'supabase-create-row',
            supabaseTableName: 'leads',
            supabaseDataJson: '{"nome":"{{nome}}"}',
            supabaseResultVariable: 'lead',
          },
          {
            id: 'update',
            type: 'supabase-update-row',
            supabaseTableName: 'clientes',
            supabaseIdentifierColumn: 'id',
            supabaseIdentifierValue: '{{cliente.id}}',
            supabaseDataJson: '{"status":"ativo"}',
          },
          {
            id: 'delete',
            type: 'supabase-delete-row',
            supabaseTableName: 'temporarios',
            supabaseIdentifierColumn: 'id',
            supabaseIdentifierValue: '{{temporario_id}}',
          },
          {
            id: 'sheet',
            type: 'google-sheets-append',
            googleSheetId: 'sheet-legacy',
            googleSheetName: 'Leads',
            googleSheetRowData: '["{{nome}}", "{{email}}"]',
          },
          {
            id: 'db',
            type: 'db-select',
            dbTableName: 'pedidos',
            dbColumnsToSelect: 'id,total',
            dbResultVariable: 'pedidosEncontrados',
          },
          {
            id: 'api-input',
            type: 'input',
            promptText: 'Aguardando retorno do provedor',
            inputType: 'email',
            variableToSaveResponse: 'cliente.email',
            apiResponseAsInput: true,
            apiResponsePathForValue: 'data.customer.email',
          },
          {
            id: 'email',
            type: 'send-email',
            emailFrom: 'comercial@velpro.com.br',
            emailTo: '{{cliente.email}}',
            emailSubject: 'Bem-vindo',
            emailBody: 'Olá!',
          },
          {
            id: 'options',
            type: 'option',
            questionText: 'Escolha:',
            optionsList: 'Plano básico\\nPlano completo',
            aiEnabled: true,
            aiKeyId: 'legacy-option-secret',
          },
          {
            id: 'api',
            type: 'api-call',
            apiMethod: 'POST',
            apiUrl: 'https://api.example.com/leads',
            apiHeadersList: [
              { id: 'safe', key: 'X-Tenant', value: 'velpro' },
              { id: 'secret', key: 'Authorization', value: 'Bearer legacy-secret' },
            ],
            apiBodyType: 'form-data',
            apiBodyFormDataList: [{ id: 'name', key: 'name', value: '{{nome}}' }],
            apiResponseMappings: [{ id: 'mapping', jsonPath: 'data.id', flowVariable: 'lead.id' }],
          },
        ],
        connections: [],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Compatibilidade histórica',
      model: dialogyModel,
    });
    const node = (id: string) => result.workflow.nodes.find((candidate) => candidate.id === `nexus_${id}`);

    expect(result.report.placeholders).toBe(0);
    expect(node('read')?.config).toMatchObject({
      operation: 'select',
      table: 'clientes',
      columns: ['id', 'nome'],
      filters: [{ column: 'cpf', operator: 'eq', value: '{{cpf}}' }],
      outputKey: 'cliente',
    });
    expect(node('create')?.config).toMatchObject({ operation: 'insert', values: { nome: '{{nome}}' }, returning: ['*'], outputKey: 'lead' });
    expect(node('update')?.config).toMatchObject({ operation: 'update', filters: [{ column: 'id', operator: 'eq', value: '{{cliente.id}}' }] });
    expect(node('delete')?.config).toMatchObject({ operation: 'delete', returning: ['*'] });
    expect(node('sheet')?.config).toMatchObject({ spreadsheetId: 'sheet-legacy', range: 'Leads!A:Z', values: ['{{nome}}', '{{email}}'] });
    expect(node('db')?.config.outputKey).toBe('pedidosEncontrados');
    expect(node('api-input')?.config).toMatchObject({
      validation: 'email',
      outputKey: 'cliente.email',
      legacyApiResponseAsInput: true,
      legacyApiResponsePathForValue: 'data.customer.email',
    });
    expect(node('email')?.config.from).toBe('comercial@velpro.com.br');
    expect(node('options')?.config).toMatchObject({
      customFallbackRoutes: false,
      intelligentMatching: true,
      intelligentMinimumConfidence: 0.65,
      options: [
        { id: 'option_1', value: 'Plano básico', label: 'Plano básico' },
        { id: 'option_2', value: 'Plano completo', label: 'Plano completo' },
      ],
    });
    expect(node('api')?.config).toMatchObject({
      headers: { 'X-Tenant': 'velpro' },
      bodyType: 'form-data',
      body: { name: '{{nome}}' },
      responseMappings: [{ jsonPath: 'data.id', flowVariable: 'lead.id', extractAs: 'single', itemField: '' }],
    });
    expect(JSON.stringify(result.workflow)).not.toContain('legacy-secret');
    expect(JSON.stringify(result.workflow)).not.toContain('legacy-option-secret');
    expect(result.report.discardedSecretFields).toBe(2);
    expect(result.report.warnings.some((warning) => warning.code === 'legacy_ai_replaced' && warning.legacyNodeId === 'options')).toBe(true);
  });

  it('binds legacy capabilities to the uniquely matching MCP tool in the Dialogy workspace', () => {
    const result = importLegacyNexusFlow({
      raw: {
        nodes: [
          { id: 'start', type: 'start' },
          {
            id: 'capability',
            type: 'capability',
            title: 'Consultar fatura',
            capabilityId: 'legacy-capability-id',
            capabilityName: 'Consultar Fatura',
            capabilityInputJson: '{"invoiceId":"{{fatura_id}}"}',
            capabilityOutputVariable: 'fatura.resultado',
          },
          { id: 'end', type: 'end-flow' },
        ],
        connections: [
          { from: 'start', to: 'capability' },
          { from: 'capability', to: 'end' },
        ],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Capability importada',
      model: dialogyModel,
      mcpTools: [{
        name: 'mcp:billing:get_invoice',
        displayName: 'Consultar fatura',
        serverId: 'billing',
        serverName: 'Billing MCP',
        inputSchema: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
        outputSchema: { type: 'object', additionalProperties: true },
        riskLevel: 'low',
        requiresHumanApproval: false,
        idempotent: true,
        timeoutMs: 12_000,
      }],
    });
    const capability = result.workflow.nodes.find((node) => node.id === 'nexus_capability');

    expect(capability).toMatchObject({
      type: 'integration.mcp_call',
      config: {
        toolName: 'mcp:billing:get_invoice',
        serverId: 'billing',
        serverName: 'Billing MCP',
        arguments: { invoiceId: '{{current.fatura_id}}' },
        outputKey: 'fatura.resultado',
        riskLevel: 'low',
        requiresConfirmation: false,
        idempotent: true,
        timeoutMs: 12_000,
        continueOnError: true,
      },
    });
    expect(result.report.warnings.some((warning) => warning.legacyNodeId === 'capability' && warning.code === 'manual_review_placeholder')).toBe(false);
    expect(result.report.validation.valid).toBe(true);
  });

  it('preserves the legacy continue-on-error behavior for API, code, AI and database steps', () => {
    const result = importLegacyNexusFlow({
      raw: {
        nodes: [
          { id: 'api', type: 'api-call', apiUrl: 'https://api.example.com', apiOutputVariable: 'api.result' },
          { id: 'code', type: 'code-execution', codeSnippet: 'throw new Error("legacy")', codeOutputVariable: 'code.result' },
          { id: 'ai', type: 'ai-text-generation', aiPromptText: 'Resuma', aiOutputVariable: 'ai.result' },
          { id: 'db', type: 'db-select', dbTableName: 'clientes', dbResultVariable: 'db.result', dbOnError: 'continue' },
        ],
        connections: [],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Falhas legadas',
      model: dialogyModel,
    });
    const node = (id: string) => result.workflow.nodes.find((candidate) => candidate.id === `nexus_${id}`);

    expect(node('api')?.config).toMatchObject({ outputKey: 'api.result', continueOnError: true });
    expect(node('code')?.config).toMatchObject({ outputKey: 'code.result', continueOnError: true });
    expect(node('ai')?.config).toMatchObject({ outputKey: 'ai.result', continueOnError: true });
    expect(node('db')?.config).toMatchObject({
      outputKey: 'db.result',
      legacyErrorMode: 'continue',
      continueOnError: true,
    });
  });

  it('rebuilds a legacy database goto-on-error as an explicit recoverable route', () => {
    const result = importLegacyNexusFlow({
      raw: {
        nodes: [
          { id: 'start', type: 'start' },
          {
            id: 'db',
            type: 'db-select',
            title: 'Consultar cliente',
            dbTableName: 'clientes',
            dbOnError: 'goto',
            dbOnErrorNodeId: 'fallback',
          },
          { id: 'success', type: 'end-flow', title: 'Sucesso' },
          { id: 'fallback', type: 'end-flow', title: 'Fallback' },
        ],
        connections: [
          { from: 'start', to: 'db' },
          { from: 'db', to: 'success' },
        ],
      },
      workspaceId: 'workspace-1',
      configId: 'config-1',
      name: 'Banco com recuperação',
      model: dialogyModel,
    });
    const db = result.workflow.nodes.find((node) => node.id === 'nexus_db');
    const recovery = result.workflow.nodes.find((node) => node.id === 'nexus_db_legacy_error_goto');

    expect(db?.config).toMatchObject({
      legacyErrorMode: 'goto',
      legacyErrorTargetNodeId: 'nexus_fallback',
      continueOnError: false,
      customErrorRoute: true,
    });
    expect(recovery).toMatchObject({ type: 'error.handler', config: { mode: 'recover', legacyDbErrorGoto: true } });
    expect(result.workflow.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: 'nexus_db', sourcePortId: 'error', targetNodeId: recovery?.id, connectionType: 'error' }),
      expect.objectContaining({ sourceNodeId: recovery?.id, sourcePortId: 'recovered', targetNodeId: 'nexus_fallback', connectionType: 'main' }),
    ]));
    expect(result.report.validation.errors).toEqual([
      expect.objectContaining({ code: 'database_config_invalid', nodeId: 'nexus_db' }),
    ]);
  });
});
