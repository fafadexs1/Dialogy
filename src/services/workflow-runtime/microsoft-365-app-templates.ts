import { ConnectorDefinitionSchema, type ConnectorDefinition } from './connector-contract';

type Template = { id: string; service: string; label: string; definition: ConnectorDefinition };
const identifier = { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9_!{}-]+$' };
const address = { type: 'string', minLength: 1, maxLength: 100, pattern: String.raw`^\$?[A-Za-z]{1,3}\$?[1-9][0-9]{0,6}(?::\$?[A-Za-z]{1,3}\$?[1-9][0-9]{0,6})?$` };
const input = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arg = (name: string) => `{{arguments.${name}}}`;
const fileReference = { type: 'object', properties: { kind: { const: 'workflow_file' }, id: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 255 }, mimeType: { type: 'string', minLength: 1, maxLength: 150 }, size: { type: 'integer', minimum: 1, maximum: 1000000 } }, required: ['kind','id','name','mimeType','size'], additionalProperties: false };
function operation(id: string, service: string, label: string, url: string, properties: Record<string, unknown>, options: { description: string; method?: 'GET'|'PUT'|'PATCH'; body?: unknown; bodyType?: 'binary'; encodedPathArguments?: string[]; query?: Record<string, unknown>; responseFormat?: 'json'|'microsoft_file'; fileName?: string }): Template {
  const method=options.method || 'GET';
  const encodedPathArguments = [...['id', 'sheet'].filter(key => key in properties).map(key => `arguments.${key}`), ...(options.encodedPathArguments || [])];
  return { id, service, label, definition: ConnectorDefinitionSchema.parse({ name: `${service} · ${label}`, description: options.description, inputSchema: input(properties), outputSchema: { type: 'object' }, approval: method === 'GET' ? 'automatic' : 'required', http: { method, url, headers: {}, query: options.query || {}, bodyType: options.bodyType || (options.body ? 'json' : 'none'), body: options.body, encodedPathArguments, credentialId: '', credentialRequired: true, responseFormat: options.responseFormat || 'json', ...(options.fileName ? { fileName: options.fileName } : {}) } }) };
}
const metadataQuery = { '$select': 'id,name,size,file,webUrl,lastModifiedDateTime' };
const workbook = 'https://graph.microsoft.com/v1.0/me/drive/items/{{arguments.id}}/workbook/worksheets';
const range = `${workbook}/{{arguments.sheet}}/range(address='{{arguments.address}}')`;
const values = { type: 'array', minItems: 1, maxItems: 100, items: { type: 'array', minItems: 1, maxItems: 100, items: { anyOf: [{ type: 'string', maxLength: 5000 }, { type: 'number' }, { type: 'boolean' }] } } };
function officeFile(service: string, suffix: string): Template[] {
  const key = service.toLowerCase();
  const mime: Record<string, string> = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  const typedFile = { ...fileReference, properties: { ...fileReference.properties, mimeType: { const: mime[suffix] } } };
  return [
    operation(`${key}_metadata`, `Microsoft ${service}`, 'Consultar arquivo', 'https://graph.microsoft.com/v1.0/me/drive/items/{{arguments.id}}', { id: identifier }, { description: 'Consulta metadados de um arquivo autorizado no OneDrive.', query: metadataQuery }),
    operation(`${key}_download`, `Microsoft ${service}`, 'Baixar arquivo privado', 'https://graph.microsoft.com/v1.0/me/drive/items/{{arguments.id}}/content', { id: identifier }, { description: `Baixa arquivo ${suffix} autorizado para o armazenamento privado do workspace; use o leitor de documentos para interpretar seu conteúdo.`, responseFormat: 'microsoft_file', fileName: `documento.${suffix}` }),
    operation(`${key}_upload`, `Microsoft ${service}`, 'Enviar arquivo', 'https://graph.microsoft.com/v1.0/me/drive/root:/{{arguments.filename}}:/content', { filename: { type: 'string', minLength: 1, maxLength: 150, pattern: `^[A-Za-z0-9 _-]+\\.${suffix}$` }, file: typedFile }, { description: `Envia um arquivo privado ${suffix} para a raiz do OneDrive após aprovação. Se o nome já existir, o conteúdo será substituído.`, method: 'PUT', bodyType: 'binary', body: arg('file'), encodedPathArguments: ['arguments.filename'] }),
  ];
}
/** Graph supports Excel cell operations and OneDrive file operations; Word/PowerPoint content editing is not represented here. */
export const microsoft365AppTemplates: Template[] = [
  ...officeFile('Word', 'docx'), ...officeFile('Excel', 'xlsx'), ...officeFile('PowerPoint', 'pptx'),
  operation('excel_worksheets','Microsoft Excel','Listar abas',workbook,{id:identifier},{description:'Lista as abas de uma planilha Excel autorizada. Exige permissão delegada Files.ReadWrite.'}),
  operation('excel_read_range','Microsoft Excel','Ler intervalo',range,{id:identifier,sheet:identifier,address},{description:'Consulta valores de um intervalo A1. Exige permissão delegada Files.ReadWrite.'}),
  operation('excel_write_range','Microsoft Excel','Atualizar intervalo',range,{id:identifier,sheet:identifier,address,values},{description:'Substitui valores do intervalo após aprovação. Exige permissão delegada Files.ReadWrite.',method:'PATCH',body:{values:arg('values')}}),
];
