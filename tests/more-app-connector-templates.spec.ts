import {beforeEach,describe,expect,it,vi} from 'vitest';
import {validateSchema} from 'genkit/schema';
import {ConnectorDefinitionSchema} from '@/services/workflow-runtime/connector-contract';
import {moreAppConnectorTemplates} from '@/services/workflow-runtime/more-app-connector-templates';
const mocks=vi.hoisted(()=>({request:vi.fn(),credential:vi.fn(),oauth:vi.fn()}));
vi.mock('@/modules/nexus/services/public-http',()=>({requestPublicHttps:mocks.request}));
vi.mock('@/modules/nexus/services/credentials',()=>({loadNexusCredentialPayload:mocks.credential}));
vi.mock('@/modules/nexus/services/oauth-credentials',()=>({resolveNexusOAuthToken:mocks.oauth}));
vi.mock('@/modules/nexus/services/workflow-files',()=>({saveWorkflowFile:vi.fn(),loadWorkflowFile:vi.fn()}));
import {executeNexusHttpOperation} from '@/modules/nexus/services/http-executor';
const values:Record<string,Record<string,unknown>>={meta_ads_insights:{accountId:'123'},tasks_list:{},tasks_create:{title:'Comprar'},todoist_list:{},todoist_create:{content:'Comprar'},clickup_teams:{},clickup_task:{listId:'123',name:'task'},discord_user:{},discord_send:{channelId:'123',content:'Olá'},dropbox_list:{},dropbox_folder:{path:'/folder'},box_list:{},box_folder:{name:'folder'},hubspot_list:{},hubspot_contact:{email:'a@example.com',firstname:'Ana'},salesforce_account_metadata:{},salesforce_account:{name:'Empresa'},pipedrive_people:{},pipedrive_person:{name:'Ana'},shopify_products:{},shopify_product:{title:'Produto'},woo_products:{},woo_product:{name:'Produto'},nuvem_products:{storeId:'123'},nuvem_product:{storeId:'123',name:'Produto'},n8n_workflows:{},make_scenarios:{teamId:'123'},make_run:{scenarioId:'123'},vercel_projects:{},vercel_create:{name:'novo-projeto'},analytics_report:{propertyId:'123',startDate:'2026-01-01',endDate:'2026-01-31'}};
beforeEach(()=>{vi.resetAllMocks();mocks.credential.mockResolvedValue({type:'bearer',payload:{token:'token'}});mocks.request.mockResolvedValue({status:200,headers:{'content-type':'application/json'},body:Buffer.from('{}')});});
describe('expanded app catalog',()=>{
 it.each(moreAppConnectorTemplates.map(t=>[t.id,t] as const))('%s maps typed inputs and retains the declared origin',async(id,t)=>{
  const args=values[id];expect(args).toBeDefined();expect(validateSchema(args,{jsonSchema:t.definition.inputSchema}).valid).toBe(true);
  await executeNexusHttpOperation({workspaceId:'ws',config:{...t.definition.http,credentialId:'credential'},runtimeSource:{arguments:args},signal:AbortSignal.timeout(5000)});
  const req=mocks.request.mock.calls[0][0];expect(new URL(req.url).origin).toBe(new URL(t.definition.http.url).origin);expect(req.url).not.toContain('%7B');expect(req.body||'').not.toContain('{{arguments.');
  if(t.definition.http.method==='POST' && !['dropbox_list','analytics_report','shopify_products'].includes(id)){expect(t.definition.approval).toBe('required');for(const method of ['POST','PUT','PATCH']) expect(ConnectorDefinitionSchema.safeParse({...t.definition,approval:'automatic',http:{...t.definition.http,method}}).success).toBe(false);}
 });
 it('uses the Shopify access token header from the protected credential',async()=>{
  mocks.credential.mockResolvedValue({type:'api_key',payload:{name:'X-Shopify-Access-Token',value:'secret',placement:'header'}});
  const template=moreAppConnectorTemplates.find(t=>t.id==='shopify_products')!.definition;
  await executeNexusHttpOperation({workspaceId:'ws',config:{...template.http,url:'https://example-shop.myshopify.com/admin/api/2026-10/graphql.json',credentialId:'credential'},runtimeSource:{arguments:{}},signal:AbortSignal.timeout(5000)});
  expect(mocks.request.mock.calls[0][0].headers['X-Shopify-Access-Token']).toBe('secret');expect(mocks.request.mock.calls[0][0].url).not.toContain('secret');
 });
 it('requires approval for Shopify GraphQL mutations and rejects a disguised mutation',()=>{
  const read=moreAppConnectorTemplates.find(t=>t.id==='shopify_products')!.definition;
  expect(ConnectorDefinitionSchema.safeParse({...read,http:{...read.http,body:{query:'mutation { productCreate { product { id } } }'}}}).success).toBe(false);
  const write=moreAppConnectorTemplates.find(t=>t.id==='shopify_product')!.definition;
  expect(ConnectorDefinitionSchema.safeParse({...write,approval:'automatic'}).success).toBe(false);
  expect(validateSchema({data:{errors:[{message:'denied'}]}},{jsonSchema:read.outputSchema}).valid).toBe(false);
  expect(validateSchema({data:{data:{productCreate:{product:null,userErrors:[{message:'invalid'}]}}}},{jsonSchema:write.outputSchema}).valid).toBe(false);
 });
 it('rejects unsafe interpolated path segments before execution',()=>{
  for(const id of ['clickup_task','discord_send','nuvem_products','analytics_report','meta_ads_insights']){const t=moreAppConnectorTemplates.find(item=>item.id===id)!;const key=Object.keys(values[id])[0];expect(validateSchema({...values[id],[key]:'../attacker?x'},{jsonSchema:t.definition.inputSchema}).valid).toBe(false);}
 });
 it('uses current HubSpot and Nuvemshop contracts and preserves approval for both new and legacy versions',async()=>{
  const hub=moreAppConnectorTemplates.find(t=>t.id==='hubspot_contact')!.definition;
  const nuvem=moreAppConnectorTemplates.find(t=>t.id==='nuvem_product')!.definition;
  expect(hub.http.url).toContain('/2026-09/contacts');expect(nuvem.http.url).toContain('/2025-03/');
  await executeNexusHttpOperation({workspaceId:'ws',config:{...nuvem.http,credentialId:'credential'},runtimeSource:{arguments:values.nuvem_product},signal:AbortSignal.timeout(5000)});
  expect(JSON.parse(mocks.request.mock.calls[0][0].body)).toEqual({name:{pt:'Produto'},visibility:'hidden'});
  for(const definition of [hub,nuvem,{...hub,http:{...hub.http,url:hub.http.url.replace('2026-09','2026-03')}},{...nuvem,http:{...nuvem.http,url:nuvem.http.url.replace('2025-03','v1')}}]) expect(ConnectorDefinitionSchema.safeParse({...definition,approval:'automatic'}).success).toBe(false);
 });
 it('requires approval for any DELETE, while preserving read-only POSTs',()=>{
  const base=moreAppConnectorTemplates[0].definition;expect(ConnectorDefinitionSchema.safeParse({...base,approval:'automatic',http:{...base.http,method:'DELETE',url:'https://example.com/delete'}}).success).toBe(false);
  for(const id of ['dropbox_list','analytics_report','shopify_products']) expect(moreAppConnectorTemplates.find(t=>t.id===id)!.definition.approval).toBe('automatic');
 });
});
