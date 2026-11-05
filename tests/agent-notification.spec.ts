import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({approval:vi.fn(),effect:vi.fn(),send:vi.fn()}));
vi.mock('@/modules/nexus/services/automation-approvals',()=>({requestAutomationApproval:mocks.approval}));
vi.mock('@/modules/nexus/services/durable-effects',()=>({executeDurableEffect:mocks.effect,nodeInvocationKey:()=> 'key'}));
vi.mock('@/modules/nexus/services/integration-executors',()=>({executeNexusIntegration:mocks.send}));
vi.mock('@/modules/nexus/services/toolbox-policy',()=>({assertAutomationToolboxEnabled:vi.fn()}));
import { sendAgentNotification } from '@/modules/nexus/services/agent-notification';
const runtime={workflow:{workspaceId:'workspace'},execution:{variables:{},input:{},context:{}},node:{id:'notifier',config:{recipient:'operador@example.com',credentialId:'smtp-credential'}}} as never;
const args={subject:'Atenção',text:'Um evento precisa de revisão.'};
beforeEach(()=>{vi.resetAllMocks();mocks.approval.mockResolvedValue(null);mocks.effect.mockImplementation(async (_ws,_id,_args,fn)=>fn());mocks.send.mockResolvedValue({accepted:true});});
describe('agent email notifications',()=>{
 it('requires approval for exact content and configured recipient before sending',async()=>{
  mocks.approval.mockResolvedValueOnce({status:'waiting',resumeToken:'approval'});
  expect((await sendAgentNotification(runtime,args,'invocation')).status).toBe('waiting');
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.approval).toHaveBeenCalledWith(runtime,{recipient:'operador@example.com',credentialId:'smtp-credential',...args},expect.any(String),'invocation');
 });
 it('sends through durable SMTP and reports acceptance, not delivery',async()=>{
  const result=await sendAgentNotification(runtime,args,'invocation');
  expect(result.output).toEqual({accepted:true,recipient:'operador@example.com',status:'smtp_accepted'});
  expect(mocks.effect).toHaveBeenCalledWith('workspace','invocation',expect.objectContaining(args),expect.any(Function));
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({input:args,node:expect.objectContaining({type:'integration.email',config:expect.objectContaining({to:'operador@example.com',credentialId:'smtp-credential'})})}));
 });
 it('refuses denial, header injection and unauthorized recipient changes',async()=>{
  mocks.approval.mockResolvedValueOnce({status:'route',selectedOutput:'denied'});
  expect((await sendAgentNotification(runtime,args,'invocation')).status).toBe('error');
  await expect(sendAgentNotification(runtime,{...args,subject:'title\r\nBcc: other@example.com'},'invocation')).rejects.toThrow();
  await expect(sendAgentNotification(runtime,{...args,recipient:'other@example.com'},'invocation')).rejects.toThrow();
  expect(mocks.send).not.toHaveBeenCalled();
 });
});
