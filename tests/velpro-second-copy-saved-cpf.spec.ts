import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
import {WorkflowExecutor,InMemoryWorkflowPersistence,createDefaultNodeHandlerRegistry} from '@/services/workflow-runtime';
import {WorkflowDefinitionSchema} from '@/services/workflow-runtime/schemas';
import {executeSgpIdentification} from '@/modules/nexus/services/sgp-identification';
const lookup=vi.hoisted(()=>vi.fn());
vi.mock('@/services/agent-tools/sgp-tools',()=>({lookupSgpCustomerContracts:lookup}));
vi.mock('@/modules/nexus/services/sgp-contact-document',()=>({saveSgpContactDocumentIfEmpty:async()=> 'preserved'}));
it.each([true,false])('second copy uses stored document when present: %s',async saved=>{
const flow=WorkflowDefinitionSchema.parse(JSON.parse(readFileSync('docs/velpro-second-copy-saved-cpf-candidate.json','utf8')));
const found={status:'found',cpfCnpj:'52998224725',contracts:[{id:'123',statusLabel:'Ativo',statusTone:'active'}]};
lookup.mockReset(); if(!saved)lookup.mockResolvedValueOnce({status:'missing-identifier'});lookup.mockResolvedValue(found);
const actions:any[]=[];
const executor=new WorkflowExecutor(new InMemoryWorkflowPersistence(),createDefaultNodeHandlerRegistry({sendResponse:async()=>({success:true}),executePlatformAction:async input=>{
if(input.node.type==='dialogy.sgp_identify_customer')return executeSgpIdentification(input,{sendResponse:async()=>({success:true})});
actions.push(input);return {status:'success',selectedOutput:'success',output:{}};
}}));
let e=await executor.start({workflow:flow,conversationId:'isolated',input:{message:'Oi'}});
e=await executor.resume({resumeToken:e.resumeToken!,input:{selectedOptionId:'finance'}});
e=await executor.resume({resumeToken:e.resumeToken!,input:{selectedOptionId:'second_copy'}});
expect(e.currentNodeId).toBe('velpro_second_copy_cpf');
if(!saved){e=await executor.resume({resumeToken:e.resumeToken!,input:{selectedOptionId:'other_cpf'}});e=await executor.resume({resumeToken:e.resumeToken!,input:{value:'52998224725'}});}
else expect(lookup).toHaveBeenLastCalledWith(expect.objectContaining({customerIdentifier:undefined}));
e=await executor.resume({resumeToken:e.resumeToken!,input:{selectedOptionId:'contract:123'}});
const second=actions.find(a=>a.node.type==='dialogy.sgp_second_copy');expect(second).toBeDefined();
expect(second.execution.variables.sgpSecondCopyIdentity.cpfCnpj).toBe('52998224725');
expect(second.node.config.cpfCnpj).toBe('{{sgpSecondCopyIdentity.cpfCnpj}}');
});
