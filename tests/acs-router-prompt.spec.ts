import { describe, it, expect } from 'vitest';
import { buildAgentSystemPrompt, type AgentRuntimeContext } from '../src/services/workflow-runtime/agent-loop';

describe('ACS Router Compliance & Directives', () => {
  const createMockRegistry = (tools: Array<{ name: string; description: string }>) => ({
    list: () => tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputJsonSchema: {},
      requiresConfirmation: false,
    })),
  });

  const baseContext = {
    workspaceId: 'ws-test',
    runId: 'run-1',
    nodeId: 'node-1',
    config: {
      name: 'Suporte Wi-Fi',
      role: 'Especialista em Redes e Roteadores',
      language: 'pt-BR',
      persona: 'Atendente técnico cordial',
      objective: 'Auxiliar cliente na troca de senha e diagnóstico do roteador',
      completionCriteria: ['Diagnóstico realizado', 'Wi-Fi configurado'],
      instructions: ['Verifique o roteador antes de reiniciar'],
      availableContext: ['contrato', 'roteador'],
    },
    execution: {
      executionId: 'run-1',
      workflowId: 'wf-1',
      nodeId: 'node-1',
      sessionId: 'sess-1',
      conversationId: 'conv-1',
      stepIndex: 1,
      input: { text: 'Quero trocar minha senha do wifi' },
      variables: {},
      context: {},
      startedAt: new Date().toISOString(),
    },
  };

  it('does NOT inject router operational directives when only standard tools are enabled', () => {
    const context = {
      ...baseContext,
      tools: createMockRegistry([
        {
          name: 'query_customer_database',
          description: 'Consulta cadastro do cliente',
        },
      ]) as any,
    };

    const prompt = buildAgentSystemPrompt(context as any);
    expect(prompt).not.toContain('DIRETRIZES OPERACIONAIS OBRIGATÓRIAS PARA ROTEADORES');
    expect(prompt).not.toContain('Zero Plaintext Secrets');
  });

  it('injects mandatory router operational directives when ACS router tools are attached', () => {
    const context = {
      ...baseContext,
      tools: createMockRegistry([
        {
          name: 'mcp:server1:configure_wifi',
          description: 'Configura SSID e senha do Wi-Fi',
        },
        {
          name: 'mcp:server1:reboot_router',
          description: 'Reinicia o CPE',
        },
        {
          name: 'mcp:server1:get_tool_manual',
          description: 'Consulta manual da ferramenta',
        },
      ]) as any,
    };

    const prompt = buildAgentSystemPrompt(context as any);
    expect(prompt).toContain('DIRETRIZES OPERACIONAIS OBRIGATÓRIAS PARA ROTEADORES (ACS / TR-069):');
    expect(prompt).toContain('/como-usar');
    expect(prompt).toContain('Zero Plaintext Secrets');
    expect(prompt).toContain('Diagnóstico Prévio Obrigatório');
    expect(prompt).toContain('get_router_details');
    expect(prompt).toContain('Configuração Atômica de Wi-Fi');
    expect(prompt).toContain('Justificativa Explícita para Reboot');
    expect(prompt).toContain('confirm: true');
    expect(prompt).toContain('get_operation_status');
  });

  it('correctly appends [Instrução Corretiva do ACS] when tool output has remedial_suggestion', () => {
    const errorOutput = {
      content: [{ type: 'text', text: 'Parâmetros inválidos para configure_wifi.' }],
      structuredContent: {
        error_code: 'INVALID_WIFI_PARAM',
        remedial_suggestion: 'Consulte o manual da ferramenta via get_tool_manual(tool_name="configure_wifi"). As bandas 2.4GHz e 5GHz devem ser passadas juntas.',
      },
      isError: true,
    };

    let errorMsg = 'Ferramenta MCP retornou erro.';
    if (errorOutput.structuredContent?.remedial_suggestion) {
      errorMsg += `\n[Instrução Corretiva do ACS]: ${errorOutput.structuredContent.remedial_suggestion}`;
    }

    expect(errorMsg).toContain('[Instrução Corretiva do ACS]:');
    expect(errorMsg).toContain('Consulte o manual da ferramenta via get_tool_manual(tool_name="configure_wifi")');
  });
});
