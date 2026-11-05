import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeRuntimeInput } from '@/services/workflow-runtime/types';
const mocks=vi.hoisted(()=>({query:vi.fn(),approval:vi.fn(),effect:vi.fn(),accepted:vi.fn(),history:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{query:mocks.query}}));
vi.mock('@/modules/nexus/services/automation-approvals',()=>({requestAutomationApproval:mocks.approval}));
vi.mock('@/modules/nexus/services/durable-effects',()=>({executeDurableEffect:mocks.effect}));
vi.mock('@/services/autopilot/runtime/provider-delivery',()=>({waitForAutomatedProviderAcceptance:mocks.accepted}));
vi.mock('@/services/agent-studio/history',()=>({loadStudioConversationTurns:mocks.history}));
import { readWhatsappAgentHistory, sendWhatsappAgentReply } from '@/modules/nexus/services/whatsapp-agent';
const target={chat_id:'chat-a',contact_id:'contact-a',phone_number_jid:'5511999999999@s.whatsapp.net',instance_id:'instance-a',instance_name:'oficial'};
function runtime(workspace='ws-a'):NodeRuntimeInput {return {workflow:{workspaceId:workspace},execution:{conversationId:'chat-a',context:{sourceMessageId:'message-a',instanceName:'oficial'}},node:{id:'tool',config:{}},signal:AbortSignal.timeout(5000)} as unknown as NodeRuntimeInput;}
beforeEach(()=>{
 vi.resetAllMocks();
 mocks.query.mockImplementation(async(_sql:string,params:unknown[])=>({rows:JSON.stringify(params)===JSON.stringify(['ws-a','chat-a','message-a','oficial'])?[target]:[]}));
 mocks.approval.mockResolvedValue(null);mocks.effect.mockImplementation(async(_ws,_id,_args,fn)=>fn());mocks.accepted.mockResolvedValue(undefined);
 mocks.history.mockResolvedValue([]);
});
describe('official WhatsApp agent reply',()=>{
 it('rejects a chat from another workspace before approval and sending',async()=>{
  const send=vi.fn();await expect(sendWhatsappAgentReply(runtime('ws-b'),{text:'Olá'},'invocation',send)).rejects.toThrow('indisponível');
  expect(mocks.approval).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  expect(mocks.query.mock.calls[0][1]).toEqual(['ws-b','chat-a','message-a','oficial']);
 });
 it('reads only bounded history of the current authorized chat',async()=>{
  mocks.history.mockResolvedValue(Array.from({length:25},(_,index)=>({messageId:String(index),fromMe:false,content:'x'.repeat(2100)})));
  const history=await readWhatsappAgentHistory(runtime());
  expect(mocks.history).toHaveBeenCalledWith('ws-a','chat-a','message-a',true);
  expect(history.messages).toHaveLength(20);expect(history.messages[0].messageId).toBe('5');expect(history.messages[0].content).toHaveLength(2000);
  await expect(readWhatsappAgentHistory(runtime('ws-b'))).rejects.toThrow('indisponível');expect(mocks.history).toHaveBeenCalledOnce();
 });
 it('does not return history if the official channel is revoked during the read',async()=>{
  mocks.query.mockResolvedValueOnce({rows:[target]}).mockResolvedValueOnce({rows:[]});mocks.history.mockResolvedValue([{content:'restrito',fromMe:false}]);
  await expect(readWhatsappAgentHistory(runtime())).rejects.toThrow('indisponível');
 });
 it('requires explicit human approval of the precise recipient, channel and text before sending',async()=>{
  const send=vi.fn().mockResolvedValue({success:true,providerAccepted:true});
  mocks.approval.mockResolvedValueOnce({status:'waiting',resumeToken:'resume',output:{approvalId:'a'}});
  expect((await sendWhatsappAgentReply(runtime(),{text:'Olá'},'invocation',send)).status).toBe('waiting');
  expect(send).not.toHaveBeenCalled();expect(mocks.effect).not.toHaveBeenCalled();
  expect(mocks.approval.mock.calls[0][1]).toMatchObject({chatId:'chat-a',contactId:'contact-a',recipient:target.phone_number_jid,instanceId:'instance-a',instanceName:'oficial',text:'Olá'});
  expect((await sendWhatsappAgentReply(runtime(),{text:'Olá'},'invocation',send)).output).toEqual({accepted:true});
  expect(send).toHaveBeenCalledOnce();expect(mocks.accepted).toHaveBeenCalledOnce();
 });
 it('refuses a changed channel after approval and never sends',async()=>{
  mocks.query.mockResolvedValueOnce({rows:[target]}).mockResolvedValueOnce({rows:[{...target,instance_id:'another'}]});
  const send=vi.fn();await expect(sendWhatsappAgentReply(runtime(),{text:'Olá'},'invocation',send)).rejects.toThrow('mudou');expect(send).not.toHaveBeenCalled();
 });
 it('does not send when approval is denied or expired',async()=>{
  mocks.approval.mockResolvedValue({status:'route',selectedOutput:'denied',output:{status:'denied'}});
  const send=vi.fn();expect((await sendWhatsappAgentReply(runtime(),{text:'Olá'},'invocation',send)).selectedOutput).toBe('denied');
  expect(send).not.toHaveBeenCalled();expect(mocks.effect).not.toHaveBeenCalled();
 });
 it('uses a durable invocation so retries do not send the same approved message again',async()=>{
  const completed=new Map<string,unknown>();mocks.effect.mockImplementation(async(_ws,id,_args,fn)=>{if(completed.has(id))return completed.get(id);const result=await fn();completed.set(id,result);return result;});
  const send=vi.fn().mockResolvedValue({success:true,providerAccepted:true});
  await sendWhatsappAgentReply(runtime(),{text:'Olá'},'stable-invocation',send);await sendWhatsappAgentReply(runtime(),{text:'Olá'},'stable-invocation',send);
  expect(send).toHaveBeenCalledOnce();expect(send.mock.calls[0][1].node.id).toBe('stable-invocation');
 });
 it('uses SQL boundaries for incoming official-channel messages within 24 hours',async()=>{
  const send=vi.fn().mockResolvedValue({success:true,providerAccepted:true});await sendWhatsappAgentReply(runtime(),{text:'Olá'},'invocation',send);
  expect(mocks.query.mock.calls[0][0]).toContain("e.type='wa_cloud'");expect(mocks.query.mock.calls[0][0]).toContain("interval '24 hours'");expect(mocks.query.mock.calls[0][0]).toContain('m.from_me=FALSE');
 });
});
