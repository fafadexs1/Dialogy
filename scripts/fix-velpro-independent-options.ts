import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { db } from '@/lib/db';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import { validateNexusWorkflowCredentialBindings } from '@/modules/nexus/services/credentials';
import { validateNexusWorkflowDialogyBindings } from '@/modules/nexus/services/dialogy-resources';
import { createNativeWorkflowLayout } from '@/components/workflow/native-workflow-layout';
import { WorkflowExecutor } from '@/services/workflow-runtime/executor';
import { InMemoryWorkflowPersistence } from '@/services/workflow-runtime/persistence';
import { createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime/node-handlers';
import type { WorkflowDefinition, WorkflowConnection, WorkflowNode } from '@/services/workflow-runtime/types';
const workspaceId='e3b476a1-5de8-4744-80b5-a5d23fe15fab',workflowId='77bc3879-e0eb-584f-b1bb-4ca1e640ab52';
const apply=process.argv.includes('--apply');
function patch(input:unknown){
 const original=WorkflowDefinitionSchema.parse(structuredClone(input)),d=structuredClone(original);
 const byId=new Map(original.nodes.map(n=>[n.id,n]));const used=new Set<string>(),origin=new Map<string,string>(),backEdges=new Set<string>();
 d.nodes=[];d.connections=[];
 function expand(id:string,ancestry:Map<string,string>,path:string,label:string):string{
   assert(d.nodes.length<2000,'Expansão inesperada');const old=byId.get(id);assert(old);
   const node=structuredClone(old);node.id=used.has(id)?`${id}__${createHash('sha256').update(path).digest('hex').slice(0,12)}`:id;
   used.add(id);origin.set(node.id,id);if(node.id!==id)node.name=`${old.name} · ${label}`.slice(0,240);d.nodes.push(node);
   const chain=new Map(ancestry);chain.set(id,node.id);
   for(const e of original.connections.filter(e=>e.sourceNodeId===id)){
     assert(['main','error','event'].includes(e.connectionType),'Attachment requires explicit review');
     const option=(old.config.options as Array<Record<string,unknown>>|undefined)?.find(o=>o.id===e.sourcePortId);
     const nextLabel=option?String(option.label||option.value):label;
     const edge={...structuredClone(e),id:`path_${d.connections.length}_${createHash('sha256').update(path+e.id).digest('hex').slice(0,12)}`,sourceNodeId:node.id};
     // Only a bounded, local retry may reconnect to a block already in this path.
     if(chain.has(e.targetNodeId)){
       assert.equal(old.type,'logic.loop');assert.equal(e.sourcePortId,'iterate');assert.equal(old.id,'velpro_payment_promise_loop');
       edge.targetNodeId=chain.get(e.targetNodeId)!;backEdges.add(edge.id);
     }else edge.targetNodeId=expand(e.targetNodeId,chain,`${path}/${e.id}`,nextLabel);
     d.connections.push(edge);
   }
   return node.id;
 }
 expand('velpro_trigger',new Map(),'root','Entrada');
 // Preserve any disconnected draft work; never silently publish it.
 for(const n of original.nodes.filter(n=>!used.has(n.id))){assert(original.status!=='published',`Published orphan ${n.id}`);d.nodes.push(n);}
 const forward=d.connections.filter(e=>!backEdges.has(e.id));
 for(const n of d.nodes){
   const incoming=forward.filter(e=>e.targetNodeId===n.id);assert(incoming.length<=1,`Bloco compartilhado ${n.id}`);
   const source=byId.get(origin.get(n.id)||n.id)!;assert.deepEqual(n.config,source.config,'Configuração funcional deve ser preservada');
   const outgoing=d.connections.filter(e=>e.sourceNodeId===n.id);
   assert.deepEqual(outgoing.map(e=>e.sourcePortId).sort(),original.connections.filter(e=>e.sourceNodeId===source.id).map(e=>e.sourcePortId).sort());
   if(!outgoing.length)assert.equal(n.type,'output.end',`Sem encerramento ${n.id}`);
 }
 const positions=createNativeWorkflowLayout(d.nodes,d.connections);for(const n of d.nodes)n.position=positions.get(n.id)||n.position;
 const v=validateWorkflowDefinition(d);assert(v.valid,JSON.stringify(v.errors));
 return {definition:d,origin,backEdges,originalNodes:original.nodes.length};
}
type Scenario={edges:WorkflowConnection[];end:string};
function scenarios(d:WorkflowDefinition,backEdges:Set<string>){
 const all:Scenario[]=[];
 function walk(id:string,edges:WorkflowConnection[],visited:Set<string>){
   const out=d.connections.filter(e=>e.sourceNodeId===id&&!backEdges.has(e.id));
   if(!out.length){assert.equal(d.nodes.find(n=>n.id===id)?.type,'output.end');all.push({edges,end:id});return;}
   for(const e of out){assert(!visited.has(e.targetNodeId));walk(e.targetNodeId,[...edges,e],new Set([...visited,id]));}
 }
 walk('velpro_trigger',[],new Set());
 // Exercise one actual local retry before every possible continuation of that input.
 for(const backId of backEdges){const back=d.connections.find(e=>e.id===backId)!;
   for(const s of [...all]){const at=s.edges.findIndex(e=>e.sourceNodeId===back.targetNodeId);if(at<0)continue;
     const prefix=s.edges.slice(0,at);const loopPath:WorkflowConnection[]=[];let cursor=back.targetNodeId;
     function find(id:string,seen:Set<string>):boolean{if(id===back.sourceNodeId)return true;seen.add(id);for(const e of d.connections.filter(e=>e.sourceNodeId===id&&!backEdges.has(e.id)&&!seen.has(e.targetNodeId))){loopPath.push(e);if(find(e.targetNodeId,seen))return true;loopPath.pop();}return false;}
     assert(find(cursor,new Set()));all.push({edges:[...prefix,...loopPath,back,...s.edges.slice(at)],end:s.end});
   }
 }
 return all;
}
async function simulate(d:WorkflowDefinition,backEdges:Set<string>){
 const cases=scenarios(d,backEdges);let resumes=0;
 for(const scenario of cases) for(const mode of ['id','number','label']){
   const queues=new Map<string,WorkflowConnection[]>();for(const e of scenario.edges){const q=queues.get(e.sourceNodeId)||[];q.push(e);queues.set(e.sourceNodeId,q);}
   const handlers=createDefaultNodeHandlerRegistry({sendResponse:async()=>({delivered:true}),handoff:async()=>({transferred:true}),closeConversation:async()=>({closed:true})});
   const mocks=new Map<string,any>();const real=new Set(['interaction.options','output.end','output.respond','output.handoff','output.close_conversation']);
   for(const type of new Set(d.nodes.map(n=>n.type))){if(real.has(type))continue;mocks.set(type,{type,execute:async({node}:any)=>{const e=queues.get(node.id)?.shift();assert(e,`No planned output ${node.id}`);return e.connectionType==='error'?{status:'error',selectedOutput:e.sourcePortId,error:{code:'SIMULATED_PROVIDER_FAILURE',message:'Simulated failure',retryable:false}}:{status:'success',selectedOutput:e.sourcePortId,output:{simulated:true}};}});}
   const executor=new WorkflowExecutor(new InMemoryWorkflowPersistence(),{get:(type)=>mocks.get(type)||handlers.get(type)},{validateBeforeRun:false});
   let execution=await executor.start({workflow:d,input:{message:'Olá'},variables:{sgpIdentification:{summary:'Simulação',contractId:'simulated',statusLabel:'ativo'}}});
   let attempts=0;
   while(execution.status==='waiting'){
     assert(attempts++<20);const node=d.nodes.find(n=>n.id===execution.currentNodeId)!;assert.equal(node.type,'interaction.options');const edge=queues.get(node.id)?.shift();assert(edge);assert(execution.resumeToken);
     const choices=node.config.options as Array<Record<string,unknown>>;const index=choices.findIndex(o=>o.id===edge.sourcePortId);assert(index>=0);const response=mode==='id'?{selectedOptionId:edge.sourcePortId}:{value:mode==='number'?String(index+1):String(choices[index].value||choices[index].label)};execution=await executor.resume({resumeToken:execution.resumeToken,input:response});resumes++;
   }
   assert.equal(execution.status,'completed',JSON.stringify({end:scenario.end,status:execution.status,failure:execution.failure}));assert(execution.executionPath.some(s=>s.nodeId===scenario.end),`Wrong end ${scenario.end}`);
   const allowed=new Set([...scenario.edges.flatMap(e=>[e.sourceNodeId,e.targetNodeId]),scenario.end]);assert(execution.executionPath.every(s=>allowed.has(s.nodeId)),'Execução saiu do caminho');
 }
 return {terminalScenarios:cases.length,executions:cases.length*3,menuSelections:resumes,menuInputModes:['id','number','label'],routingOutcomes:'simulated',externalEffects:'simulated'};
}
async function main(){
 const c=await db.connect();try{
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='30s'");const{rows}=await c.query('SELECT * FROM nexus_workflows WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[workspaceId,workflowId]);const row=rows[0];assert.equal(Number(row.published_revision),32,'Revisão mudou; revisar');
 const persistence=new PostgresWorkflowPersistence(c);const before=await persistence.getWorkflowDefinition(row.published_workflow_id,row.published_workflow_version);assert(before);const published=patch(before),draft=patch(row.draft_definition),next=published.definition;next.version='v33';next.updatedAt=new Date().toISOString();
 const tests=await simulate(next,published.backEdges);
 const [credentials,bindings]=await Promise.all([validateNexusWorkflowCredentialBindings({workspaceId,definition:next}),validateNexusWorkflowDialogyBindings({workspaceId,definition:next})]);assert(credentials.valid&&bindings.valid,JSON.stringify({credentials,bindings}));
 const evidence={version:next.version,apply,previousNodes:published.originalNodes,nodes:next.nodes.length,sharedBlocks:0,localRetries:published.backEdges.size,tests,validation:true};
 await writeFile('tmp/velpro-v33-candidate.json',JSON.stringify(next,null,2));
 if(apply){await writeFile('tmp/velpro-before-v33.json',JSON.stringify({published:before,draft:row.draft_definition},null,2));await persistence.saveWorkflowDefinition(next);
 await c.query('UPDATE nexus_workflows SET draft_definition=$3::jsonb,published_workflow_version=$4,published_revision=33,published_at=$5,updated_at=$5 WHERE workspace_id=$1 AND id=$2',[workspaceId,workflowId,JSON.stringify(draft.definition),next.version,next.updatedAt]);
 await c.query(`INSERT INTO nexus_workflow_versions (nexus_workflow_id,workspace_id,revision,published_revision,definition,description,source,created_by) SELECT $1,$2,COALESCE(MAX(revision),0)+1,33,$3::jsonb,$4,'publish',$5 FROM nexus_workflow_versions WHERE nexus_workflow_id=$1 AND workspace_id=$2`,[workflowId,workspaceId,JSON.stringify(next),'Isolamento de todas as opções e saídas: zero blocos compartilhados, inclusive identificação, expediente, recuperação e encerramento. Percursos simulados no executor.',row.created_by]);assert.deepEqual(await persistence.getWorkflowDefinition(next.id,next.version),JSON.parse(JSON.stringify(next)));await c.query('COMMIT');}else await c.query('ROLLBACK');
 await writeFile('docs/velpro-independent-paths-verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await db.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1});


