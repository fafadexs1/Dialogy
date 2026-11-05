import { z } from 'zod';

/** Only this fixed GraphQL query may use Shopify without an approval. */
export const SHOPIFY_LIST_QUERY = 'query DialogyProducts { products(first: 50) { nodes { id title status } pageInfo { hasNextPage endCursor } } }';
/** These first-party operations have externally visible effects and always need approval. */
export function requiresAppWriteApproval(method: string, endpoint: string, body?: unknown): boolean {
  if (method === 'DELETE') return true;
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return false;
  try {
    const url = new URL(endpoint);
    if (url.origin === 'https://graph.microsoft.com' && (/^\/v1\.0\/me\/drive\/items\/[^/]+\/workbook\/worksheets\//.test(url.pathname) || /^\/v1\.0\/me\/drive\/root:\/[^/]+:\/content$/.test(url.pathname) || /^\/v1\.0\/me\/drive\/items\/[^/]+\/content$/.test(url.pathname))) return true;
    if (['https://docs.googleapis.com', 'https://sheets.googleapis.com', 'https://slides.googleapis.com'].includes(url.origin)) return true;
    if (url.hostname.endsWith('.myshopify.com') && /^\/admin\/api\/[^/]+\/graphql\.json$/.test(url.pathname)) {
      return method !== 'POST' || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || (body as {query?:unknown}).query !== SHOPIFY_LIST_QUERY;
    }
    if (url.origin === 'https://www.googleapis.com' && /^\/calendar\/v3\/calendars\/primary\/events\//.test(url.pathname) && ['PATCH', 'PUT'].includes(method)) return true;
    if (['https://api.stripe.com', 'https://api.mercadopago.com', 'https://api.asaas.com', 'https://api-sandbox.asaas.com'].includes(url.origin)) return true;
    if (url.origin === 'https://api.github.com' && method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/git\/refs$/.test(url.pathname)) return true;
    if (url.origin === 'https://api.github.com' && ((method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/(issues|pulls)$/.test(url.pathname)) || (method === 'PUT' && /^\/repos\/[^/]+\/[^/]+\/contents\//.test(url.pathname)))) return true;
    if ((url.origin === 'https://tasks.googleapis.com' && url.pathname === '/tasks/v1/lists/@default/tasks') ||
      (url.origin === 'https://api.todoist.com' && url.pathname === '/api/v1/tasks') ||
      (url.origin === 'https://api.clickup.com' && /^\/api\/v2\/list\/[^/]+\/task$/.test(url.pathname)) ||
      (url.origin === 'https://discord.com' && /^\/api\/v10\/channels\/[^/]+\/messages$/.test(url.pathname)) ||
      (url.origin === 'https://api.dropboxapi.com' && url.pathname === '/2/files/create_folder_v2') ||
      (url.origin === 'https://api.box.com' && url.pathname === '/2.0/folders') ||
      (url.origin === 'https://api.hubapi.com' && /^\/crm\/objects\/(?:2026-03|2026-09)\/contacts$/.test(url.pathname)) ||
      (url.origin === 'https://api.pipedrive.com' && url.pathname === '/api/v2/persons') ||
      (url.origin === 'https://api.notion.com' && /^\/v1\/blocks\/[^/]+\/children$/.test(url.pathname)) ||
      (['api.tiendanube.com','api.nuvemshop.com.br'].includes(url.hostname) && /^\/(?:v1|2025-03)\/[^/]+\/products$/.test(url.pathname)) ||
      ((url.hostname.endsWith('.make.com') || url.hostname.endsWith('.make.celonis.com')) && /^\/api\/v2\/scenarios\/[^/]+\/run$/.test(url.pathname)) ||
      (url.origin === 'https://api.vercel.com' && url.pathname === '/v9/projects') ||
      (/\/wp-json\/wc\/v3\/products$/.test(url.pathname)) ||
      (/^\/admin\/api\/[^/]+\/products\.json$/.test(url.pathname)) ||
      (/^\/services\/data\/v[0-9.]+\/sobjects\/Account$/.test(url.pathname))) return true;
    if ((url.origin === 'https://slack.com' && url.pathname === '/api/chat.postMessage') ||
      (url.origin === 'https://graph.microsoft.com' && ['/v1.0/me/sendMail','/v1.0/me/drive/root/children','/v1.0/chats'].includes(url.pathname)) ||
      (url.origin === 'https://api.trello.com' && url.pathname === '/1/cards') ||
      (url.origin === 'https://app.asana.com' && url.pathname === '/api/1.0/tasks') ||
      (url.origin === 'https://gitlab.com' && url.pathname === '/api/v4/projects') ||
      (url.origin === 'https://api.linear.app' && url.pathname === '/graphql') ||
      (url.hostname.endsWith('.atlassian.net') && url.pathname === '/rest/api/3/issue')) return true;
    return new Set([
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      'https://www.googleapis.com/drive/v3/files',
      'https://api.github.com/user/repos',
      'https://api.notion.com/v1/pages',
    ]).has(`${url.origin}${url.pathname}`);
  } catch { return false; }
}

export const ConnectorDefinitionSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).default(''),
  inputSchema: z.record(z.unknown()).default({ type: 'object', properties: {} }),
  outputSchema: z.record(z.unknown()).default({ type: 'object' }),
  approval: z.enum(['automatic', 'required']).default('required'),
  http: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']),
    url: z.string().max(8192).refine(value => {
      try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !/[{}]/.test(url.origin); } catch { return false; }
    }, 'Use uma origem HTTPS fixa.'),
    headers: z.record(z.unknown()).default({}), query: z.record(z.unknown()).default({}),
    encodedPathArguments: z.array(z.string().regex(/^arguments\.[A-Za-z][A-Za-z0-9_]*$/)).max(20).default([]),
    bodyType: z.enum(['none', 'json', 'raw', 'text', 'form-data', 'binary', 'urlencoded']).default('none'), body: z.unknown().optional(),
    bodyTransform: z.enum(['gmail_reply']).optional(),
    credentialId: z.string().default(''), credentialRequired: z.boolean().default(false),
    responseFormat: z.enum(['auto', 'json', 'text', 'file', 'microsoft_file']).default('auto'), fileName: z.string().max(255).optional(),
    responsePath: z.string().max(500).optional(), pagination: z.record(z.unknown()).optional(),
  }),
}).superRefine((value, ctx) => {
  if (value.http.responseFormat === 'microsoft_file' && (value.http.method !== 'GET' || value.http.url !== 'https://graph.microsoft.com/v1.0/me/drive/items/{{arguments.id}}/content' || !value.http.credentialRequired || Object.keys(value.http.headers).length > 0 || Object.keys(value.http.query).length > 0 || value.http.pagination || value.http.responsePath || !/\.(docx|xlsx|pptx)$/.test(value.http.fileName || ''))) ctx.addIssue({ code: 'custom', path: ['http','responseFormat'], message: 'O download Microsoft exige o endpoint e a configuração segura do arquivo.' });
  if (value.http.bodyTransform === 'gmail_reply' && (value.http.method !== 'POST' || value.http.url !== 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send' || value.approval !== 'required')) ctx.addIssue({ code:'custom', path:['http','bodyTransform'], message:'Respostas Gmail exigem aprovação e endpoint fixo.' });
  if (value.approval !== 'required' && requiresAppWriteApproval(value.http.method, value.http.url, value.http.body)) ctx.addIssue({ code: 'custom', path: ['approval'], message: 'Esta ação externa exige aprovação humana.' });
  if (Object.keys(value.http.headers).some(key => /authorization|cookie|api.?key|token|secret/i.test(key))) ctx.addIssue({ code: 'custom', path: ['http', 'headers'], message: 'Guarde autenticação em uma credencial protegida.' });
});
export type ConnectorDefinition = z.infer<typeof ConnectorDefinitionSchema>;
