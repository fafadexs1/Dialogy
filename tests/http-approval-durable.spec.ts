import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
const bridge=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{query:bridge.query}}));
vi.mock('@/modules/nexus/services/credentials',()=>({encryptPayload:JSON.stringify,decryptPayload:JSON.parse}));
import { requestAutomationApproval } from '@/modules/nexus/services/automation-approvals';
import { executeDurableEffect } from '@/modules/nexus/services/durable-effects';
let sql:PGlite;
const workspace='00000000-0000-4000-8000-000000000001';
const input={workflow:{id:'workflow',version:'1',workspaceId:workspace},node:{id:'http',config:{method:'POST',url:'https://example.com/order'}},execution:{executionId:'execution'}} as never;
beforeAll(async()=>{sql=new PGlite();bridge.query.mockImplementation(async (query:string,args?:unknown[])=>{const result=await sql.query(query,args);return {...result,rowCount:result.affectedRows ?? result.rows.length};});await sql.exec(`CREATE TABLE nexus_automation_approvals(id text PRIMARY KEY,workspace_id uuid,execution_id text,node_id text,title text,arguments_hash text,encrypted_arguments text,resume_token text,expires_at timestamptz,status text NOT NULL DEFAULT 'pending');CREATE TABLE nexus_automation_effects(id text PRIMARY KEY,workspace_id uuid,arguments_hash text,encrypted_result text);`);},30000);
beforeEach(async()=>{await sql.exec('TRUNCATE nexus_automation_approvals,nexus_automation_effects')});
afterAll(async()=>sql.close());
describe('HTTP approval and durable effect in PostgreSQL',()=>{
 it('binds approval to exact arguments and prevents any later modification',async()=>{
  const original={method:'POST',url:'https://example.com/order',arguments:{orderId:'123'}};
  expect((await requestAutomationApproval(input,original,'Atualizar','request-1'))?.status).toBe('waiting');
  await sql.query("UPDATE nexus_automation_approvals SET status='approved' WHERE id=$1",['request-1']);
  await expect(requestAutomationApproval(input,{...original,arguments:{orderId:'456'}},'Atualizar','request-1')).rejects.toThrow('argumentos mudaram');
  expect(await requestAutomationApproval(input,original,'Atualizar','request-1')).toBeNull();
 });
 it('returns a prior result without repeating the side effect and blocks changed arguments',async()=>{
  const send=vi.fn().mockResolvedValue({accepted:true});
  expect(await executeDurableEffect(workspace,'effect-1',{orderId:'123'},send)).toEqual({accepted:true});
  expect(await executeDurableEffect(workspace,'effect-1',{orderId:'123'},send)).toEqual({accepted:true});
  await expect(executeDurableEffect(workspace,'effect-1',{orderId:'456'},send)).rejects.toThrow('incerto');
  expect(send).toHaveBeenCalledOnce();
 });
 it('does not retry a side effect that failed with uncertain outcome',async()=>{
  const send=vi.fn().mockRejectedValue(new Error('connection lost'));
  await expect(executeDurableEffect(workspace,'effect-2',{orderId:'123'},send)).rejects.toThrow('connection lost');
  await expect(executeDurableEffect(workspace,'effect-2',{orderId:'123'},send)).rejects.toThrow('incerto');
  expect(send).toHaveBeenCalledOnce();
 });
});
