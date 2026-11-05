import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { NodeRuntimeInput } from '@/services/workflow-runtime/types';
const bridge=vi.hoisted(()=>({query:vi.fn(),approval:vi.fn(),accepted:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{query:bridge.query}}));
vi.mock('@/modules/nexus/services/automation-approvals',()=>({requestAutomationApproval:bridge.approval}));
vi.mock('@/modules/nexus/services/credentials',()=>({encryptPayload:(value:unknown)=>JSON.stringify(value),decryptPayload:(value:string)=>JSON.parse(value)}));
vi.mock('@/services/autopilot/runtime/provider-delivery',()=>({waitForAutomatedProviderAcceptance:bridge.accepted}));
import { sendWhatsappAgentReply } from '@/modules/nexus/services/whatsapp-agent';
let sql:PGlite;
beforeAll(async()=>{
 sql=new PGlite();bridge.query.mockImplementation(async(query,args)=>{const result=await sql.query(query,args);return {...result,rowCount:result.affectedRows ?? result.rows.length};});bridge.approval.mockResolvedValue({status:'waiting',resumeToken:'r'});
 await sql.exec(`CREATE TABLE chats(id text,workspace_id text,contact_id text);
 CREATE TABLE contacts(id text,workspace_id text,phone_number_jid text);
 CREATE TABLE messages(id text,workspace_id text,chat_id text,instance_name text,from_me boolean,type text,metadata jsonb,created_at timestamptz);
 CREATE TABLE evolution_api_instances(id text,workspace_id text,instance_name text,type text);
 CREATE TABLE nexus_automation_effects(id text,workspace_id text,arguments_hash text,encrypted_result text,PRIMARY KEY(id,workspace_id));
 INSERT INTO chats VALUES('chat','workspace-a','contact');
 INSERT INTO contacts VALUES('contact','workspace-a','5511000000000@s.whatsapp.net');
 INSERT INTO messages VALUES('source','workspace-a','chat','cloud',false,'text','{}',now());
 INSERT INTO evolution_api_instances VALUES('instance','workspace-a','cloud','wa_cloud');`);
});
afterAll(async()=>{await sql.close();});
const runtime=(workspaceId:string)=>({workflow:{workspaceId},execution:{conversationId:'chat',context:{sourceMessageId:'source',instanceName:'cloud'}},node:{id:'tool',config:{}},signal:AbortSignal.timeout(5000)}) as unknown as NodeRuntimeInput;
describe('WhatsApp account and workspace isolation',()=>{
 it('only resolves a recent customer message from the same workspace and an official connection',async()=>{
  const send=vi.fn();
  expect((await sendWhatsappAgentReply(runtime('workspace-a'),{text:'Olá'},'first',send)).status).toBe('waiting');
  await expect(sendWhatsappAgentReply(runtime('workspace-b'),{text:'Olá'},'other',send)).rejects.toThrow('indisponível');
  await sql.exec("UPDATE evolution_api_instances SET type='baileys'");
  await expect(sendWhatsappAgentReply(runtime('workspace-a'),{text:'Olá'},'unofficial',send)).rejects.toThrow('indisponível');
  await sql.exec("UPDATE evolution_api_instances SET type='wa_cloud'; UPDATE messages SET created_at=now()-interval '25 hours'");
  await expect(sendWhatsappAgentReply(runtime('workspace-a'),{text:'Olá'},'expired',send)).rejects.toThrow('24 horas');
  expect(send).not.toHaveBeenCalled();
 });
 it('persists a completed send and never repeats it for the same approved operation',async()=>{
  await sql.exec("UPDATE messages SET created_at=now(); UPDATE evolution_api_instances SET type='wa_cloud'");
  bridge.approval.mockResolvedValue(null);
  const send=vi.fn().mockResolvedValue({success:true,providerAccepted:true});
  expect((await sendWhatsappAgentReply(runtime('workspace-a'),{text:'Olá'},'same',send)).status).toBe('success');
  expect((await sendWhatsappAgentReply(runtime('workspace-a'),{text:'Olá'},'same',send)).status).toBe('success');
  expect(send).toHaveBeenCalledOnce();
  await expect(sendWhatsappAgentReply(runtime('workspace-a'),{text:'Mudou'},'same',send)).rejects.toThrow('incerto');
  expect(send).toHaveBeenCalledOnce();
 });
 it('does not automatically replay an uncertain provider outcome',async()=>{
  bridge.approval.mockResolvedValue(null);bridge.accepted.mockRejectedValueOnce(new Error('resultado desconhecido'));
  const send=vi.fn().mockResolvedValue({success:true,providerAccepted:false,message:{id:'message'}});
  await expect(sendWhatsappAgentReply(runtime('workspace-a'),{text:'Olá'},'uncertain',send)).rejects.toThrow('desconhecido');
  await expect(sendWhatsappAgentReply(runtime('workspace-a'),{text:'Olá'},'uncertain',send)).rejects.toThrow('incerto');
  expect(send).toHaveBeenCalledOnce();
 });
});
