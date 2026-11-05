import 'dotenv/config';
import assert from 'node:assert/strict';
import { db } from '@/lib/db';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import { validateNexusWorkflowCredentialBindings } from '@/modules/nexus/services/credentials';
import { validateNexusWorkflowDialogyBindings } from '@/modules/nexus/services/dialogy-resources';

const workspaceId='e3b476a1-5de8-4744-80b5-a5d23fe15fab';
const workflowId='77bc3879-e0eb-584f-b1bb-4ca1e640ab52';
const apply=process.argv.includes('--apply');
function patch(input: unknown) {
  const d=WorkflowDefinitionSchema.parse(structuredClone(input));
  const route=(from:string,port:string,old:string,target:string)=>{
    const found=d.connections.filter(e=>e.sourceNodeId===from && e.sourcePortId===port);
    assert.equal(found.length,1,`${from}:${port} deve ter uma saída`);
    assert.equal(found[0].targetNodeId,old,`${from}:${port} mudou; revisar`);
    found[0].targetNodeId=target;
  };
  route('velpro_support_menu','billing','velpro_finance_menu','velpro_support_handoff_message');
  route('velpro_support_menu','unlock','velpro_finance_menu','velpro_support_handoff_message');
  route('velpro_support_finance_notice','success','velpro_finance_availability','velpro_support_availability');
  const notice=d.nodes.find(n=>n.id==='velpro_support_finance_notice'); assert(notice?.type==='output.respond');
  notice.name='Situação do contrato · Suporte';
  notice.config.message='O contrato {{sgpIdentification.contractId}} está {{sgpIdentification.statusLabel}} no cadastro. Vou seguir com o Suporte para a equipe verificar a situação.';
  const baseIds=['velpro_commercial_closed_tag','output_respond_6f9f2bcb-ffa4-46ab-829e-ee0d0febda05','output_end_f14b284c-82fe-41c9-a6af-2efcb499f5ea'];
  const ids=['velpro_address_closed_tag','velpro_address_closed_message','velpro_address_closed_end'];
  assert(ids.every(id=>!d.nodes.some(n=>n.id===id)));
  for(let i=0;i<ids.length;i++) {
    const old=d.nodes.find(n=>n.id===baseIds[i]); assert(old);
    const copy=structuredClone(old); copy.id=ids[i]; copy.name=['Etiquetar transferência de endereço fora de horário','Informar horário · Transferência de endereço','Finalizar transferência de endereço fora de horário'][i];
    copy.position={x:old.position.x+80,y:old.position.y+180};
    if(i===0) copy.config.outputKey='velpro_address_closed_tagResult';
    d.nodes.push(copy);
  }
  route('velpro_address_availability','closed',baseIds[0],ids[0]);
  for(let i=0;i<2;i++) {
    const old=d.connections.find(e=>e.sourceNodeId===baseIds[i]&&e.targetNodeId===baseIds[i+1]); assert(old);
    d.connections.push({...structuredClone(old),id:`velpro_address_closed_path_${i}`,sourceNodeId:ids[i],targetNodeId:ids[i+1]});
  }
  const stop=new Set(['velpro_back_to_main_loop','velpro_close_notice','velpro_session_expired','velpro_retry_exhausted']);
  for(const [start,forbidden] of [['velpro_support_identify',['velpro_finance_','velpro_commercial_','velpro_address_']],['velpro_address_identify',['velpro_support_','velpro_finance_','velpro_commercial_']],['velpro_referral_menu',['velpro_support_','velpro_finance_','velpro_address_']],['velpro_finance_menu',['velpro_support_','velpro_commercial_','velpro_address_']]] as const){
    const seen=new Set<string>();const pending=[start];
    while(pending.length){const id=pending.pop()!; if(seen.has(id)||stop.has(id))continue; seen.add(id); assert(!forbidden.some(prefix=>id.startsWith(prefix)),`${start} alcança ${id}`); for(const e of d.connections.filter(e=>e.sourceNodeId===id))pending.push(e.targetNodeId);}
  }
  const validation=validateWorkflowDefinition(d);assert(validation.valid,JSON.stringify(validation.errors));return d;
}
async function main(){const c=await db.connect();try{
  await c.query('BEGIN');const {rows}=await c.query('SELECT * FROM nexus_workflows WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[workspaceId,workflowId]);const row=rows[0];assert(row?.status==='published');assert.equal(Number(row.published_revision),30,'Revisão alterada; revisar novamente');
  const p=new PostgresWorkflowPersistence(c); const before=await p.getWorkflowDefinition(row.published_workflow_id,row.published_workflow_version);assert(before);
  const next=patch(before), draft=patch(row.draft_definition);const timestamp=new Date().toISOString();next.version='v31';next.updatedAt=timestamp;
  const [credentials,bindings]=await Promise.all([validateNexusWorkflowCredentialBindings({workspaceId,definition:next}),validateNexusWorkflowDialogyBindings({workspaceId,definition:next})]);assert(credentials.valid&&bindings.valid,JSON.stringify({credentials,bindings}));
  const active=await c.query("SELECT count(*)::int AS count FROM workflow_executions WHERE workspace_id=$1 AND workflow_id=$2 AND workflow_version=$3 AND status IN ('queued','running','waiting')",[workspaceId,next.id,before.version]);
  if(apply){await p.saveWorkflowDefinition(next);await c.query('UPDATE nexus_workflows SET draft_definition=$3::jsonb,published_workflow_version=$4,published_revision=31,published_at=$5,updated_at=$5 WHERE workspace_id=$1 AND id=$2',[workspaceId,workflowId,JSON.stringify(draft),next.version,timestamp]);await c.query(`INSERT INTO nexus_workflow_versions (nexus_workflow_id,workspace_id,revision,published_revision,definition,description,source,created_by) SELECT $1,$2,COALESCE(MAX(revision),0)+1,31,$3::jsonb,$4,'publish',$5 FROM nexus_workflow_versions WHERE nexus_workflow_id=$1 AND workspace_id=$2`,[workflowId,workspaceId,JSON.stringify(next),'Isola os caminhos de suporte e transferência de endereço, evitando roteamento involuntário entre setores.',row.created_by]);assert.deepEqual(await p.getWorkflowDefinition(next.id,next.version),next);await c.query('COMMIT');}else await c.query('ROLLBACK');
  console.log(JSON.stringify({apply,previous:before.version,version:next.version,validation:true,isolatedPaths:true,activeOldVersion:active.rows[0].count,nodes:next.nodes.length}));
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release();await db.end()}}
main().catch(e=>{console.error(e);process.exitCode=1});
