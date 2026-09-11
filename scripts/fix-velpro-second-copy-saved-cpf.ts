import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { db } from '@/lib/db';
import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import { validateNexusWorkflowCredentialBindings } from '@/modules/nexus/services/credentials';
import { validateNexusWorkflowDialogyBindings } from '@/modules/nexus/services/dialogy-resources';
const workspaceId='e3b476a1-5de8-4744-80b5-a5d23fe15fab', workflowId='77bc3879-e0eb-584f-b1bb-4ca1e640ab52';
function patch(original:any){
 const d=WorkflowDefinitionSchema.parse(structuredClone(original));
 const old=d.nodes.find(n=>n.id==='velpro_second_copy_cpf')!;
 assert.equal(old.type,'interaction.input');
 const identify=createWorkflowNode('dialogy.sgp_identify_customer',{id:old.id,name:'Identificar titular para segunda via',position:old.position,config:{outputKey:'sgpSecondCopyIdentity',allowNewCustomer:false,saveDocumentIfEmpty:true,customErrorRoute:true}});
 d.nodes[d.nodes.indexOf(old)]=identify;
 d.nodes.find(n=>n.id==='velpro_sgp_second_copy')!.config.cpfCnpj='{{sgpSecondCopyIdentity.cpfCnpj}}';
 const outgoing=d.connections.filter(e=>e.sourceNodeId===old.id);
 assert.equal(outgoing.length,2);assert.equal(outgoing[0].sourcePortId,'resumed');
 d.connections=d.connections.filter(e=>e.sourceNodeId!==old.id||e.sourcePortId!=='expired');
 outgoing[0].sourcePortId='selected';
 const recovery=d.nodes.find(n=>n.id==='velpro_finance_sgp_recovery')!;assert(recovery);
 for(const [port,target,type] of [['cancelled','velpro_back_to_main_loop','main'],['new_customer','velpro_back_to_main_loop','main'],['error',recovery.id,'error']] as const){
 d.connections.push({id:`second_copy_identity_${port}`,sourceNodeId:old.id,sourcePortId:port,targetNodeId:target,targetPortId:type,connectionType:type});}
 const v=validateWorkflowDefinition(d);assert(v.valid,JSON.stringify(v.errors));return d;
}
async function main(){const c=await db.connect();try{await c.query('BEGIN');const {rows}=await c.query('SELECT * FROM nexus_workflows WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[workspaceId,workflowId]);const row=rows[0];assert(row?.status==='published');const p=new PostgresWorkflowPersistence(c);const before=await p.getWorkflowDefinition(row.published_workflow_id,row.published_workflow_version);assert(before);const next=patch(before),draft=patch(row.draft_definition);const rev=Number(row.published_revision)+1;next.version=`v${rev}`;next.updatedAt=new Date().toISOString();const [credentials,bindings]=await Promise.all([validateNexusWorkflowCredentialBindings({workspaceId,definition:next}),validateNexusWorkflowDialogyBindings({workspaceId,definition:next})]);assert(credentials.valid&&bindings.valid);const apply=process.argv.includes('--apply');
 const evidence={at:next.updatedAt,apply,previousVersion:before.version,version:next.version,change:'Segunda via identifica CPF/CNPJ salvo no contato antes de solicitar documento.',validation:true,providerDeliveryTested:false};
 await writeFile('docs/velpro-second-copy-saved-cpf-candidate.json',JSON.stringify(next,null,2));
 if(apply){await p.saveWorkflowDefinition(next);await c.query(`UPDATE nexus_workflows SET draft_definition=$3::jsonb,published_workflow_version=$4,published_revision=$5,published_at=$6,updated_at=$6 WHERE workspace_id=$1 AND id=$2`,[workspaceId,workflowId,JSON.stringify(draft),next.version,rev,next.updatedAt]);await c.query(`INSERT INTO nexus_workflow_versions (nexus_workflow_id,workspace_id,revision,published_revision,definition,description,source,created_by) SELECT $1,$2,COALESCE(MAX(revision),0)+1,$3,$4::jsonb,$5,'publish',$6 FROM nexus_workflow_versions WHERE nexus_workflow_id=$1 AND workspace_id=$2`,[workflowId,workspaceId,rev,JSON.stringify(next),'Segunda via usa CPF cadastrado na Dialogy; coleta somente quando necessário, conforme solicitação do proprietário.',row.created_by]);assert.deepEqual(JSON.parse(JSON.stringify(await p.getWorkflowDefinition(next.id,next.version))),JSON.parse(JSON.stringify(next)));await c.query('COMMIT');}else await c.query('ROLLBACK');
 await writeFile(`docs/velpro-second-copy-saved-cpf-${apply?'publication':'dry-run'}.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await db.end();}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});


