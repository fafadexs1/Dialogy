import { db } from '@/lib/db';
import { isValidBrazilianDocument, normalizeBrazilianDocument } from '@/lib/brazilian-document';
import { buildSGPContactPanelData, getContractId, getPrimaryService, normalizeText } from '@/plugins/sgp/contact-panel-data';
import type { SGPGlobalConfig, SGPUserConfig } from '@/plugins/sgp/types';
import { enrichSupportContractsWithLiveRadius } from '@/plugins/sgp/radius-session';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolRuntimeContext } from './types';

type SgpToolContext = {
  global: SGPGlobalConfig;
  user: SGPUserConfig;
  cpf: string;
};

export type SgpRuntimeTarget = {
  workspaceId: string;
  chatId: string;
  contactId?: string | null;
  /**
   * Identificador informado durante uma jornada determinística (por exemplo,
   * o CPF digitado no Nexus). Quando presente ele deve prevalecer sobre o
   * campo CRM, que pode ainda não estar preenchido para contatos novos.
   */
  customerIdentifier?: string | null;
};

type SupportedSgpToolAction = Extract<AgentToolAction, {
  type:
    | 'sgp_fetch_contracts'
    | 'sgp_fetch_contact_panel_data'
    | 'sgp_generate_invoice_pix'
    | 'sgp_create_payment_promise'
    | 'sgp_open_support_ticket'
}>;

function createRequestInit(token: string, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${token}`,
    },
    body: JSON.stringify(body),
  };
}

function withApplicationCredentials(global: SGPGlobalConfig, body: Record<string, unknown>) {
  if (!global.appId || !global.appToken) return body;
  return { ...body, app: global.appId, token: global.appToken };
}

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function getValidatedSgpContractIds(clients: any[]): Set<string> {
  return new Set(
    (Array.isArray(clients) ? clients : [])
      .flatMap((client: any) => Array.isArray(client?.contratos) ? client.contratos : [])
      .map((contract: any) => onlyDigits(getContractId(contract)))
      .filter(Boolean)
  );
}

export function filterSupportContractsToValidatedClients(
  clients: any[],
  supportContracts: any[]
): any[] {
  const validatedContractIds = getValidatedSgpContractIds(clients);
  return (Array.isArray(supportContracts) ? supportContracts : []).filter((contract: any) => {
    const contractId = onlyDigits(
      contract?.contrato_id ?? contract?.contrato ?? contract?.id
    );
    return Boolean(contractId) && validatedContractIds.has(contractId);
  });
}

export function scopeSgpClientsToContract(clients: any[], contractId?: string | null): any[] {
  const normalizedContractId = onlyDigits(contractId);
  if (!normalizedContractId) return Array.isArray(clients) ? clients : [];

  return (Array.isArray(clients) ? clients : []).flatMap((client: any) => {
    const contracts = (Array.isArray(client?.contratos) ? client.contratos : [])
      .filter((contract: any) => onlyDigits(getContractId(contract)) === normalizedContractId);
    return contracts.length > 0 ? [{ ...client, contratos: contracts }] : [];
  });
}

function parseMaybeJson(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function resolveContactId(target: SgpRuntimeTarget): Promise<string | null> {
  if (target.contactId) return target.contactId;
  const { rows } = await db.query(
    'SELECT contact_id FROM public.chats WHERE id = $1 AND workspace_id = $2 LIMIT 1',
    [target.chatId, target.workspaceId]
  );
  return rows[0]?.contact_id || null;
}

async function loadSgpContext(target: SgpRuntimeTarget, validateDocument = false): Promise<
  | { success: true; data: SgpToolContext }
  | { success: false; error: string; code?: string }
> {
  const { rows: integrationRows } = await db.query(
    `SELECT provider, config
     FROM public.workspace_integrations
     WHERE workspace_id = $1
       AND is_active = true
       AND (provider = 'sgp' OR provider LIKE 'sgp_user_%')
     ORDER BY CASE WHEN provider = 'sgp' THEN 0 ELSE 1 END, updated_at DESC`,
    [target.workspaceId]
  );

  const global = integrationRows.find((row) => row.provider === 'sgp')?.config as SGPGlobalConfig | undefined;
  const sgpUser = integrationRows.find((row) => String(row.provider).startsWith('sgp_user_'))?.config as SGPUserConfig | undefined;

  if (!global?.baseUrl || !global.cpfFieldId) {
    return { success: false, error: 'Integracao SGP global incompleta.' };
  }

  if (!sgpUser?.token || !sgpUser.username) {
    return { success: false, error: 'Nenhuma credencial de usuario SGP ativa encontrada para o workspace.' };
  }

  const contactId = await resolveContactId(target);
  if (!contactId) {
    return { success: false, error: 'Contato do chat nao encontrado.' };
  }

  const { rows: cpfRows } = await db.query(
    `SELECT value
     FROM public.contact_custom_field_values
     WHERE contact_id = $1 AND field_id = $2
     LIMIT 1`,
    [contactId, global.cpfFieldId]
  );

  const normalize = validateDocument ? (value: unknown) => normalizeBrazilianDocument(String(value ?? '')) : onlyDigits;
  const explicitIdentifier = normalize(target.customerIdentifier);
  if (explicitIdentifier && ![11, 14].includes(explicitIdentifier.length)) {
    return { success: false, error: 'O CPF/CNPJ informado precisa conter 11 ou 14 dígitos.' };
  }

  const crmIdentifier = normalize(cpfRows[0]?.value);
  const cpf = explicitIdentifier || crmIdentifier;
  if (!cpf) {
    return { success: false, code: 'SGP_IDENTIFIER_MISSING', error: `CPF/CNPJ nao encontrado no campo CRM mapeado (${global.cpfFieldId}).` };
  }
  if (validateDocument && !isValidBrazilianDocument(cpf)) {
    return { success: false, code: 'SGP_IDENTIFIER_INVALID', error: 'CPF/CNPJ inválido.' };
  }

  return { success: true, data: { global, user: sgpUser, cpf } };
}

async function fetchSgpClients(sgp: SgpToolContext, allowEmpty = false) {
  const response = await fetch(
    `${sgp.global.baseUrl}/api/ura/clientes/`,
    { ...createRequestInit(
      sgp.user.token!,
      withApplicationCredentials(sgp.global, {
        cpfcnpj: sgp.cpf,
        exibir_conexao: 1,
      })
    ), signal: AbortSignal.timeout(25_000) }
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Erro na API SGP: ${response.status} ${response.statusText}`);
  }

  const data = raw ? JSON.parse(raw) : {};
  if (allowEmpty && Array.isArray(data?.clientes) && data.clientes.length === 0) return [];
  if (!Array.isArray(data?.clientes) || data.clientes.length === 0) {
    throw new Error('Nenhum cliente encontrado no SGP para este CPF/CNPJ.');
  }

  return data.clientes;
}

export type SgpIdentificationContract = {
  id: string;
  statusTone?: 'active' | 'suspended' | 'cancelled' | 'unknown';
  statusLabel: string;
  addressLabel: string;
  planDescription: string;
};

export type SgpIdentificationResult =
  | { status: 'found'; cpfCnpj: string; contracts: SgpIdentificationContract[] }
  | { status: 'missing-identifier' }
  | { status: 'invalid-identifier' }
  | { status: 'not-found' }
  | { status: 'unavailable' };

/** Read-only identification for a deterministic flow; never changes the CRM CPF. */
export async function lookupSgpCustomerContracts(target: SgpRuntimeTarget): Promise<SgpIdentificationResult> {
  try {
    // Resolve identity from this conversation, never from a supplied contact ID.
    const context = await loadSgpContext({
      workspaceId: target.workspaceId,
      chatId: target.chatId,
      customerIdentifier: target.customerIdentifier,
    }, true);
    if (!context.success) return { status: context.code === 'SGP_IDENTIFIER_MISSING' ? 'missing-identifier' : context.code === 'SGP_IDENTIFIER_INVALID' ? 'invalid-identifier' : 'unavailable' };
    const clients = await fetchSgpClients(context.data, true);
    if (clients.length === 0) return { status: 'not-found' };
    const panel = buildSGPContactPanelData(clients, []);
    if (!panel) return { status: 'unavailable' };
    // Only the selection fields leave this boundary, excluding invoices and credentials.
    const contracts = panel.contracts.map(contract => ({
      id: contract.id,
      statusTone: contract.statusTone,
      statusLabel: contract.statusLabel || 'Sem status',
      addressLabel: contract.addressLabel || '',
      planDescription: contract.planDescription || '',
    }));
    return { status: 'found', cpfCnpj: context.data.cpf, contracts };
  } catch {
    return { status: 'unavailable' };
  }
}

async function fetchSupportContracts(sgp: SgpToolContext, contractId?: string | null) {
  const normalizedContractId = onlyDigits(contractId);
  const response = await fetch(
    `${sgp.global.baseUrl}/api/suporte/contrato/list/`,
    createRequestInit(
      sgp.user.token!,
      withApplicationCredentials(
        sgp.global,
        normalizedContractId
          ? { contrato_id: normalizedContractId }
          : { cliente_cpfcnpj: onlyDigits(sgp.cpf) }
      )
    )
  );

  const raw = await response.text();
  if (!response.ok) {
    return [];
  }

  const data = raw ? JSON.parse(raw) : {};
  return Array.isArray(data)
    ? data
    : Array.isArray(data?.contratos)
      ? data.contratos
      : Array.isArray(data?.dados)
        ? data.dados
        : [];
}

export async function runSgpWorkspaceTool(
  target: SgpRuntimeTarget,
  action: SupportedSgpToolAction,
): Promise<AgentToolExecutionResult> {
  if (action.type === 'sgp_open_support_ticket') {
    return {
      toolName: action.type,
      status: 'rejected',
      input: action,
      error: 'A IA nao tem permissao para abrir chamado/OS no SGP.',
    };
  }

  const requestedCustomerIdentifier = action.type === 'sgp_fetch_contact_panel_data'
    ? onlyDigits(action.payload?.customerIdentifier)
    : '';
  // Somente o chamador server-side pode definir a identidade alternativa no
  // target. Um argumento produzido pela IA continua sujeito ao CPF do CRM.
  const sgpContext = await loadSgpContext(target);
  if (!sgpContext.success) {
    return {
      toolName: action.type,
      status: 'error',
      input: action,
      error: sgpContext.error,
    };
  }

  try {
    const sgp = sgpContext.data;
    if (
      requestedCustomerIdentifier
      && requestedCustomerIdentifier !== onlyDigits(sgp.cpf)
    ) {
      return {
        toolName: action.type,
        status: 'rejected',
        input: action,
        error: 'O CPF/CNPJ informado nao corresponde ao identificador autorizado para este atendimento.',
      };
    }

    if (action.type === 'sgp_fetch_contracts') {
      const clients = await fetchSgpClients(sgp);
      const contracts = clients.flatMap((client: any) => client.contratos || [])
        .map((contract: any) => {
          const id = getContractId(contract);
          const primaryService = getPrimaryService(contract);
          const address = primaryService?.endereco || contract?.endereco || {};
          const addressLabel = [normalizeText(address?.cidade), normalizeText(address?.bairro)]
            .filter(Boolean)
            .join(' - ');
          const planDescription = normalizeText(primaryService?.plano?.descricao) || 'Contrato';
          return { id, label: `${id} - ${planDescription}${addressLabel ? ` - ${addressLabel}` : ''}` };
        })
        .filter((contract: any) => contract.id);

      return { toolName: action.type, status: 'success', input: action, output: { cpfCnpj: sgp.cpf, contracts } };
    }

    if (action.type === 'sgp_fetch_contact_panel_data') {
      const contractId = String(action.payload?.contractId ?? '').trim();
      if (contractId && !/^\d+$/.test(contractId)) {
        throw new Error('contractId deve conter somente digitos.');
      }
      const clients = await fetchSgpClients(sgp);
      const validatedContractIds = getValidatedSgpContractIds(clients);
      const requestedContractFound = !contractId || validatedContractIds.has(onlyDigits(contractId));
      const rawSupportContracts = requestedContractFound
        ? await fetchSupportContracts(sgp, contractId)
        : [];
      const validatedSupportContracts = filterSupportContractsToValidatedClients(
        clients,
        rawSupportContracts
      );
      const supportContracts = await enrichSupportContractsWithLiveRadius({
        global: sgp.global,
        user: sgp.user,
        contracts: validatedSupportContracts,
      });
      const scopedClients = scopeSgpClientsToContract(clients, contractId);
      const data = buildSGPContactPanelData(scopedClients, supportContracts);
      if (!data) throw new Error('Nenhum dado SGP encontrado para este cliente.');
      return {
        toolName: action.type,
        status: 'success',
        input: action,
        output: {
          customerName: data.customerName,
          cpfCnpj: data.cpfCnpj,
          contracts: data.contracts,
          invoices: data.invoices,
          onlineContracts: data.onlineContracts,
          overdueInvoices: data.overdueInvoices,
          openInvoices: data.openInvoices,
          invoiceGroups: data.invoiceGroups,
          requestedContractId: contractId || null,
          requestedContractFound,
        },
      };
    }

    if (action.type === 'sgp_generate_invoice_pix') {
      const invoiceId = onlyDigits(action.payload?.invoiceId);
      const contractId = onlyDigits(action.payload?.contractId);
      if (!invoiceId || !contractId) throw new Error('invoiceId e contractId sao obrigatorios.');

      const response = await fetch(
        `${sgp.global.baseUrl}/api/ura/pagamento/pix/${invoiceId}`,
        createRequestInit(
          sgp.user.token!,
          withApplicationCredentials(sgp.global, { contrato: Number(contractId) })
        )
      );
      const raw = await response.text();
      if (!response.ok) throw new Error(`Erro na API SGP: ${response.status} ${response.statusText}`);
      return { toolName: action.type, status: 'success', input: action, output: { payload: parseMaybeJson(raw) } };
    }

    const contractId = onlyDigits(action.payload?.contractId);
    const promiseDate = String(action.payload?.promiseDate || '').trim();
    if (!contractId || !/^\d{4}-\d{2}-\d{2}$/.test(promiseDate)) {
      throw new Error('contractId e promiseDate yyyy-MM-dd sao obrigatorios.');
    }

    const response = await fetch(
      `${sgp.global.baseUrl}/api/ura/liberacaopromessa/`,
      createRequestInit(
        sgp.user.token!,
        withApplicationCredentials(sgp.global, {
          contrato: Number(contractId),
          data_promessa: promiseDate,
          enviar_sms: action.payload?.sendSms !== false ? 1 : 0,
        })
      )
    );
    const raw = await response.text();
    if (!response.ok) throw new Error(`Erro na API SGP: ${response.status} ${response.statusText}`);
    return { toolName: action.type, status: 'success', input: action, output: { payload: parseMaybeJson(raw) } };
  } catch (error) {
    return {
      toolName: action.type,
      status: 'error',
      input: action,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runSgpTool(
  context: AgentToolRuntimeContext,
  action: SupportedSgpToolAction,
): Promise<AgentToolExecutionResult> {
  return runSgpWorkspaceTool({
    workspaceId: context.workspaceId,
    chatId: context.chat.id,
    contactId: context.contact?.id || null,
  }, action);
}
