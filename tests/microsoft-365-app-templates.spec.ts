import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSchema } from 'genkit/schema';
import { ConnectorDefinitionSchema } from '@/services/workflow-runtime/connector-contract';
import { microsoft365AppTemplates } from '@/services/workflow-runtime/microsoft-365-app-templates';
const mocks=vi.hoisted(()=>({request:vi.fn(),credential:vi.fn(),load:vi.fn(),save:vi.fn()}));
vi.mock('@/modules/nexus/services/public-http',()=>({requestPublicHttps:mocks.request}));
vi.mock('@/modules/nexus/services/credentials',()=>({loadNexusCredentialPayload:mocks.credential}));
vi.mock('@/modules/nexus/services/workflow-files',()=>({loadWorkflowFile:mocks.load,saveWorkflowFile:mocks.save}));
vi.mock('@/modules/nexus/services/toolbox-policy',()=>({assertAutomationToolboxEnabled:vi.fn()}));
import { executeNexusHttpOperation } from '@/modules/nexus/services/http-executor';
const file={kind:'workflow_file',id:'123e4567-e89b-42d3-a456-426614174000',name:'source.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:4};
beforeEach(()=>{vi.resetAllMocks();mocks.credential.mockResolvedValue({type:'bearer',payload:{token:'secret'}});mocks.request.mockResolvedValue({status:200,headers:{'content-type':'application/json'},body:Buffer.from('{}')});mocks.load.mockResolvedValue({file,data:Buffer.from('data')});});
describe('Microsoft 365 application operations',()=>{
 it('reads an Excel range with encoded identifiers and a fixed Graph origin',async()=>{
  const t=microsoft365AppTemplates.find(x=>x.id==='excel_read_range')!,args={id:'ABC!123',sheet:'{00000000-0001-0000-0000-000000000000}',address:'$A$1:B2'};
  expect(validateSchema(args,{jsonSchema:t.definition.inputSchema}).valid).toBe(true);
  await executeNexusHttpOperation({workspaceId:'ws',config:{...t.definition.http,credentialId:'id'},runtimeSource:{arguments:args},signal:AbortSignal.timeout(5000)});
  const request=mocks.request.mock.calls[0][0];expect(new URL(request.url).origin).toBe('https://graph.microsoft.com');expect(request.url).toContain('%7B00000000-0001-0000-0000-000000000000%7D');expect(request.url).toContain("range(address='$A$1:B2')");expect(request.headers.Authorization).toBe('Bearer secret');
 });
 it('requires approval for Excel edits and blocks unsafe address injection',async()=>{
  const t=microsoft365AppTemplates.find(x=>x.id==='excel_write_range')!,args={id:'abc',sheet:'Sheet1',address:'A1:B2',values:[['Nome',42],['Ana',true]]};
  expect(t.definition.approval).toBe('required');expect(ConnectorDefinitionSchema.safeParse({...t.definition,approval:'automatic'}).success).toBe(false);
  expect(validateSchema({...args,address:"A1')/other"},{jsonSchema:t.definition.inputSchema}).valid).toBe(false);
  await executeNexusHttpOperation({workspaceId:'ws',config:{...t.definition.http,credentialId:'id'},runtimeSource:{arguments:args},signal:AbortSignal.timeout(5000)});
  expect(JSON.parse(mocks.request.mock.calls[0][0].body)).toEqual({values:args.values});
 });
 it('uploads a private Word file to an encoded path only with approval',async()=>{
  const t=microsoft365AppTemplates.find(x=>x.id==='word_upload')!,args={filename:'Proposta nova.docx',file};
  expect(t.definition.approval).toBe('required');expect(ConnectorDefinitionSchema.safeParse({...t.definition,approval:'automatic'}).success).toBe(false);
  expect(validateSchema(args,{jsonSchema:t.definition.inputSchema}).valid).toBe(true);
  expect(validateSchema({...args,filename:'../other.docx'},{jsonSchema:t.definition.inputSchema}).valid).toBe(false);
  await executeNexusHttpOperation({workspaceId:'ws',config:{...t.definition.http,credentialId:'id'},runtimeSource:{arguments:args},signal:AbortSignal.timeout(5000)});
  expect(mocks.request.mock.calls[0][0].url).toContain('/root:/Proposta%20nova.docx:/content');expect(mocks.request.mock.calls[0][0].body).toEqual(Buffer.from('data'));
 });
 it('downloads a private file after one Graph redirect without forwarding the credential or revealing the signed URL',async()=>{
  const t=microsoft365AppTemplates.find(x=>x.id==='word_download')!;
  mocks.request.mockReset().mockResolvedValueOnce({status:302,headers:{location:'https://download.example/file?signature=secret-url'},body:Buffer.alloc(0)}).mockResolvedValueOnce({status:200,headers:{'set-cookie':'private'},body:Buffer.from('docx')});
  mocks.save.mockResolvedValue(file);
  const result=await executeNexusHttpOperation({workspaceId:'ws',config:{...t.definition.http,credentialId:'id'},runtimeSource:{arguments:{id:'ABC!123'}},signal:AbortSignal.timeout(5000)});
  expect(mocks.request.mock.calls[0][0].headers.Authorization).toBe('Bearer secret');
  expect(mocks.request.mock.calls[1][0].headers).toEqual({Accept:'application/octet-stream'});
  expect(mocks.request.mock.calls[1][0].allowRedirectResponse).toBeUndefined();
  expect(mocks.request.mock.calls[1][0].maxResponseBytes).toBe(5000000);
  expect(result).toEqual({status:200,headers:{},data:file,selected:file});
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({workspaceId:'ws',name:'documento.docx',mimeType:file.mimeType,data:Buffer.from('docx')}));
 });
 it('hides the signed URL when the destination is blocked and rejects arbitrary download endpoints',async()=>{
  const t=microsoft365AppTemplates.find(x=>x.id==='word_download')!;
  mocks.request.mockReset().mockResolvedValueOnce({status:302,headers:{location:'https://127.0.0.1/?signature=secret-url'},body:Buffer.alloc(0)}).mockRejectedValueOnce(new Error('private https://127.0.0.1/?signature=secret-url'));
  await expect(executeNexusHttpOperation({workspaceId:'ws',config:{...t.definition.http,credentialId:'id'},runtimeSource:{arguments:{id:'abc'}},signal:AbortSignal.timeout(5000)})).rejects.toThrow('de forma segura');
  expect(mocks.save).not.toHaveBeenCalled();
  expect(ConnectorDefinitionSchema.safeParse({...t.definition,http:{...t.definition.http,url:'https://attacker.example/file'}}).success).toBe(false);
 });
});
