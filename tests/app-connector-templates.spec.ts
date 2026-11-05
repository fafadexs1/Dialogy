import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSchema } from 'genkit/schema';
import { ConnectorDefinitionSchema } from '@/services/workflow-runtime/connector-contract';
import { appConnectorTemplates } from '@/services/workflow-runtime/app-connector-templates';
const mocks = vi.hoisted(() => ({ request: vi.fn(), credential: vi.fn(), oauth: vi.fn() }));
vi.mock('@/modules/nexus/services/public-http', () => ({ requestPublicHttps: mocks.request }));
vi.mock('@/modules/nexus/services/credentials', () => ({ loadNexusCredentialPayload: mocks.credential }));
vi.mock('@/modules/nexus/services/oauth-credentials', () => ({ resolveNexusOAuthToken: mocks.oauth }));
vi.mock('@/modules/nexus/services/workflow-files', () => ({ saveWorkflowFile: vi.fn(), loadWorkflowFile: vi.fn() }));
import { buildGmailReply } from '@/modules/nexus/services/gmail-reply';
import { executeNexusHttpOperation } from '@/modules/nexus/services/http-executor';
const values: Record<string, Record<string, unknown>> = {
 docs_read:{id:'document_123'}, docs_create:{title:'Documento'}, docs_append:{id:'document_123',text:'Olá'}, sheets_create:{title:'Planilha'}, sheets_read:{id:'sheet_123',range:'Sheet1!A1:B2'}, sheets_write:{id:'sheet_123',range:'Sheet1!A1:B2',values:[['Nome',42],['Ana',true]]}, slides_read:{id:'slides_123'}, slides_create:{title:'Apresentação'}, slides_add_slide:{id:'slides_123',slideId:'slide_1'}, slides_add_text:{id:'slides_123',slideId:'slide_1',shapeId:'shape_1',text:'Olá'},
 calendar_list: {timeMin:'2026-11-04T00:00:00Z',timeMax:'2026-11-05T00:00:00Z'}, calendar_freebusy:{timeMin:'2026-11-04T00:00:00Z',timeMax:'2026-11-05T00:00:00Z'}, calendar_create:{summary:'Reunião',start:'2026-11-04T12:00:00Z',end:'2026-11-04T13:00:00Z'}, calendar_reschedule:{id:'event_123',start:'2026-11-04T12:00:00Z',end:'2026-11-04T13:00:00Z'}, calendar_delete:{id:'event_123'},
 calendar_reminder:{summary:'Reunião',start:'2026-11-04T12:00:00Z',end:'2026-11-04T13:00:00Z',reminderMethod:'email',reminderMinutes:15},
 gmail_search:{q:'from:teste@example.com newer_than:7d'}, gmail_get:{id:'18f123456789abcd'}, gmail_send:{raw:'SGVsbG8'}, gmail_reply:{to:'ana@example.com',subject:'Reunião',inReplyTo:'<abc@example.com>',threadId:'thread_123',text:'Olá'}, drive_search:{q:'trashed = false'}, drive_export_text:{id:'abc_123'}, drive_export_csv:{id:'abc_123'}, drive_download:{id:'abc_123'}, drive_create_folder:{name:'Projetos'},
 github_get_branch:{owner:'org',repo:'repo',branch:'feature/exemplo'}, github_create_branch:{owner:'org',repo:'repo',branch:'feature/exemplo',sha:'a'.repeat(40)}, github_repos:{}, github_create_repo:{name:'repositorio'}, github_issues:{owner:'org',repo:'repo'}, github_create_issue:{owner:'org',repo:'repo',title:'Problema',body:'Descrição'}, github_pull_requests:{owner:'org',repo:'repo'}, github_create_pull:{owner:'org',repo:'repo',title:'Melhoria',head:'feature',base:'main',body:'Descrição'}, github_read_file:{owner:'org',repo:'repo',path:'src/app.ts',ref:'main'}, github_update_file:{owner:'org',repo:'repo',path:'src/app.ts',branch:'feature',sha:'a'.repeat(40),message:'Corrige',content:'aGVsbG8='}, notion_search:{query:'Projeto'}, notion_page:{id:'abc_123'}, notion_blocks:{id:'abc_123'}, notion_append:{id:'abc_123',text:'Um parágrafo'}, notion_create_page:{parentId:'abc',title:'Nova página'},
};
beforeEach(() => { vi.resetAllMocks(); mocks.credential.mockResolvedValue({ type: 'oauth2', payload: {} }); mocks.oauth.mockResolvedValue('token'); mocks.request.mockResolvedValue({ status: 200, headers: { 'content-type':'application/json' }, body: Buffer.from('{}') }); });
describe('ready application connector operations', () => {
 it.each(appConnectorTemplates.map(t => [t.id, t] as const))('%s sends a bounded credentialed request to its fixed API origin', async (id, template) => {
   const args = values[id]; expect(validateSchema(args,{jsonSchema:template.definition.inputSchema}).valid).toBe(true);
   const bodyConfig = template.definition.http.bodyTransform === 'gmail_reply' ? { bodyType:'json', body:buildGmailReply(args) } : {};
   const result = await executeNexusHttpOperation({ workspaceId:'workspace', config:{ ...template.definition.http, ...bodyConfig, credentialId:'credential' }, runtimeSource:{ arguments: args }, signal:AbortSignal.timeout(5000) });
   expect(result.status).toBe(200); const req = mocks.request.mock.calls[0][0];
   expect(new URL(req.url).origin).toBe(new URL(template.definition.http.url).origin);
   expect(mocks.oauth).toHaveBeenCalledWith('workspace','credential',new URL(req.url).origin,expect.any(AbortSignal));
   expect(req.headers.Authorization).toBe('Bearer token');
   expect(req.method).toBe(template.definition.http.method);
   expect(req.body || '').not.toContain('{{arguments.');
 });
 it('requires approval for every preset that changes external state', () => {
   for (const t of appConnectorTemplates.filter(t => t.definition.http.method !== 'GET' && !['notion_search', 'calendar_freebusy'].includes(t.id))) { expect(t.definition.approval).toBe('required'); expect(ConnectorDefinitionSchema.safeParse({ ...t.definition, approval: 'automatic' }).success).toBe(false); }
 });
 it('allows the read-only free/busy query with a read-only Calendar credential', async () => {
   mocks.credential.mockResolvedValueOnce({ type: 'oauth2', payload: {}, metadata: { provider: 'google_workspace', app: 'calendar', access: 'read' } });
   const template = appConnectorTemplates.find(item => item.id === 'calendar_freebusy')!;
   await executeNexusHttpOperation({ workspaceId:'workspace', config:{...template.definition.http,credentialId:'credential'}, runtimeSource:{arguments:values.calendar_freebusy}, signal:AbortSignal.timeout(5000) });
   expect(JSON.parse(mocks.request.mock.calls[0][0].body)).toMatchObject({ items: [{ id: 'primary' }] });
 });
 it('keeps office mutations behind approval and materializes complete bounded bodies', async () => {
   for(const id of ['docs_append','sheets_write','slides_add_text']) {
     const t=appConnectorTemplates.find(item=>item.id===id)!;
     expect(t.definition.approval).toBe('required');
     await executeNexusHttpOperation({workspaceId:'workspace',config:{...t.definition.http,credentialId:'credential'},runtimeSource:{arguments:values[id]},signal:AbortSignal.timeout(5000)});
   }
   expect(JSON.parse(mocks.request.mock.calls[0][0].body)).toEqual({requests:[{insertText:{endOfSegmentLocation:{},text:'Olá'}}]});
   expect(JSON.parse(mocks.request.mock.calls[1][0].body)).toEqual({majorDimension:'ROWS',values:[['Nome',42],['Ana',true]]});
   expect(mocks.request.mock.calls[1][0].url).toContain('valueInputOption=RAW');
   expect(JSON.parse(mocks.request.mock.calls[2][0].body).requests[1]).toEqual({insertText:{objectId:'shape_1',text:'Olá'}});
 });
 it('rejects unsafe office identifiers and blocks read-only OAuth credentials from writes', async () => {
   const t=appConnectorTemplates.find(item=>item.id==='sheets_write')!;
   expect(validateSchema({...values.sheets_write,range:'../other'},{jsonSchema:t.definition.inputSchema}).valid).toBe(false);
   mocks.credential.mockResolvedValueOnce({type:'oauth2',payload:{},metadata:{provider:'google_workspace',app:'sheets',access:'read'}});
   await expect(executeNexusHttpOperation({workspaceId:'workspace',config:{...t.definition.http,credentialId:'credential'},runtimeSource:{arguments:values.sheets_write},signal:AbortSignal.timeout(5000)})).rejects.toThrow('apenas leitura');
   expect(mocks.request).not.toHaveBeenCalled();
 });
 it('requires explicit time zones for Calendar events', () => {
   const schema=appConnectorTemplates.find(item => item.id === 'calendar_create')!.definition.inputSchema;
   expect(validateSchema({...values.calendar_create,start:'2026-11-04T12:00:00'},{jsonSchema:schema}).valid).toBe(false);
   expect(validateSchema({...values.calendar_create,start:'2026-11-04T12:00:00-03:00'},{jsonSchema:schema}).valid).toBe(true);
 });
 it('encodes branch slashes as one path parameter and builds a new ref', async()=>{
   for(const id of ['github_get_branch','github_create_branch']) { const t=appConnectorTemplates.find(item=>item.id===id)!;await executeNexusHttpOperation({workspaceId:'workspace',config:{...t.definition.http,credentialId:'credential'},runtimeSource:{arguments:values[id]},signal:AbortSignal.timeout(5000)}); }
   expect(mocks.request.mock.calls[0][0].url).toContain('/branches/feature%2Fexemplo');
   expect(JSON.parse(mocks.request.mock.calls[1][0].body)).toEqual({ref:'refs/heads/feature/exemplo',sha:'a'.repeat(40)});
 });
 it('rejects traversal in repository file paths', () => {
   const schema=appConnectorTemplates.find(item => item.id === 'github_read_file')!.definition.inputSchema;
   expect(validateSchema({...values.github_read_file,path:'../secrets'},{jsonSchema:schema}).valid).toBe(false);
   expect(validateSchema({...values.github_read_file,path:'src/../../secrets'},{jsonSchema:schema}).valid).toBe(false);
 });
 it('maps the calendar and Notion request bodies to their public API contracts', async () => {
   for (const id of ['calendar_create','notion_create_page']) {
     const t=appConnectorTemplates.find(item => item.id === id)!;
     await executeNexusHttpOperation({ workspaceId:'workspace', config:{...t.definition.http,credentialId:'credential'}, runtimeSource:{arguments:values[id]}, signal:AbortSignal.timeout(5000) });
   }
   expect(JSON.parse(mocks.request.mock.calls[0][0].body)).toEqual({summary:'Reunião',start:{dateTime:'2026-11-04T12:00:00Z'},end:{dateTime:'2026-11-04T13:00:00Z'}});
   expect(JSON.parse(mocks.request.mock.calls[1][0].body)).toMatchObject({parent:{type:'page_id',page_id:'abc'},properties:{title:{title:[{text:{content:'Nova página'}}]}}});
 });
 it('sends explicit, bounded Calendar reminders only after confirmation is required', async () => {
   const template=appConnectorTemplates.find(item => item.id === 'calendar_reminder')!;
   expect(template.definition.approval).toBe('required');
   expect(validateSchema({...values.calendar_reminder,reminderMinutes:40321},{jsonSchema:template.definition.inputSchema}).valid).toBe(false);
   expect(validateSchema({...values.calendar_reminder,reminderMethod:'sms'},{jsonSchema:template.definition.inputSchema}).valid).toBe(false);
   await executeNexusHttpOperation({ workspaceId:'workspace', config:{...template.definition.http,credentialId:'credential'}, runtimeSource:{arguments:values.calendar_reminder}, signal:AbortSignal.timeout(5000) });
   expect(JSON.parse(mocks.request.mock.calls[0][0].body)).toMatchObject({ reminders:{ useDefault:false, overrides:[{ method:'email', minutes:15 }] } });
 });
});
