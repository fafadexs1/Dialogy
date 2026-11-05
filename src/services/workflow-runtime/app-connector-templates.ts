import { ConnectorDefinitionSchema, type ConnectorDefinition } from './connector-contract';

type Template = { id: string; service: string; label: string; definition: ConnectorDefinition };
const text = (description: string, maxLength = 1000) => ({ type: 'string', minLength: 1, maxLength, description });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
function template(id: string, service: string, label: string, url: string, args: Record<string, unknown>, options: {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string>; responseFormat?: 'json' | 'text' | 'file' | 'auto'; fileName?: string; bodyTransform?: 'gmail_reply'; encodedPathArguments?: string[]; description: string;
}): Template {
  const method = options.method || 'GET';
  return { id, service, label, definition: ConnectorDefinitionSchema.parse({ name: `${service} · ${label}`, description: options.description,
    inputSchema: args, outputSchema: { type: 'object' }, approval: method === 'GET' || ['notion_search', 'calendar_freebusy'].includes(id) ? 'automatic' : 'required',
    http: { method, url, headers: options.headers || {}, query: options.query || {}, bodyType: options.body ? 'json' : 'none',
      body: options.body, ...(options.bodyTransform ? { bodyTransform: options.bodyTransform } : {}), ...(options.encodedPathArguments ? { encodedPathArguments: options.encodedPathArguments } : {}), credentialRequired: true, credentialId: '', responseFormat: options.responseFormat || 'json', ...(options.fileName ? { fileName: options.fileName } : {}) } }) };
}
const argument = (name: string) => `{{arguments.${name}}}`;
const identifier = (description: string) => ({ ...text(description, 100), pattern: '^[A-Za-z0-9_-]+$' });
const sheetRange = { ...text('Intervalo A1, por exemplo Sheet1!A1:B10', 200), pattern: '^[A-Za-z0-9_$!:]+$' };
const slideObjectId = (description: string) => ({ ...text(description, 50), pattern: '^[A-Za-z0-9_][A-Za-z0-9_:-]{4,49}$' });
const dateTime = (description: string) => ({ ...text(description, 40), format: 'date-time', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$' });
const githubName = (description: string) => ({ ...text(description, 100), pattern: '^(?!\\.{1,2}$)[A-Za-z0-9_.-]+$' });
const githubPath = { ...text('Caminho do arquivo no repositório', 500), pattern: '^(?!\\.\\.?(/|$))(?!.*\\/\\.\\.?(\\/|$))[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*$' };
const githubHeaders = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'DialogyAgent/1.0' };

/** Ready-to-configure operations with fixed origins and explicit contracts. Credentials are bound in the library. */
export const appConnectorTemplates: Template[] = [
  template('calendar_list', 'Google Agenda', 'Listar eventos', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', object({ timeMin: dateTime('Início RFC3339 com fuso'), timeMax: dateTime('Fim RFC3339 com fuso') }), {
    description: 'Consulta eventos da agenda principal dentro do período informado.', query: { timeMin: argument('timeMin'), timeMax: argument('timeMax'), singleEvents: true, orderBy: 'startTime', maxResults: 100 } }),
  template('calendar_freebusy', 'Google Agenda', 'Consultar disponibilidade', 'https://www.googleapis.com/calendar/v3/freeBusy', object({ timeMin: dateTime('Início RFC3339 com fuso'), timeMax: dateTime('Fim RFC3339 com fuso') }), {
    description: 'Consulta períodos ocupados da agenda principal. Não cria nem altera eventos.', method: 'POST', body: { timeMin: argument('timeMin'), timeMax: argument('timeMax'), items: [{ id: 'primary' }] } }),
  template('calendar_create', 'Google Agenda', 'Criar evento', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', object({ summary: text('Título'), start: dateTime('Início RFC3339 com fuso'), end: dateTime('Fim RFC3339 com fuso') }), {
    description: 'Cria um evento na agenda principal após aprovação humana.', method: 'POST', body: { summary: argument('summary'), start: { dateTime: argument('start') }, end: { dateTime: argument('end') } } }),
  template('calendar_reschedule', 'Google Agenda', 'Remarcar evento', 'https://www.googleapis.com/calendar/v3/calendars/primary/events/{{arguments.id}}', object({ id: identifier('ID do evento'), start: dateTime('Novo início RFC3339 com fuso'), end: dateTime('Novo fim RFC3339 com fuso') }), {
    description: 'Altera o horário de um evento existente após aprovação humana.', method: 'PATCH', body: { start: { dateTime: argument('start') }, end: { dateTime: argument('end') } } }),
  template('calendar_delete', 'Google Agenda', 'Excluir evento', 'https://www.googleapis.com/calendar/v3/calendars/primary/events/{{arguments.id}}', object({ id: identifier('ID do evento') }), {
    description: 'Exclui um evento da agenda após aprovação humana.', method: 'DELETE', responseFormat: 'auto' }),
  template('calendar_reminder', 'Google Agenda', 'Criar evento com lembrete', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', object({
    summary: text('Título'), start: dateTime('Início RFC3339 com fuso'), end: dateTime('Fim RFC3339 com fuso'),
    reminderMethod: { type: 'string', enum: ['email', 'popup'], description: 'Meio do lembrete do Google Agenda' },
    reminderMinutes: { type: 'integer', minimum: 0, maximum: 40320, description: 'Minutos antes do início, até quatro semanas' },
  }), {
    description: 'Cria um evento com lembrete por e-mail ou popup do Google Agenda, após aprovação humana.', method: 'POST',
    body: { summary: argument('summary'), start: { dateTime: argument('start') }, end: { dateTime: argument('end') },
      reminders: { useDefault: false, overrides: [{ method: argument('reminderMethod'), minutes: argument('reminderMinutes') }] } } }),
  template('gmail_search', 'Gmail', 'Buscar mensagens', 'https://gmail.googleapis.com/gmail/v1/users/me/messages', object({ q: text('Busca Gmail, por exemplo newer_than:7d') }), {
    description: 'Busca IDs e threads de mensagens; a listagem não contém o corpo dos emails.', query: { q: argument('q'), maxResults: 100 } }),
  template('gmail_get', 'Gmail', 'Ler mensagem', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/{{arguments.id}}', object({ id: identifier('ID da mensagem') }), {
    description: 'Consulta conteúdo e cabeçalhos de uma mensagem encontrada no Gmail; corpos MIME podem vir codificados em base64url.', query: { format: 'full' } }),
  template('gmail_send', 'Gmail', 'Enviar mensagem MIME', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', object({ raw: text('Mensagem MIME completa codificada em base64url', 100000) }), {
    description: 'Envia mensagem MIME já codificada em base64url após aprovação humana.', method: 'POST', body: { raw: argument('raw') } }),
  template('gmail_reply', 'Gmail', 'Responder conversa', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', object({
    to: { ...text('Endereço do destinatário', 254), pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
    subject: text('Assunto original da conversa'), inReplyTo: text('Message-ID original entre < e >', 500),
    threadId: identifier('ID da conversa Gmail'), text: text('Texto da resposta', 10000),
  }), { description: 'Envia resposta em texto à conversa após aprovação dos dados; use o mesmo assunto da mensagem original.', method: 'POST', bodyTransform: 'gmail_reply' }),
  template('drive_search', 'Google Drive', 'Buscar arquivos', 'https://www.googleapis.com/drive/v3/files', object({ q: text('Consulta da API Drive, por exemplo trashed = false') }), {
    description: 'Lista metadados de arquivos compatíveis com a consulta da API Drive.', query: { q: argument('q'), pageSize: 100, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)' } }),
  template('drive_export_text', 'Google Drive', 'Ler documento Google', 'https://www.googleapis.com/drive/v3/files/{{arguments.id}}/export', object({ id: identifier('ID do documento Google') }), {
    description: 'Exporta o conteúdo de um documento Google em texto simples.', query: { mimeType: 'text/plain' }, responseFormat: 'text' }),
  template('drive_export_csv', 'Google Drive', 'Ler planilha Google', 'https://www.googleapis.com/drive/v3/files/{{arguments.id}}/export', object({ id: identifier('ID da planilha Google') }), {
    description: 'Exporta a primeira aba de uma planilha Google em CSV.', query: { mimeType: 'text/csv' }, responseFormat: 'text' }),
  template('drive_download', 'Google Drive', 'Baixar arquivo', 'https://www.googleapis.com/drive/v3/files/{{arguments.id}}', object({ id: identifier('ID do arquivo') }), {
    description: 'Baixa um arquivo armazenado no Drive para o armazenamento privado do workspace. Documentos Google usam a exportação própria.', query: { alt: 'media' }, responseFormat: 'file', fileName: 'arquivo-drive' }),
  template('drive_create_folder', 'Google Drive', 'Criar pasta', 'https://www.googleapis.com/drive/v3/files', object({ name: text('Nome da pasta') }), {
    description: 'Cria pasta na raiz do Drive após aprovação humana.', method: 'POST', body: { name: argument('name'), mimeType: 'application/vnd.google-apps.folder' } }),
  template('docs_read', 'Google Docs', 'Ler documento', 'https://docs.googleapis.com/v1/documents/{{arguments.id}}', object({ id: identifier('ID do documento') }), {
    description: 'Consulta a estrutura de um documento Google acessível.', query: { includeTabsContent: true } }),
  template('docs_create', 'Google Docs', 'Criar documento vazio', 'https://docs.googleapis.com/v1/documents', object({ title: text('Título do documento') }), {
    description: 'Cria um documento vazio após aprovação humana.', method: 'POST', body: { title: argument('title') } }),
  template('docs_append', 'Google Docs', 'Acrescentar texto', 'https://docs.googleapis.com/v1/documents/{{arguments.id}}:batchUpdate', object({ id: identifier('ID do documento'), text: text('Texto a acrescentar', 10000) }), {
    description: 'Acrescenta texto ao final da primeira aba do documento após aprovação humana.', method: 'POST', body: { requests: [{ insertText: { endOfSegmentLocation: {}, text: argument('text') } }] } }),
  template('sheets_create', 'Google Sheets', 'Criar planilha', 'https://sheets.googleapis.com/v4/spreadsheets', object({ title: text('Título da planilha') }), {
    description: 'Cria uma planilha após aprovação humana.', method: 'POST', body: { properties: { title: argument('title') } } }),
  template('sheets_read', 'Google Sheets', 'Ler intervalo', 'https://sheets.googleapis.com/v4/spreadsheets/{{arguments.id}}/values/{{arguments.range}}', object({ id: identifier('ID da planilha'), range: sheetRange }), {
    description: 'Lê valores de um intervalo A1 acessível na planilha.', encodedPathArguments: ['arguments.range'] }),
  template('sheets_write', 'Google Sheets', 'Atualizar intervalo', 'https://sheets.googleapis.com/v4/spreadsheets/{{arguments.id}}/values/{{arguments.range}}', object({ id: identifier('ID da planilha'), range: sheetRange, values: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'array', minItems: 1, maxItems: 100, items: { anyOf: [{ type: 'string', maxLength: 5000 }, { type: 'number' }, { type: 'boolean' }] } } } }), {
    description: 'Substitui valores no intervalo indicado após aprovação. Os valores são gravados como dados, sem interpretar fórmulas.', method: 'PUT', encodedPathArguments: ['arguments.range'], query: { valueInputOption: 'RAW' }, body: { majorDimension: 'ROWS', values: argument('values') } }),
  template('slides_read', 'Google Slides', 'Ler apresentação', 'https://slides.googleapis.com/v1/presentations/{{arguments.id}}', object({ id: identifier('ID da apresentação') }), {
    description: 'Consulta a estrutura e os slides de uma apresentação acessível.' }),
  template('slides_create', 'Google Slides', 'Criar apresentação', 'https://slides.googleapis.com/v1/presentations', object({ title: text('Título da apresentação') }), {
    description: 'Cria uma apresentação após aprovação humana.', method: 'POST', body: { title: argument('title') } }),
  template('slides_add_slide', 'Google Slides', 'Adicionar slide em branco', 'https://slides.googleapis.com/v1/presentations/{{arguments.id}}:batchUpdate', object({ id: identifier('ID da apresentação'), slideId: slideObjectId('ID exclusivo do novo slide') }), {
    description: 'Adiciona um slide em branco após aprovação humana.', method: 'POST', body: { requests: [{ createSlide: { objectId: argument('slideId'), slideLayoutReference: { predefinedLayout: 'BLANK' } } }] } }),
  template('slides_add_text', 'Google Slides', 'Adicionar caixa de texto', 'https://slides.googleapis.com/v1/presentations/{{arguments.id}}:batchUpdate', object({ id: identifier('ID da apresentação'), slideId: slideObjectId('ID do slide'), shapeId: slideObjectId('ID exclusivo da caixa de texto'), text: text('Texto', 10000) }), {
    description: 'Adiciona uma caixa de texto ao slide após aprovação humana.', method: 'POST', body: { requests: [{ createShape: { objectId: argument('shapeId'), shapeType: 'TEXT_BOX', elementProperties: { pageObjectId: argument('slideId'), size: { width: { magnitude: 500, unit: 'PT' }, height: { magnitude: 100, unit: 'PT' } }, transform: { scaleX: 1, scaleY: 1, translateX: 40, translateY: 40, unit: 'PT' } } } }, { insertText: { objectId: argument('shapeId'), text: argument('text') } }] } }),
  template('github_repos', 'GitHub', 'Listar repositórios', 'https://api.github.com/user/repos', object({}), {
    description: 'Lista até 100 repositórios acessíveis à conta autenticada.', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'DialogyAgent/1.0' }, query: { per_page: 100 } }),
  template('github_create_repo', 'GitHub', 'Criar repositório privado', 'https://api.github.com/user/repos', object({ name: text('Nome do repositório', 100) }), {
    description: 'Cria repositório privado para a conta autenticada após aprovação humana.', method: 'POST', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'DialogyAgent/1.0' }, body: { name: argument('name'), private: true } }),
  template('github_issues', 'GitHub', 'Listar issues', 'https://api.github.com/repos/{{arguments.owner}}/{{arguments.repo}}/issues', object({ owner: githubName('Conta ou organização'), repo: githubName('Repositório') }), {
    description: 'Lista issues abertas no repositório autorizado.', headers: githubHeaders, query: { state: 'open', per_page: 100 } }),
  template('github_create_issue', 'GitHub', 'Criar issue', 'https://api.github.com/repos/{{arguments.owner}}/{{arguments.repo}}/issues', object({ owner: githubName('Conta ou organização'), repo: githubName('Repositório'), title: text('Título da issue'), body: text('Descrição', 10000) }), {
    description: 'Cria uma issue após aprovação humana.', method: 'POST', headers: githubHeaders, body: { title: argument('title'), body: argument('body') } }),
  template('github_pull_requests', 'GitHub', 'Listar pull requests', 'https://api.github.com/repos/{{arguments.owner}}/{{arguments.repo}}/pulls', object({ owner: githubName('Conta ou organização'), repo: githubName('Repositório') }), {
    description: 'Lista pull requests abertas no repositório autorizado.', headers: githubHeaders, query: { state: 'open', per_page: 100 } }),
  template('github_read_file', 'GitHub', 'Ler arquivo', 'https://api.github.com/repos/{{arguments.owner}}/{{arguments.repo}}/contents/{{arguments.path}}', object({ owner: githubName('Conta ou organização'), repo: githubName('Repositório'), path: githubPath, ref: text('Branch ou commit', 255) }), {
    description: 'Lê um arquivo do repositório; o conteúdo pode ser retornado em base64.', headers: githubHeaders, query: { ref: argument('ref') } }),
  template('github_update_file', 'GitHub', 'Atualizar arquivo', 'https://api.github.com/repos/{{arguments.owner}}/{{arguments.repo}}/contents/{{arguments.path}}', object({ owner: githubName('Conta ou organização'), repo: githubName('Repositório'), path: githubPath, branch: text('Branch de trabalho', 255), sha: { ...text('SHA atual do arquivo', 40), pattern: '^[A-Fa-f0-9]{40}$' }, message: text('Mensagem do commit'), content: { ...text('Conteúdo completo em base64', 100000), pattern: '^[A-Za-z0-9+/=]+$' } }), {
    description: 'Atualiza arquivo existente em uma branch, com SHA de concorrência e aprovação humana.', method: 'PUT', headers: githubHeaders, body: { branch: argument('branch'), sha: argument('sha'), message: argument('message'), content: argument('content') } }),
  template('github_get_branch', 'GitHub', 'Consultar branch', 'https://api.github.com/repos/{{arguments.owner}}/{{arguments.repo}}/branches/{{arguments.branch}}', object({ owner: githubName('Conta ou organização'), repo: githubName('Repositório'), branch: githubPath }), {
    description: 'Consulta branch existente e retorna o SHA do commit para criar uma branch de trabalho.', headers: githubHeaders, encodedPathArguments: ['arguments.branch'] }),
  template('github_create_branch', 'GitHub', 'Criar branch', 'https://api.github.com/repos/{{arguments.owner}}/{{arguments.repo}}/git/refs', object({ owner: githubName('Conta ou organização'), repo: githubName('Repositório'), branch: githubPath, sha: { ...text('SHA do commit de origem', 40), pattern: '^[A-Fa-f0-9]{40}$' } }), {
    description: 'Cria uma branch a partir de commit existente após aprovação humana, sem modificar a branch de origem.', method: 'POST', headers: githubHeaders, body: { ref: 'refs/heads/{{arguments.branch}}', sha: argument('sha') } }),
  template('github_create_pull', 'GitHub', 'Criar pull request', 'https://api.github.com/repos/{{arguments.owner}}/{{arguments.repo}}/pulls', object({ owner: githubName('Conta ou organização'), repo: githubName('Repositório'), title: text('Título'), head: text('Branch de origem', 255), base: text('Branch de destino', 255), body: text('Descrição', 10000) }), {
    description: 'Cria pull request entre branches existentes após aprovação humana.', method: 'POST', headers: githubHeaders, body: { title: argument('title'), head: argument('head'), base: argument('base'), body: argument('body') } }),
  template('notion_search', 'Notion', 'Buscar páginas', 'https://api.notion.com/v1/search', object({ query: text('Texto do título') }), {
    description: 'Busca páginas e fontes de dados compartilhadas com a integração Notion.', method: 'POST', headers: { 'Notion-Version': '2025-09-03' }, body: { query: argument('query'), page_size: 100 } }),
  template('notion_page', 'Notion', 'Consultar página', 'https://api.notion.com/v1/pages/{{arguments.id}}', object({ id: identifier('ID da página') }), {
    description: 'Consulta propriedades de uma página compartilhada com a integração.', headers: { 'Notion-Version': '2025-09-03' } }),
  template('notion_blocks', 'Notion', 'Ler conteúdo de página', 'https://api.notion.com/v1/blocks/{{arguments.id}}/children', object({ id: identifier('ID da página ou bloco') }), {
    description: 'Lista até 100 blocos filhos de uma página ou bloco acessível.', headers: { 'Notion-Version': '2025-09-03' }, query: { page_size: 100 } }),
  template('notion_append', 'Notion', 'Adicionar parágrafo', 'https://api.notion.com/v1/blocks/{{arguments.id}}/children', object({ id: identifier('ID da página ou bloco'), text: text('Texto do parágrafo', 2000) }), {
    description: 'Acrescenta um parágrafo ao final da página após aprovação humana.', method: 'PATCH', headers: { 'Notion-Version': '2025-09-03' }, body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: argument('text') } }] } }] } }),
  template('notion_create_page', 'Notion', 'Criar página', 'https://api.notion.com/v1/pages', object({ parentId: text('ID da página pai', 100), title: text('Título da nova página', 2000) }), {
    description: 'Cria página sob uma página pai compartilhada com a integração após aprovação humana.', method: 'POST', headers: { 'Notion-Version': '2025-09-03' }, body: { parent: { type: 'page_id', page_id: argument('parentId') }, properties: { title: { type: 'title', title: [{ type: 'text', text: { content: argument('title') } }] } } } }),
];
