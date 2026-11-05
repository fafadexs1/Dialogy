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
import { createNativeWorkflowLayout, getNodeDimensions } from '@/components/workflow/native-workflow-layout';
import type { WorkflowDefinition } from '@/services/workflow-runtime/types';
const workspaceId='e3b476a1-5de8-4744-80b5-a5d23fe15fab', workflowId='77bc3879-e0eb-584f-b1bb-4ca1e640ab52';
const apply=process.argv.includes('--apply');
const labels: Record<string,string>={subscribe:'Comercial',address_transfer:'Transferência de endereço',support:'Suporte',finance:'Financeiro',close:'Encerramento'};
function reachable(d:WorkflowDefinition,start:string){const seen=new Set<string>(), todo=[start];while(todo.length){const id=todo.pop()!;if(seen.has(id))continue;seen.add(id);for(const e of d.connections.filter(e=>e.sourceNodeId===id))todo.push(e.targetNodeId);}return seen;}
function patch(input:unknown){
 const d=WorkflowDefinitionSchema.parse(structuredClone(input));
 const back='velpro_back_to_main_loop';assert(d.nodes.some(n=>n.id===back));
 const returns=d.connections.filter(e=>e.targetNodeId===back);assert.equal(returns.length,10,'Retornos alterados; revisar');
 for(const e of returns){
   const source=d.nodes.find(n=>n.id===e.sourceNodeId)!;
   const id=`${source.id}_${e.sourcePortId}_finish`;
   const finish=createWorkflowNode('output.end',{id,name:`Finalizar · ${source.name} · ${e.sourcePortId}`,position:source.position,config:{output:{outcome:`${source.id}_${e.sourcePortId}`}}});
   d.nodes.push(finish);
   // The explicit finish choice uses the existing close-message/close-chat chain.
   if(e.sourceNodeId==='velpro_finance_menu'){
     const options=source.config.options as Array<Record<string,unknown>>;
     const option=options.find(o=>o.id==='back');assert(option);option.label='❌ Encerrar atendimento';option.value='❌ Encerrar atendimento';
     const port=source.outputPorts.find(p=>p.id==='back');if(port)port.label='Encerrar atendimento';
     const template=d.connections.find(c=>c.sourceNodeId==='velpro_close_notice');assert(template);
     e.targetNodeId='velpro_close_notice';
     d.nodes=d.nodes.filter(n=>n.id!==id);
   }else{
     const noticeId=`${id}_notice`;
     const message=e.sourcePortId==='new_customer'
       ? 'Não foi possível identificar um cadastro para continuar esta solicitação. Este atendimento foi finalizado. Para iniciar outro atendimento, envie uma nova mensagem.'
       : 'Solicitação cancelada. Este atendimento foi finalizado. Para iniciar outro atendimento, envie uma nova mensagem.';
     d.nodes.push(createWorkflowNode('output.respond',{id:noticeId,name:`Concluir solicitação · ${source.name} · ${e.sourcePortId}`,position:source.position,config:{channel:'source',message,idempotent:true}}));
     e.targetNodeId=noticeId;
     d.connections.push({id:`${id}_edge`,sourceNodeId:noticeId,sourcePortId:'success',targetNodeId:id,targetPortId:'main',connectionType:'main'});
   }
 }
 d.nodes=d.nodes.filter(n=>n.id!==back);d.connections=d.connections.filter(e=>e.sourceNodeId!==back);
 const main=d.nodes.find(n=>n.id==='velpro_main_menu')!;
 const roots=d.connections.filter(e=>e.sourceNodeId===main.id);
 const original=structuredClone(d), originalById=new Map(original.nodes.map(n=>[n.id,n]));
 const used=new Set<string>(), branchNodes=new Set<string>(), branchConnections=new Set<string>();
 const branches: Array<{option:string;root:string;ids:Set<string>}>=[];
 for(const root of roots){
   const seen=reachable(original,root.targetNodeId), mapping=new Map<string,string>();
   assert(!seen.has(main.id),'Caminho retorna ao menu principal');
   for(const id of seen){
     branchNodes.add(id);
     if(used.has(id)){
       const node=structuredClone(originalById.get(id)!);node.id=`${id}_${root.sourcePortId}_isolated`;node.name=`${node.name} · ${labels[root.sourcePortId]}`;
       assert(!d.nodes.some(n=>n.id===node.id));d.nodes.push(node);mapping.set(id,node.id);
     }else mapping.set(id,id);
     used.add(id);
   }
   for(const e of original.connections.filter(e=>seen.has(e.sourceNodeId))){
     branchConnections.add(e.id);
     d.connections.push({...e,id:`${e.id}_${root.sourcePortId}_path`,sourceNodeId:mapping.get(e.sourceNodeId)!,targetNodeId:mapping.get(e.targetNodeId)!});
   }
   root.targetNodeId=mapping.get(root.targetNodeId)!;
   branches.push({option:root.sourcePortId,root:root.targetNodeId,ids:new Set(mapping.values())});
 }
 d.connections=d.connections.filter(e=>!branchConnections.has(e.id));
 // Each sector occupies a separate horizontal lane in the editor.
 let laneY=800;
 for(const branch of branches){
   const nodes=d.nodes.filter(n=>branch.ids.has(n.id));const edges=d.connections.filter(e=>branch.ids.has(e.sourceNodeId));
   const positions=createNativeWorkflowLayout(nodes,edges);let height=0;
   for(const node of nodes){const pos=positions.get(node.id)!;node.position={x:pos.x+1800,y:pos.y+laneY};height=Math.max(height,pos.y+getNodeDimensions(node).height);}
   laneY+=height+300;
 }
 const allReachable=reachable(d,'velpro_trigger');
 // Remove only now-unused shared completion blocks, leaving unrelated draft blocks alone.
 const unused=original.nodes.filter(n=>!allReachable.has(n.id)&&['velpro_retry_exhausted','velpro_retry_end'].includes(n.id)).map(n=>n.id);
 d.nodes=d.nodes.filter(n=>!unused.includes(n.id));d.connections=d.connections.filter(e=>!unused.includes(e.sourceNodeId)&&!unused.includes(e.targetNodeId));
 for(let i=0;i<branches.length;i++){
   const seen=reachable(d,branches[i].root);assert(!seen.has(main.id));
   for(let j=0;j<i;j++){const other=reachable(d,branches[j].root);assert([...seen].every(id=>!other.has(id)),'Há bloco compartilhado entre caminhos');}
   assert([...seen].some(id=>d.nodes.find(n=>n.id===id)?.type==='output.end'));
   for(const id of seen){const n=d.nodes.find(n=>n.id===id)!;if(!d.connections.some(e=>e.sourceNodeId===id))assert.equal(n.type,'output.end',`Saída sem fim: ${id}`);}
 }
 const valid=validateWorkflowDefinition(d);assert(valid.valid,JSON.stringify(valid.errors));
 return {definition:d,evidence:branches.map(b=>({option:b.option,nodes:reachable(d,b.root).size})),removedReturns:returns.length};
}
async function main(){const c=await db.connect();try{
 await c.query('BEGIN');const {rows}=await c.query('SELECT * FROM nexus_workflows WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[workspaceId,workflowId]);const row=rows[0];assert.equal(Number(row.published_revision),31,'Revisão mudou; reavaliar');
 const persistence=new PostgresWorkflowPersistence(c);const before=await persistence.getWorkflowDefinition(row.published_workflow_id,row.published_workflow_version);assert(before);
 const published=patch(before),draft=patch(row.draft_definition),next=published.definition;next.version='v32';next.updatedAt=new Date().toISOString();
 const [credentials,bindings]=await Promise.all([validateNexusWorkflowCredentialBindings({workspaceId,definition:next}),validateNexusWorkflowDialogyBindings({workspaceId,definition:next})]);assert(credentials.valid&&bindings.valid,JSON.stringify({credentials,bindings}));
 if(apply){
 await writeFile('tmp/velpro-before-v32.json',JSON.stringify({published:before,draft:row.draft_definition},null,2));
 await persistence.saveWorkflowDefinition(next);
 await c.query('UPDATE nexus_workflows SET draft_definition=$3::jsonb,published_workflow_version=$4,published_revision=32,published_at=$5,updated_at=$5 WHERE workspace_id=$1 AND id=$2',[workspaceId,workflowId,JSON.stringify(draft.definition),next.version,next.updatedAt]);
 await c.query(`INSERT INTO nexus_workflow_versions (nexus_workflow_id,workspace_id,revision,published_revision,definition,description,source,created_by) SELECT $1,$2,COALESCE(MAX(revision),0)+1,32,$3::jsonb,$4,'publish',$5 FROM nexus_workflow_versions WHERE nexus_workflow_id=$1 AND workspace_id=$2`,[workflowId,workspaceId,JSON.stringify(next),'Remove loop central compartilhado e isola integralmente os cinco caminhos do menu principal, cada um com encerramentos próprios.',row.created_by]);
 assert.deepEqual(await persistence.getWorkflowDefinition(next.id,next.version),JSON.parse(JSON.stringify(next)));await c.query('COMMIT');
 }else await c.query('ROLLBACK');
 console.log(JSON.stringify({apply,version:next.version,removedReturns:published.removedReturns,branches:published.evidence,validation:true,nodes:next.nodes.length}));
}catch(e){await c.query('ROLLBACK');throw e}finally{c.release();await db.end()}}
main().catch(e=>{console.error(e);process.exitCode=1});

