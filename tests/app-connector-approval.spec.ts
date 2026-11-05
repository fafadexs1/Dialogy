import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appConnectorTemplates } from '@/services/workflow-runtime/app-connector-templates';
const mocks=vi.hoisted(()=>({query:vi.fn(),decrypt:vi.fn(),approval:vi.fn(),http:vi.fn(),effect:vi.fn(),credential:vi.fn(),file:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{query:mocks.query}}));
vi.mock('@/modules/nexus/services/credentials',()=>({decryptPayload:mocks.decrypt,encryptPayload:vi.fn(),loadNexusCredentialPayload:mocks.credential}));
vi.mock('@/modules/nexus/services/automation-approvals',()=>({requestAutomationApproval:mocks.approval}));
vi.mock('@/modules/nexus/services/durable-effects',()=>({executeDurableEffect:mocks.effect,nodeInvocationKey:()=> 'key'}));
vi.mock('@/modules/nexus/services/http-executor',()=>({executeNexusHttpOperation:mocks.http}));
vi.mock('@/modules/nexus/services/toolbox-policy',()=>({assertAutomationToolboxEnabled:vi.fn()}));
vi.mock('@/modules/nexus/services/workflow-files',()=>({loadWorkflowFile:mocks.file}));
import { moreAppConnectorTemplates } from '@/services/workflow-runtime/more-app-connector-templates';
import { additionalAppConnectorTemplates } from '@/services/workflow-runtime/app-connector-extensions';
import { microsoft365AppTemplates } from '@/services/workflow-runtime/microsoft-365-app-templates';
import { executeConnectorStep, publishConnector } from '@/modules/nexus/services/connectors';
const t=appConnectorTemplates.find(x=>x.id==='calendar_create')!;
const node={workflow:{workspaceId:'workspace'},node:{config:{connectorId:'connector',version:1}},execution:{},signal:AbortSignal.timeout(5000)} as never;
beforeEach(()=>{vi.resetAllMocks();mocks.query.mockResolvedValue({rows:[{encrypted_definition:'encrypted'}]});mocks.decrypt.mockReturnValue(t.definition);mocks.effect.mockImplementation(async (_ws,_key,_data,fn)=>fn());});
describe('connector validation and approval',()=>{
 it('refuses to publish Jira with the example hostname',async()=>{
  mocks.decrypt.mockReturnValue(additionalAppConnectorTemplates.find(x=>x.id==='jira_issue')!.definition);
  await expect(publishConnector('workspace','connector',1)).rejects.toThrow('your-domain');
 });
 it.each(['salesforce_account','shopify_product','woo_product','n8n_workflows','nuvem_products'])('refuses to publish %s with a placeholder domain or contact', async (id)=>{
  mocks.decrypt.mockReturnValue(moreAppConnectorTemplates.find(x=>x.id===id)!.definition);
  await expect(publishConnector('workspace','connector',1)).rejects.toThrow(/domínio|contato/);
 });
 it('rejects a Shopify token configured with an incompatible authentication header',async()=>{
  const shop=moreAppConnectorTemplates.find(x=>x.id==='shopify_products')!.definition;
  mocks.decrypt.mockReturnValue({...shop,http:{...shop.http,url:'https://example-shop.myshopify.com/admin/api/2026-10/graphql.json',credentialId:'id'}});
  mocks.credential.mockResolvedValue({type:'bearer',payload:{token:'secret'},metadata:{}});
  await expect(publishConnector('workspace','connector',1)).rejects.toThrow('X-Shopify-Access-Token');
 });
 it('requires the documented CRM and Nuvemshop credential formats at publication',async()=>{
  const cases=[['hubspot_list',{type:'basic',payload:{}}],['pipedrive_people',{type:'api_key',payload:{name:'X-Other',placement:'header'}}],['nuvem_products',{type:'basic',payload:{}}]] as const;
  for(const [id,credential] of cases){
   const definition=moreAppConnectorTemplates.find(x=>x.id===id)!.definition;
   mocks.decrypt.mockReturnValue({...definition,http:{...definition.http,headers:id==='nuvem_products'?{'User-Agent':'Dialogy (support@example.com)'}:definition.http.headers,credentialId:'id'}});
   mocks.credential.mockResolvedValue(credential);
   await expect(publishConnector('workspace','connector',1)).rejects.toThrow(/Bearer|Pipedrive/);
  }
 });
 it('requires real contact information in the Nuvemshop User-Agent',async()=>{
  const definition=moreAppConnectorTemplates.find(x=>x.id==='nuvem_products')!.definition;
  mocks.decrypt.mockReturnValue({...definition,http:{...definition.http,headers:{'User-Agent':'Dialogy'},credentialId:'id'}});
  await expect(publishConnector('workspace','connector',1)).rejects.toThrow('User-Agent');
 });
 it('rejects app-only OAuth for delegated Microsoft /me operations',async()=>{
  const graph=additionalAppConnectorTemplates.find(x=>x.id==='outlook_list')!.definition;
  mocks.decrypt.mockReturnValue({...graph,http:{...graph.http,credentialId:'id'}});
  mocks.credential.mockResolvedValue({type:'oauth2',payload:{allowedOrigin:'https://graph.microsoft.com',grantType:'client_credentials'},metadata:{}});
  await expect(publishConnector('workspace','connector',1)).rejects.toThrow('delegada');
 });
 it('rejects an OAuth credential bound to another API origin at publication',async()=>{
  const graph=additionalAppConnectorTemplates.find(x=>x.id==='outlook_list')!.definition;
  mocks.decrypt.mockReturnValue({...graph,http:{...graph.http,credentialId:'id'}});
  mocks.credential.mockResolvedValue({type:'oauth2',payload:{allowedOrigin:'https://attacker.example',grantType:'refresh_token'},metadata:{}});
  await expect(publishConnector('workspace','connector',1)).rejects.toThrow('origem');
 });
 it('rejects malformed tool arguments before approval or execution',async()=>{
  await expect(executeConnectorStep(node,'key',{summary:'Reunião'})).rejects.toThrow('argumentos não atendem');
  expect(mocks.approval).not.toHaveBeenCalled();expect(mocks.http).not.toHaveBeenCalled();
 });
 it('checks that private upload metadata matches the stored file before requesting approval',async()=>{
  mocks.decrypt.mockReturnValue(microsoft365AppTemplates.find(x=>x.id==='word_upload')!.definition);
  const file={kind:'workflow_file',id:'123e4567-e89b-42d3-a456-426614174000',name:'source.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:4};
  mocks.file.mockResolvedValue({file:{...file,name:'different.docx'},data:Buffer.from('data')});
  await expect(executeConnectorStep(node,'upload',{filename:'Proposta.docx',file})).rejects.toThrow('não correspondem');
  expect(mocks.approval).not.toHaveBeenCalled();expect(mocks.http).not.toHaveBeenCalled();
  mocks.file.mockResolvedValue({file,data:Buffer.from('data')});mocks.approval.mockResolvedValue({status:'waiting',resumeToken:'resume'});
  expect((await executeConnectorStep(node,'upload',{filename:'Proposta.docx',file})).status).toBe('waiting');expect(mocks.http).not.toHaveBeenCalled();
 });
 it('sends the composed Gmail response only after the review step',async()=>{
  const reply=appConnectorTemplates.find(x=>x.id==='gmail_reply')!;
  mocks.decrypt.mockReturnValue(reply.definition);
  const args={to:'ana@example.com',subject:'Reunião',inReplyTo:'<original@example.com>',threadId:'thread_123',text:'Combinado.'};
  mocks.approval.mockResolvedValueOnce({status:'waiting',resumeToken:'resume'}).mockResolvedValueOnce(null);
  mocks.http.mockResolvedValue({status:200,data:{id:'sent'},selected:{id:'sent'}});
  expect((await executeConnectorStep(node,'reply',args)).status).toBe('waiting'); expect(mocks.http).not.toHaveBeenCalled();
  expect((await executeConnectorStep(node,'reply',args)).status).toBe('success');
  const sent=mocks.http.mock.calls[0][0].config.body; expect(sent.threadId).toBe('thread_123');
  expect(Buffer.from(sent.raw,'base64url').toString()).toContain('In-Reply-To: <original@example.com>');
 });
 it('never calls the external API while an approval is pending',async()=>{
  mocks.approval.mockResolvedValue({status:'waiting',resumeToken:'resume'});
  const result=await executeConnectorStep(node,'key',{summary:'Reunião',start:'2026-11-04T12:00:00Z',end:'2026-11-04T13:00:00Z'});
  expect(result.status).toBe('waiting');expect(mocks.http).not.toHaveBeenCalled();
 });
 it('returns decoded plain text when reading a Gmail message', async () => {
  mocks.decrypt.mockReturnValue(appConnectorTemplates.find(x=>x.id==='gmail_get')!.definition);
  mocks.http.mockResolvedValue({status:200,selected:{payload:{mimeType:'text/plain',body:{data:Buffer.from('Reunião amanhã').toString('base64url')}}}});
  const result=await executeConnectorStep(node,'key',{id:'event_123'});
  expect(result.output?.selected).toMatchObject({decodedText:'Reunião amanhã'});
 });
});
