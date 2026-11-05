import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({ query:vi.fn(), load:vi.fn(), approval:vi.fn() }));
vi.mock('@/lib/db',()=>({ db:{query:mocks.query} }));
vi.mock('@/modules/nexus/services/runtime',()=>({loadPublishedNexusWorkflow:mocks.load}));
vi.mock('@/modules/nexus/services/credentials',()=>({encryptPayload:JSON.stringify,decryptPayload:JSON.parse}));
vi.mock('@/modules/nexus/services/automation-approvals',()=>({requestAutomationApproval:mocks.approval}));
vi.mock('@/modules/nexus/services/toolbox-policy',()=>({assertAutomationToolboxEnabled:vi.fn()}));
import { scheduleAgentWorkflow } from '@/modules/nexus/services/agent-scheduler';
const runtime={workflow:{workspaceId:'workspace',id:'parent',version:'1'},execution:{executionId:'exec'},node:{id:'scheduler',config:{workflowId:'target'}}} as never;
const args=()=>({runAt:new Date(Date.now()+3600000).toISOString(),input:{question:'analisar relatório'}});
let jobs:Map<string,{workspace_id:string;kind:string;encrypted_payload:string;available_at:string}>;
beforeEach(()=>{
 vi.resetAllMocks(); jobs=new Map();
 mocks.load.mockResolvedValue({workflow:{id:'nexus:target',name:'Relatório',version:'3',nodes:[{type:'trigger.manual'}]}});
 mocks.approval.mockResolvedValue(null);
 mocks.query.mockImplementation(async (sql:string,params:unknown[])=>{
  const id=String(params[0]);
  if(sql.startsWith('INSERT')) { if(!jobs.has(id))jobs.set(id,{workspace_id:String(params[1]),kind:'scheduled',encrypted_payload:String(params[2]),available_at:String(params[3])}); return {rows:[]}; }
  const row=jobs.get(id); return {rows:row && row.workspace_id===params[1]?[row]:[]};
 });
});
describe('agent scheduled tasks',()=>{
 it('asks approval with exact target, time and inputs before persisting any job',async()=>{
  const payload=args(); mocks.approval.mockResolvedValue({status:'waiting',resumeToken:'approval',output:{approvalId:'approval'}});
  const result=await scheduleAgentWorkflow(runtime,payload,'stable-invocation');
  expect(result.status).toBe('waiting'); expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.approval).toHaveBeenCalledWith(runtime,{workflowId:'nexus:target',version:'3',runAt:payload.runAt,input:payload.input},expect.any(String),'stable-invocation');
 });
 it('creates an immutable due job idempotently after approval and rejects changed arguments',async()=>{
  const payload=args(); const first=await scheduleAgentWorkflow(runtime,payload,'same');
  const second=await scheduleAgentWorkflow(runtime,payload,'same');
  expect(first.output).toEqual(second.output);expect(jobs.size).toBe(1);
  expect([...jobs.values()][0]).toMatchObject({kind:'scheduled',available_at:payload.runAt});
  await expect(scheduleAgentWorkflow(runtime,{...payload,input:{question:'outra'}},'same')).rejects.toThrow('dados diferentes');
 });
 it('rejects past, excessive, unzoned and unpublished requests',async()=>{
  await expect(scheduleAgentWorkflow(runtime,{runAt:'2025-01-01T00:00:00Z',input:{}},'1')).rejects.toThrow('futura');
  await expect(scheduleAgentWorkflow(runtime,{runAt:'2027-01-01T00:00:00',input:{}},'1')).rejects.toThrow();
  mocks.load.mockResolvedValueOnce(null); await expect(scheduleAgentWorkflow(runtime,args(),'2')).rejects.toThrow('indisponível');
  expect(mocks.approval).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
 });
 it('never schedules a denied request',async()=>{
  mocks.approval.mockResolvedValue({status:'route',selectedOutput:'denied'});
  expect((await scheduleAgentWorkflow(runtime,args(),'x')).status).toBe('error');expect(mocks.query).not.toHaveBeenCalled();
 });
});
