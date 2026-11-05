import {beforeEach,describe,expect,it,vi} from 'vitest';
import {validateSchema} from 'genkit/schema';
import {ConnectorDefinitionSchema} from '@/services/workflow-runtime/connector-contract';
import {additionalAppConnectorTemplates} from '@/services/workflow-runtime/app-connector-extensions';
const mocks=vi.hoisted(()=>({request:vi.fn(),credential:vi.fn(),oauth:vi.fn()}));
vi.mock('@/modules/nexus/services/public-http',()=>({requestPublicHttps:mocks.request}));
vi.mock('@/modules/nexus/services/credentials',()=>({loadNexusCredentialPayload:mocks.credential}));
vi.mock('@/modules/nexus/services/oauth-credentials',()=>({resolveNexusOAuthToken:mocks.oauth}));
vi.mock('@/modules/nexus/services/workflow-files',()=>({saveWorkflowFile:vi.fn(),loadWorkflowFile:vi.fn()}));
import {executeNexusHttpOperation} from '@/modules/nexus/services/http-executor';
const member={'@odata.type':'#microsoft.graph.aadUserConversationMember',roles:['owner'],'user@odata.bind':"https://graph.microsoft.com/v1.0/users('id')"};
const values:Record<string,Record<string,unknown>>={slack_channels:{},slack_send:{channel:'C1',text:'hello'},outlook_list:{},outlook_send:{recipient:'x@example.com',subject:'Hi',text:'hello'},onedrive_list:{},onedrive_folder:{name:'folder'},teams_list:{},teams_chat:{members:[member,member]},trello_boards:{},trello_card:{idList:'abc',name:'card'},asana_user:{},asana_task:{workspace:'12',name:'task'},gitlab_projects:{},gitlab_project:{name:'project'},linear_teams:{},linear_issue:{teamId:'abc',title:'issue'},jira_user:{},jira_issue:{projectKey:'PROJ',issueType:'Task',summary:'test'}};
beforeEach(()=>{vi.resetAllMocks();mocks.credential.mockResolvedValue({type:'bearer',payload:{token:'secret'}});mocks.request.mockResolvedValue({status:200,headers:{'content-type':'application/json'},body:Buffer.from('{"ok":true,"data":{"issueCreate":{"success":true}}}')});});
describe('additional app connector contracts',()=>{
 it.each(additionalAppConnectorTemplates.map(t=>[t.id,t] as const))('%s materializes a fixed-origin authenticated request',async(id,template)=>{
  const args=values[id];expect(args).toBeDefined();expect(validateSchema(args,{jsonSchema:template.definition.inputSchema}).valid).toBe(true);
  const response=await executeNexusHttpOperation({workspaceId:'ws',config:{...template.definition.http,credentialId:'credential'},runtimeSource:{arguments:args},signal:AbortSignal.timeout(5000)});
  expect(response.status).toBe(200);const req=mocks.request.mock.calls[0][0];expect(new URL(req.url).origin).toBe(new URL(template.definition.http.url).origin);expect(req.headers.Authorization).toBe('Bearer secret');expect(req.body || '').not.toContain('{{arguments.');
  if(template.definition.http.method==='POST'){expect(template.definition.approval).toBe('required');expect(ConnectorDefinitionSchema.safeParse({...template.definition,approval:'automatic'}).success).toBe(false);}
 });
 it('detects Slack and Linear errors returned with HTTP 200',()=>{
  const slack=additionalAppConnectorTemplates.find(x=>x.id==='slack_send')!,linear=additionalAppConnectorTemplates.find(x=>x.id==='linear_issue')!;
  expect(validateSchema({data:{ok:false,error:'not_allowed'}},{jsonSchema:slack.definition.outputSchema}).valid).toBe(false);
  expect(validateSchema({data:{data:{issueCreate:{success:false}}}},{jsonSchema:linear.definition.outputSchema}).valid).toBe(false);
  expect(validateSchema({data:{errors:[{message:'denied'}]}},{jsonSchema:linear.definition.outputSchema}).valid).toBe(false);
 });
 it('uses the protected Trello Authorization header without putting tokens in the URL',async()=>{
  mocks.credential.mockResolvedValue({type:'api_key',payload:{name:'Authorization',value:'OAuth oauth_consumer_key=\"key\", oauth_token=\"token\"'}});
  const t=additionalAppConnectorTemplates.find(x=>x.id==='trello_card')!;
  await executeNexusHttpOperation({workspaceId:'ws',config:{...t.definition.http,credentialId:'credential'},runtimeSource:{arguments:values.trello_card},signal:AbortSignal.timeout(5000)});
  const req=mocks.request.mock.calls[0][0];expect(req.headers.Authorization).toBe('OAuth oauth_consumer_key=\"key\", oauth_token=\"token\"');expect(req.url).not.toMatch(/key|token/);
 });
 it('supports an empty 202 response from Outlook sendMail',async()=>{
  mocks.request.mockResolvedValue({status:202,headers:{},body:Buffer.from('')});const t=additionalAppConnectorTemplates.find(x=>x.id==='outlook_send')!;
  expect(await executeNexusHttpOperation({workspaceId:'ws',config:{...t.definition.http,credentialId:'credential'},runtimeSource:{arguments:values.outlook_send},signal:AbortSignal.timeout(5000)})).toMatchObject({status:202});
 });
});
