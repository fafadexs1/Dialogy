import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const bridge=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),run:vi.fn(),load:vi.fn(),approval:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{query:bridge.query,connect:bridge.connect}}));
vi.mock('@/modules/nexus/services/runtime',()=>({loadPublishedNexusWorkflow:bridge.load,runPersistedNexusExecution:bridge.run,terminalNexusOutput:()=>({done:true}),cancelPublishedNexusWorkflowExecution:vi.fn(),resumePublishedNexusWorkflow:vi.fn()}));
vi.mock('@/modules/nexus/services/credentials',()=>({encryptPayload:JSON.stringify,decryptPayload:JSON.parse}));
vi.mock('@/modules/nexus/services/automation-approvals',()=>({requestAutomationApproval:bridge.approval}));
vi.mock('@/modules/nexus/services/toolbox-policy',()=>({assertAutomationToolboxEnabled:vi.fn(),isAutomationToolboxEnabled:()=>true}));
import { scheduleAgentWorkflow } from '@/modules/nexus/services/agent-scheduler';
import { processAutomationTask } from '@/modules/nexus/services/automation-worker';
const workspace='00000000-0000-4000-8000-000000000001';
const runtime={workflow:{workspaceId:workspace,id:'parent',version:'1'},execution:{executionId:'exec'},node:{id:'scheduler',config:{workflowId:'target'}}} as never;
let sql:PGlite;
beforeAll(async()=>{
 sql=new PGlite(); bridge.query.mockImplementation((query:string,args?:unknown[])=>sql.query(query,args));
 bridge.connect.mockResolvedValue({query:(query:string,args?:unknown[])=>sql.query(query,args),release:()=>{}});
 await sql.exec(`CREATE TABLE nexus_automation_jobs(id text PRIMARY KEY, workspace_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('webhook','batch','child','recovery')), parent_id text, execution_id text NOT NULL, status text NOT NULL DEFAULT 'queued', encrypted_payload text NOT NULL, encrypted_result text, available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token uuid, attempts integer NOT NULL DEFAULT 0, model_reserved integer NOT NULL DEFAULT 0, tool_reserved integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());`);
 await sql.exec(await readFile('prisma/migrations/20261104123000_nexus_scheduled_agent_jobs/migration.sql','utf8'));
},30000);
beforeEach(async()=>{
 await sql.exec('TRUNCATE nexus_automation_jobs'); bridge.run.mockReset();bridge.load.mockReset();bridge.approval.mockReset();
 bridge.load.mockResolvedValue({workflow:{id:'nexus:target',name:'Target',version:'3',nodes:[{type:'trigger.manual'}]}});bridge.approval.mockResolvedValue(null);
 bridge.run.mockResolvedValue({status:'completed',executionId:'id',totalModelCalls:0,totalToolCalls:0});
});
afterAll(async()=>sql.close());
describe('scheduled workflow outbox and worker',()=>{
 it('waits until due, claims once and runs the approved immutable version',async()=>{
  const runAt=new Date(Date.now()+3600000).toISOString();
  const result=await scheduleAgentWorkflow(runtime,{runAt,input:{task:'revisar'}},'request-id');
  const id=String(result.output!.scheduleId);
  await processAutomationTask(id,workspace);expect(bridge.run).not.toHaveBeenCalled();
  await sql.query("UPDATE nexus_automation_jobs SET available_at=now()-interval '1 second' WHERE id=$1",[id]);
  await processAutomationTask(id,workspace);
  expect(bridge.run).toHaveBeenCalledOnce();
  expect(bridge.run).toHaveBeenCalledWith(expect.objectContaining({workspaceId:workspace,workflowId:'nexus:target',version:'3',executionId:id,input:{task:'revisar'},context:expect.objectContaining({source:'agent_schedule'})}));
  expect((await sql.query<{status:string}>('SELECT status FROM nexus_automation_jobs WHERE id=$1',[id])).rows[0].status).toBe('completed');
  await processAutomationTask(id,workspace);expect(bridge.run).toHaveBeenCalledOnce();
 });
});
