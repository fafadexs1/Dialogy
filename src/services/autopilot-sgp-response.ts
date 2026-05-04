import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function extractRequestedContractId(...values: Array<string | null | undefined>): string | null {
  const text = values.filter(Boolean).join(' ');
  const match = text.match(/\bcontrato\b[^\d]{0,80}(\d{3,})\b/i);
  return match?.[1] || null;
}

export function hasPromisedOperationalLookup(response: string | null | undefined): boolean {
  if (!response) return false;
  const normalized = response
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return (
    /\b(vou|irei|posso)\s+(verificar|consultar|checar|validar|conferir)\b/.test(normalized) &&
    /\b(status|contrato|cadastro|sistema|sgp|conexao|fatura|pendencia|financeir)/.test(normalized)
  );
}

export function ensurePromisedSgpLookupAction(input: {
  response: string | null | undefined;
  customerMessage: string;
  actions: AgentToolAction[];
  enabledToolNames: string[];
}): AgentToolAction[] {
  if (!hasPromisedOperationalLookup(input.response)) {
    return input.actions;
  }

  if (!input.enabledToolNames.includes('sgp_fetch_contact_panel_data')) {
    return input.actions;
  }

  const alreadyHasSgpLookup = input.actions.some((action) => (
    action.type === 'sgp_fetch_contact_panel_data' || action.type === 'sgp_fetch_contracts'
  ));
  if (alreadyHasSgpLookup) {
    return input.actions;
  }

  return [
    {
      type: 'sgp_fetch_contact_panel_data',
      reason: 'Resposta prometeu consultar dados operacionais antes de responder ao cliente.',
      payload: {},
    },
    ...input.actions,
  ];
}

function hasSgpLookupAction(actions: AgentToolAction[]): boolean {
  return actions.some((action) => (
    action.type === 'sgp_fetch_contact_panel_data' || action.type === 'sgp_fetch_contracts'
  ));
}

function hasRouterRebootIntent(...values: Array<string | null | undefined>): boolean {
  const normalized = values
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return (
    /\b(reinici|reinicializ|reset|reboot)\w*/.test(normalized) &&
    /\b(roteador|router|conexao|internet|contrato)\b/.test(normalized)
  );
}

export function ensureProcedureSgpLookupAction(input: {
  response: string | null | undefined;
  customerMessage: string;
  actions: AgentToolAction[];
  enabledToolNames: string[];
  knowledgeToolProcedures: string;
}): AgentToolAction[] {
  if (!input.knowledgeToolProcedures.includes('reboot_router')) {
    return input.actions;
  }

  if (!hasRouterRebootIntent(input.customerMessage, input.response)) {
    return input.actions;
  }

  if (!input.enabledToolNames.includes('sgp_fetch_contact_panel_data')) {
    return input.actions;
  }

  if (hasSgpLookupAction(input.actions)) {
    return input.actions;
  }

  return [
    {
      type: 'sgp_fetch_contact_panel_data',
      reason: 'Procedimento de reinicializacao de roteador precisa consultar SGP para obter o IPv4 do contrato.',
      payload: {},
    },
    ...input.actions,
  ];
}

function formatContractFinancialStatus(summary: any): string {
  const overdueInvoices = Number(summary?.overdueInvoices || 0);
  const openInvoices = Number(summary?.openInvoices || 0);

  if (overdueInvoices > 0) {
    return `Encontrei ${overdueInvoices} fatura(s) vencida(s) nesse contrato.`;
  }

  if (openInvoices > 0) {
    return `Encontrei ${openInvoices} fatura(s) em aberto nesse contrato.`;
  }

  return 'Nao encontrei faturas vencidas nem em aberto nesse contrato.';
}

function formatContractConnectionStatus(contract: any): string {
  if (!contract) return 'sem status claro de conexao';
  if (contract.connectionStatus === 'online') return 'online';
  if (contract.connectionStatus === 'offline') return 'offline';
  return 'sem status claro de conexao';
}

export function buildSgpResponseFromToolResults(
  results: AgentToolExecutionResult[],
  contextText = ''
): string | null {
  const panelResult = results.find(
    (result) => result.toolName === 'sgp_fetch_contact_panel_data' && result.status === 'success'
  );
  const output = panelResult?.output as any;
  if (!output) return null;

  const contracts = Array.isArray(output.contracts) ? output.contracts : [];
  const invoiceGroups = Array.isArray(output.invoiceGroups) ? output.invoiceGroups : [];
  const requestedContractId = extractRequestedContractId(contextText);

  if (requestedContractId) {
    const requestedDigits = onlyDigits(requestedContractId);
    const requestedGroup = invoiceGroups.find((group: any) => (
      onlyDigits(group?.contractId || group?.key) === requestedDigits
    ));
    const requestedContract = requestedGroup?.contract || contracts.find((contract: any) => (
      onlyDigits(contract?.id) === requestedDigits
    ));

    if (requestedGroup || requestedContract) {
      const statusLabel = requestedContract?.statusLabel ? ` e status ${requestedContract.statusLabel}` : '';
      return [
        `Consultei o contrato ${requestedContractId} no SGP.`,
        requestedContract ? `A conexao esta ${formatContractConnectionStatus(requestedContract)}${statusLabel}.` : '',
        requestedGroup ? formatContractFinancialStatus(requestedGroup.summary) : 'Nao encontrei faturas vinculadas a esse contrato.',
      ].filter(Boolean).join(' ');
    }

    return `Consultei o SGP, mas nao encontrei o contrato ${requestedContractId} no cadastro desse cliente.`;
  }

  const onlineContracts = Number(output.onlineContracts || 0);
  const overdueInvoices = Number(output.overdueInvoices || 0);
  const openInvoices = Number(output.openInvoices || 0);
  const firstContract = contracts[0];
  const statusLabel = firstContract?.connectionStatus === 'online'
    ? 'online'
    : firstContract?.connectionStatus === 'offline'
      ? 'offline'
      : 'sem status claro de conexao';

  return [
    `Consultei o cadastro no SGP. Encontrei ${contracts.length} contrato(s); ${onlineContracts} online.`,
    firstContract ? `Contrato principal: ${firstContract.planDescription || firstContract.id}, status ${statusLabel}.` : '',
    overdueInvoices > 0
      ? `Tambem ha ${overdueInvoices} fatura(s) vencida(s).`
      : openInvoices > 0
        ? `Ha ${openInvoices} fatura(s) em aberto.`
        : 'Nao encontrei faturas vencidas nem em aberto.',
  ].filter(Boolean).join(' ');
}

function extractMcpRebootToolName(knowledgeToolProcedures: string): string | null {
  const match = knowledgeToolProcedures.match(/Tool resolvida:\s*(mcp:[^\s]+:reboot_router)\b/);
  return match?.[1] || null;
}

function extractTargetContractFromSgpResults(results: AgentToolExecutionResult[], contextText: string): any | null {
  const panelResult = results.find(
    (result) => result.toolName === 'sgp_fetch_contact_panel_data' && result.status === 'success'
  );
  const output = panelResult?.output as any;
  if (!output) return null;

  const contracts = Array.isArray(output.contracts) ? output.contracts : [];
  const requestedContractId = extractRequestedContractId(contextText);
  if (requestedContractId) {
    const requestedDigits = onlyDigits(requestedContractId);
    return contracts.find((contract: any) => onlyDigits(contract?.id) === requestedDigits) || null;
  }

  return contracts.find((contract: any) => contract?.connectionStatus === 'online' && contract?.ip) ||
    contracts.find((contract: any) => contract?.ip) ||
    null;
}

export function buildRouterRebootActionFromSgpResults(input: {
  toolResults: AgentToolExecutionResult[];
  customerMessage: string;
  response: string | null | undefined;
  knowledgeToolProcedures: string;
}): AgentToolAction | null {
  if (!hasRouterRebootIntent(input.customerMessage, input.response)) return null;

  const toolName = extractMcpRebootToolName(input.knowledgeToolProcedures);
  if (!toolName) return null;

  const contract = extractTargetContractFromSgpResults(
    input.toolResults,
    `${input.customerMessage || ''}\n${input.response || ''}`
  );
  const clientIp = String(contract?.ip || '').trim();
  if (!clientIp) return null;

  return {
    type: 'mcp_call_tool',
    reason: `Reinicializar roteador do contrato ${contract.id || 'selecionado'} usando IPv4 retornado pelo SGP.`,
    payload: {
      toolName,
      arguments: {
        client_ip: clientIp,
        reason: `Cliente solicitou reinicializacao do roteador${contract.id ? ` do contrato ${contract.id}` : ''}.`,
      },
    },
  };
}

export function buildMcpCustomerResponseFromToolResults(results: AgentToolExecutionResult[]): string | null {
  const rebootResult = results.find((result) => (
    result.toolName.endsWith(':reboot_router') && result.status === 'success'
  ));
  if (!rebootResult) return null;

  return 'Pronto, enviei o comando de reinicializacao para o roteador. Aguarde alguns minutos enquanto o equipamento reinicia e a conexao volta a estabilizar.';
}

export function buildToolFailureResponse(results: AgentToolExecutionResult[], response: string): string | null {
  const failedTool = results.find((result) => (
    result.status !== 'success' &&
    (
      result.toolName === 'sgp_fetch_contact_panel_data' ||
      result.toolName === 'sgp_fetch_contracts' ||
      result.toolName.startsWith('mcp:')
    )
  ));
  if (!failedTool) return null;

  if (failedTool.toolName.startsWith('mcp:')) {
    return 'Nao consegui concluir a acao tecnica automaticamente agora. Vou encaminhar seu atendimento para nossa equipe verificar manualmente e evitar te passar uma informacao errada.';
  }

  if (hasPromisedOperationalLookup(response)) {
    return 'Nao consegui concluir a consulta no sistema agora. Vou encaminhar seu atendimento para nossa equipe verificar manualmente e evitar te passar uma informacao errada.';
  }

  return null;
}
