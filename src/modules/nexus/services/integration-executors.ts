import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { Client } from 'pg';

import { db } from '@/lib/db';
import { resolveSafeAutopilotWebhookTarget } from '@/services/autopilot/automation-rules';
import { getEvolutionApiConfig } from '@/lib/whatsapp/evolution-config';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import type { NodeRuntimeInput } from '@/services/workflow-runtime';
import { isRecord, materializeValue, renderTemplate, statePatchAtPath } from '@/services/workflow-runtime/utils';

import { loadNexusCredentialPayload } from './credentials';
import { executeNexusMcpOperation } from './mcp-executor';

function source(input: NodeRuntimeInput) {
  return {
    ...input.execution.variables,
    input: input.execution.input,
    current: input.input,
    variables: input.execution.variables,
    context: input.execution.context,
    nodeResults: input.execution.nodeResults,
    sessionId: input.execution.sessionId,
    conversationId: input.execution.conversationId,
  };
}

function stateResult(input: NodeRuntimeInput, value: unknown, extra: Record<string, unknown> = {}) {
  const outputKey = String(input.node.config.outputKey || 'result').trim();
  return { ...extra, value, ...(outputKey ? { statePatch: statePatchAtPath(outputKey, value) } : {}) };
}

function safeHeader(value: unknown) {
  const text = String(value ?? '').trim();
  if (/[\r\n]/.test(text)) throw new Error('Cabeçalho de e-mail inválido.');
  return text;
}

class SmtpSession {
  private buffer = '';
  private waiter: ((value: string) => void) | null = null;

  constructor(private socket: net.Socket | tls.TLSSocket) { this.listen(); }

  private listen() {
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk) => {
      this.buffer += String(chunk);
      const lines = this.buffer.split(/\r?\n/);
      for (let index = 0; index < lines.length - 1; index += 1) {
        if (/^\d{3} /.test(lines[index]!)) {
          const response = lines.slice(0, index + 1).join('\n');
          this.buffer = lines.slice(index + 1).join('\n');
          const waiter = this.waiter;
          this.waiter = null;
          waiter?.(response);
          return;
        }
      }
    });
  }

  async response() {
    const ready = this.buffer.match(/^[\s\S]*?^\d{3} .*$/m)?.[0];
    if (ready) {
      this.buffer = this.buffer.slice(ready.length).replace(/^\r?\n/, '');
      return ready;
    }
    return new Promise<string>((resolve, reject) => {
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onClose = () => { cleanup(); reject(new Error('A conexão SMTP foi encerrada.')); };
      const cleanup = () => { this.socket.off('error', onError); this.socket.off('close', onClose); };
      this.waiter = (value) => { cleanup(); resolve(value); };
      this.socket.once('error', onError);
      this.socket.once('close', onClose);
    });
  }

  async command(command: string, codes: number[]) {
    this.socket.write(`${command}\r\n`);
    const response = await this.response();
    const code = Number(response.split('\n').at(-1)?.slice(0, 3));
    if (!codes.includes(code)) throw new Error(`SMTP rejeitou o comando (${response.split('\n').at(-1)}).`);
    return response;
  }

  write(value: string) { this.socket.write(value); }

  async upgrade(host: string) {
    this.socket.removeAllListeners('data');
    const secured = tls.connect({ socket: this.socket as net.Socket, servername: host, rejectUnauthorized: true });
    await once(secured, 'secureConnect');
    this.socket = secured;
    this.buffer = '';
    this.listen();
  }

  close() { this.socket.end(); }
}

async function openSocket(host: string, port: number, secure: boolean, timeoutMs: number) {
  const socket = secure
    ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
    : net.connect({ host, port });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error('Timeout SMTP.')));
  await once(socket, secure ? 'secureConnect' : 'connect');
  return socket;
}

async function sendSmtp(input: NodeRuntimeInput) {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('O workflow de e-mail precisa pertencer a um workspace.');
  const credential = await loadNexusCredentialPayload({ workspaceId, credentialId: String(input.node.config.credentialId || ''), allowedTypes: ['smtp'] });
  const payload = credential.payload;
  const host = String(payload.host || '').trim();
  const port = Number(payload.port || (payload.secure === true ? 465 : 587));
  const secure = payload.secure === true || String(payload.secure) === 'true';
  const timeoutMs = Math.max(1_000, Math.min(120_000, Number(input.node.config.timeoutMs || 20_000)));
  const context = source(input);
  const to = safeHeader(renderTemplate(String(input.node.config.to || ''), context));
  const cc = safeHeader(renderTemplate(String(input.node.config.cc || ''), context));
  const from = safeHeader(renderTemplate(String(input.node.config.from || payload.from || payload.username || ''), context));
  const subject = safeHeader(renderTemplate(String(input.node.config.subject || ''), context));
  if (!host || !to || !from || !subject) throw new Error('SMTP, remetente, destinatário e assunto são obrigatórios.');
  const text = renderTemplate(String(input.node.config.text || ''), context);
  const html = renderTemplate(String(input.node.config.html || ''), context);
  if (!text && !html) throw new Error('O e-mail precisa de conteúdo em texto ou HTML.');
  const socket = await openSocket(host, port, secure, timeoutMs);
  const session = new SmtpSession(socket);
  try {
    const greeting = await session.response();
    if (!greeting.startsWith('220')) throw new Error(`Servidor SMTP indisponível: ${greeting}.`);
    await session.command(`EHLO dialogy-nexus`, [250]);
    if (!secure) {
      await session.command('STARTTLS', [220]);
      await session.upgrade(host);
      await session.command('EHLO dialogy-nexus', [250]);
    }
    const username = String(payload.username || '');
    const password = String(payload.password || '');
    if (username) {
      await session.command('AUTH LOGIN', [334]);
      await session.command(Buffer.from(username).toString('base64'), [334]);
      await session.command(Buffer.from(password).toString('base64'), [235]);
    }
    await session.command(`MAIL FROM:<${from}>`, [250]);
    const recipients = [to, cc].filter(Boolean).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
    for (const recipient of recipients) await session.command(`RCPT TO:<${recipient}>`, [250, 251]);
    await session.command('DATA', [354]);
    const boundary = `nexus_${Date.now().toString(36)}`;
    const headers = [`From: ${from}`, `To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, 'MIME-Version: 1.0'];
    let body: string;
    if (text && html) {
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      body = `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n--${boundary}--`;
    } else {
      headers.push(`Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=utf-8`);
      body = html || text;
    }
    session.write(`${headers.join('\r\n')}\r\n\r\n${body.replace(/^\./gm, '..')}\r\n.\r\n`);
    const accepted = await session.response();
    if (!accepted.startsWith('250')) throw new Error(`SMTP não aceitou a mensagem: ${accepted}.`);
    await session.command('QUIT', [221]);
    return stateResult(input, { accepted: true, recipients }, { accepted: true, recipients });
  } finally {
    session.close();
  }
}

function identifier(value: unknown) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) throw new Error(`Identificador de banco inválido: ${text}.`);
  return `"${text}"`;
}

function tableIdentifier(value: unknown) {
  return String(value || '').split('.').map(identifier).join('.');
}

export type NexusDatabaseOperationInput = {
  workspaceId: string;
  credentialId: string;
  config: Record<string, unknown>;
  runtimeSource: Record<string, unknown>;
};

export async function executeNexusDatabaseOperation(input: NexusDatabaseOperationInput) {
  const workspaceId = input.workspaceId;
  if (!workspaceId) throw new Error('O workflow de banco precisa pertencer a um workspace.');
  const credential = await loadNexusCredentialPayload({ workspaceId, credentialId: input.credentialId, allowedTypes: ['database'] });
  const connectionString = String(credential.payload.connectionString || '');
  if (!connectionString) throw new Error('A credencial de banco não possui connection string.');
  const operation = String(input.config.operation || 'select');
  const table = tableIdentifier(input.config.table);
  const context = input.runtimeSource;
  const materializedValues = materializeValue(input.config.values || {}, context);
  const values = isRecord(materializedValues) ? materializedValues : {};
  const filters = Array.isArray(input.config.filters) ? input.config.filters.filter(isRecord) : [];
  if (['update', 'delete'].includes(operation) && filters.length === 0) throw new Error('UPDATE e DELETE exigem ao menos um filtro.');
  const parameters: unknown[] = [];
  const parameter = (value: unknown) => { parameters.push(value); return `$${parameters.length}`; };
  const where = filters.map((filter) => {
    const column = identifier(filter.column);
    const operator = String(filter.operator || 'eq');
    if (operator === 'is_null') return `${column} IS NULL`;
    if (operator === 'not_null') return `${column} IS NOT NULL`;
    const value = materializeValue(filter.value, context);
    if (operator === 'in') {
      if (!Array.isArray(value) || value.length === 0) throw new Error('O filtro IN precisa de uma lista não vazia.');
      return `${column} IN (${value.map(parameter).join(', ')})`;
    }
    const operators: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE' };
    if (!operators[operator]) throw new Error(`Operador de filtro não permitido: ${operator}.`);
    return `${column} ${operators[operator]} ${parameter(value)}`;
  });
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  let sql: string;
  if (operation === 'select') {
    const columns = Array.isArray(input.config.columns) && input.config.columns.length
      ? input.config.columns.map((column) => column === '*' ? '*' : identifier(column)).join(', ')
      : '*';
    const limit = Math.max(1, Math.min(1_000, Number(input.config.limit || 100)));
    sql = `SELECT ${columns} FROM ${table}${whereSql} LIMIT ${parameter(limit)}`;
  } else if (operation === 'insert') {
    const entries = Object.entries(values);
    if (!entries.length) throw new Error('INSERT exige ao menos um valor.');
    sql = `INSERT INTO ${table} (${entries.map(([key]) => identifier(key)).join(', ')}) VALUES (${entries.map(([, value]) => parameter(value)).join(', ')})`;
  } else if (operation === 'update') {
    const entries = Object.entries(values);
    if (!entries.length) throw new Error('UPDATE exige ao menos um valor.');
    sql = `UPDATE ${table} SET ${entries.map(([key, value]) => `${identifier(key)} = ${parameter(value)}`).join(', ')}${whereSql}`;
  } else if (operation === 'delete') sql = `DELETE FROM ${table}${whereSql}`;
  else throw new Error(`Operação de banco não permitida: ${operation}.`);
  const returning = Array.isArray(input.config.returning)
    ? input.config.returning.map((column) => column === '*' ? '*' : identifier(column)).join(', ')
    : '';
  if (returning && operation !== 'select') sql += ` RETURNING ${returning}`;
  const client = new Client({ connectionString, ssl: credential.payload.ssl === false ? false : { rejectUnauthorized: true }, connectionTimeoutMillis: 15_000, query_timeout: 30_000 });
  try {
    await client.connect();
    const result = await client.query(sql, parameters);
    return { rows: result.rows, rowCount: result.rowCount || 0, operation };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function executeDatabase(input: NodeRuntimeInput) {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('O workflow de banco precisa pertencer a um workspace.');
  const value = await executeNexusDatabaseOperation({
    workspaceId,
    credentialId: String(input.node.config.credentialId || ''),
    config: input.node.config,
    runtimeSource: source(input),
  });
  return stateResult(input, value, value);
}

async function appendGoogleSheet(input: NodeRuntimeInput) {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('O workflow do Google Sheets precisa pertencer a um workspace.');
  const credential = await loadNexusCredentialPayload({ workspaceId, credentialId: String(input.node.config.credentialId || ''), allowedTypes: ['google_oauth'] });
  const payload = credential.payload;
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: String(payload.clientId || ''), client_secret: String(payload.clientSecret || ''), refresh_token: String(payload.refreshToken || ''), grant_type: 'refresh_token' }),
    signal: input.signal,
  });
  const tokenData = await tokenResponse.json() as Record<string, unknown>;
  if (!tokenResponse.ok || !tokenData.access_token) throw new Error(`Falha ao renovar acesso do Google Sheets (${tokenResponse.status}).`);
  const spreadsheetId = encodeURIComponent(renderTemplate(String(input.node.config.spreadsheetId || ''), source(input)));
  const range = encodeURIComponent(renderTemplate(String(input.node.config.range || ''), source(input)));
  const materialized = materializeValue(input.node.config.values || [], source(input));
  const values = Array.isArray(materialized) && Array.isArray(materialized[0]) ? materialized : [Array.isArray(materialized) ? materialized : [materialized]];
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=${encodeURIComponent(String(input.node.config.valueInputOption || 'USER_ENTERED'))}&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${String(tokenData.access_token)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
    signal: input.signal,
  });
  const result = await response.json() as unknown;
  if (!response.ok) throw new Error(`Google Sheets rejeitou o append (${response.status}).`);
  return stateResult(input, result, { appended: true, response: result });
}

async function updateCrm(input: NodeRuntimeInput) {
  const workspaceId = input.workflow.workspaceId;
  const chatId = input.execution.conversationId;
  if (!workspaceId || !chatId) throw new Error('A atualização de CRM exige um atendimento ativo.');
  const materialized = materializeValue(input.node.config.fields || {}, source(input));
  if (!isRecord(materialized) || Object.keys(materialized).length === 0) throw new Error('Informe ao menos um campo do CRM.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const contactResult = await client.query('SELECT contact_id FROM public.chats WHERE id = $1 AND workspace_id = $2 LIMIT 1', [chatId, workspaceId]);
    const contactId = contactResult.rows[0]?.contact_id;
    if (!contactId) throw new Error('Contato do atendimento não encontrado.');
    const standard: Record<string, string> = { name: 'name', email: 'email', phone: 'phone_number_jid', phone_number_jid: 'phone_number_jid', address: 'address' };
    const updated: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(materialized)) {
      if (standard[field]) {
        await client.query(`UPDATE public.contacts SET ${standard[field]} = $3 WHERE id = $1 AND workspace_id = $2`, [contactId, workspaceId, String(value ?? '')]);
        updated[field] = value;
        continue;
      }
      const definition = await client.query(
        `SELECT id FROM public.custom_field_definitions WHERE workspace_id = $1 AND (id::text = $2 OR lower(label) = lower($2)) LIMIT 1`,
        [workspaceId, field],
      );
      const fieldId = definition.rows[0]?.id;
      if (!fieldId) throw new Error(`Campo personalizado do CRM não encontrado: ${field}.`);
      await client.query(
        `INSERT INTO public.contact_custom_field_values (contact_id, field_id, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (contact_id, field_id) DO UPDATE SET value = EXCLUDED.value`,
        [contactId, fieldId, String(value ?? '')],
      );
      updated[field] = value;
    }
    await client.query('COMMIT');
    try {
      const { dispatchDialogyNexusInternalEvent } = await import('./dialogy-event-dispatcher');
      const rawChain = input.execution.context.nexusInternalEventChain;
      await dispatchDialogyNexusInternalEvent({
        workspaceId,
        eventName: 'contact.updated',
        eventId: `${input.execution.executionId}:${input.node.id}`,
        chatId,
        sessionId: input.execution.sessionId,
        conversationId: chatId,
        eventChain: Array.isArray(rawChain) ? rawChain.map(String) : undefined,
        context: {
          causedByExecutionId: input.execution.executionId,
          causedByNodeId: input.node.id,
        },
        payload: { contactId, chatId, fields: updated },
      });
    } catch (eventError) {
      console.error('[NEXUS_CRM_UPDATE] Falha ao despachar contact.updated:', eventError);
    }
    return stateResult(input, { contactId, fields: updated }, { updated: true, contactId, fields: updated });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function normalizeGroupParticipants(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value.flatMap((item) => String(item ?? '').split(/[\n,;]+/))
    : String(value ?? '').split(/[\n,;]+/);
  const normalized = entries
    .map((item) => item.replace(/@.*$/, '').replace(/\D/g, ''))
    .filter((item) => item.length >= 8 && item.length <= 15);
  return [...new Set(normalized)];
}

function whatsappPhone(value: unknown) {
  const normalized = String(value ?? '').replace(/@.*$/, '').replace(/\D/g, '');
  if (normalized.length < 8 || normalized.length > 15) throw new Error('Informe um telefone válido com país e DDD.');
  return normalized;
}

function outboundMimeType(mediaType: string, url: string, configured: string) {
  if (configured) return configured;
  const extension = (() => { try { return new URL(url).pathname.split('.').pop()?.toLowerCase() || ''; } catch { return ''; } })();
  const byExtension: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/opus', wav: 'audio/wav', m4a: 'audio/mp4',
    pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
  };
  return byExtension[extension]
    || (mediaType === 'image' ? 'image/jpeg' : mediaType === 'video' ? 'video/mp4' : mediaType === 'audio' ? 'audio/mpeg' : 'application/octet-stream');
}

async function whatsappTarget(input: NodeRuntimeInput) {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('O envio WhatsApp precisa pertencer a um workspace.');
  const context = source(input);
  const instanceName = renderTemplate(
    String(input.node.config.instanceName || input.execution.context.instanceName || ''),
    context,
  ).trim();
  const phoneNumber = whatsappPhone(renderTemplate(String(
    input.node.config.phoneNumber
      || input.execution.context.contactPhone
      || input.execution.context.phoneNumber
      || '',
  ), context));
  if (!instanceName) throw new Error('Selecione uma instância do WhatsApp para o envio.');
  const apiConfig = await getEvolutionApiConfig(instanceName, { workspaceId, allowLegacyInstanceName: true });
  if (!apiConfig) throw new Error(`A instância Evolution ${instanceName} não está configurada neste workspace.`);
  return { workspaceId, context, instanceName, phoneNumber, apiConfig };
}

async function sendWhatsappText(input: NodeRuntimeInput) {
  const target = await whatsappTarget(input);
  const message = renderTemplate(String(input.node.config.message || ''), target.context).trim();
  if (!message) throw new Error('A mensagem do WhatsApp está vazia.');
  const response = await fetchEvolutionAPI(
    `/message/sendText/${encodeURIComponent(target.instanceName)}`,
    target.apiConfig,
    { method: 'POST', body: JSON.stringify({ number: target.phoneNumber, text: message }) },
  );
  const value = { instanceName: target.instanceName, phoneNumber: target.phoneNumber, response };
  return stateResult(input, value, { sent: true, ...value });
}

async function sendWhatsappMedia(input: NodeRuntimeInput) {
  const target = await whatsappTarget(input);
  const mediaType = String(input.node.config.mediaType || 'image');
  if (!['image', 'video', 'audio', 'document'].includes(mediaType)) throw new Error('Tipo de mídia do WhatsApp inválido.');
  const renderedUrl = renderTemplate(String(input.node.config.url || ''), target.context).trim();
  if (!renderedUrl) throw new Error('A URL da mídia do WhatsApp está vazia.');
  const safeMedia = await resolveSafeAutopilotWebhookTarget(renderedUrl);
  const mediaUrl = safeMedia.url.toString();
  const caption = renderTemplate(String(input.node.config.caption || ''), target.context);
  const fileName = renderTemplate(String(input.node.config.fileName || ''), target.context).trim() || `nexus-${input.node.id}`;
  const mimeType = outboundMimeType(mediaType, mediaUrl, renderTemplate(String(input.node.config.mimeType || ''), target.context).trim());
  const response = await fetchEvolutionAPI(
    `/message/sendMedia/${encodeURIComponent(target.instanceName)}`,
    target.apiConfig,
    {
      method: 'POST',
      body: JSON.stringify({
        number: target.phoneNumber,
        mediatype: mediaType,
        mimetype: mimeType,
        media: mediaUrl,
        caption,
        fileName,
      }),
    },
  );
  const value = { instanceName: target.instanceName, phoneNumber: target.phoneNumber, mediaType, mediaUrl, response };
  return stateResult(input, value, { sent: true, ...value });
}

async function createWhatsappGroup(input: NodeRuntimeInput) {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('A criação de grupo precisa pertencer a um workspace.');
  const context = source(input);
  const instanceName = renderTemplate(
    String(input.node.config.instanceName || input.execution.context.instanceName || ''),
    context,
  ).trim();
  const groupName = renderTemplate(String(input.node.config.groupName || ''), context).trim();
  const participantsValue = materializeValue(input.node.config.participants || [], context);
  const participants = normalizeGroupParticipants(participantsValue);
  if (!instanceName) throw new Error('Selecione uma instância do WhatsApp ou execute o fluxo dentro de uma conversa com instância conhecida.');
  if (!groupName || groupName.length > 100) throw new Error('O nome do grupo deve ter entre 1 e 100 caracteres.');
  if (participants.length === 0) throw new Error('Informe ao menos um participante com telefone válido.');
  if (participants.length > 256) throw new Error('Um único bloco pode adicionar no máximo 256 participantes.');
  const apiConfig = await getEvolutionApiConfig(instanceName, { workspaceId, allowLegacyInstanceName: true });
  if (!apiConfig) throw new Error(`A instância Evolution ${instanceName} não está configurada neste workspace.`);
  const response = await fetchEvolutionAPI(
    `/group/create/${encodeURIComponent(instanceName)}`,
    apiConfig,
    { method: 'POST', body: JSON.stringify({ subject: groupName, participants }) },
  );
  const value = { instanceName, groupName, participants, response };
  return stateResult(input, value, { created: true, ...value });
}

async function callMcpTool(input: NodeRuntimeInput) {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('O workflow MCP precisa pertencer a um workspace.');
  const runtimeSource = source(input);
  const argumentsValue = materializeValue(input.node.config.arguments || {}, runtimeSource);
  if (!isRecord(argumentsValue)) throw new Error('Os argumentos da ferramenta MCP precisam formar um objeto JSON.');
  const confirmationPath = String(input.node.config.confirmationPath || '').trim();
  const confirmed = confirmationPath
    ? materializeValue(`{{${confirmationPath.replace(/^\$\./, '')}}}`, runtimeSource) === true
    : false;
  const value = await executeNexusMcpOperation({
    workspaceId,
    qualifiedName: String(input.node.config.toolName || ''),
    arguments: argumentsValue,
    confirmed,
    enforceConfirmation: true,
    maxOutputBytes: Number(input.node.config.maxOutputBytes || 1_000_000),
    signal: input.signal,
  });
  return stateResult(input, value, value);
}

export async function executeNexusIntegration(input: NodeRuntimeInput): Promise<Record<string, unknown>> {
  if (input.node.type === 'integration.email') return sendSmtp(input);
  if (input.node.type === 'integration.database') return executeDatabase(input);
  if (input.node.type === 'integration.google_sheets_append') return appendGoogleSheet(input);
  if (input.node.type === 'integration.mcp_call') return callMcpTool(input);
  if (input.node.type === 'dialogy.crm_update') return updateCrm(input);
  if (input.node.type === 'whatsapp.send_text') return sendWhatsappText(input);
  if (input.node.type === 'whatsapp.send_media') return sendWhatsappMedia(input);
  if (input.node.type === 'whatsapp.group_create') return createWhatsappGroup(input);
  throw new Error(`Integração Nexus não implementada: ${input.node.type}.`);
}
