import { describe, expect, it } from 'vitest';
import { resolveAgentDatabaseApproval } from '@/modules/nexus/services/agent-database-approval';
const config={operation:'update',table:'public.orders',credentialId:'cred',values:{note:'{{arguments.note}}'},filters:[{column:'id',operator:'eq',value:'{{current.id}}'}],returning:['id']};
describe('database write approval',()=>{
 it('binds exact table, credential, values and filters using explicit arguments',()=>{
  const result=resolveAgentDatabaseApproval(config,{id:'123',note:'{{variables.secret}}',data:{status:'ready'}});
  expect(result.proposal).toEqual({operation:'update',table:'public.orders',credentialId:'cred',values:{note:'{{variables.secret}}',status:'ready'},filters:[{column:'id',operator:'eq',value:'123'}],returning:['id']});
 });
 it('rejects implicit state, missing arguments and unfiltered mutations',()=>{
  expect(()=>resolveAgentDatabaseApproval({...config,values:{note:'{{variables.secret}}'}},{id:'123'})).toThrow('argumentos explícitos');
  expect(()=>resolveAgentDatabaseApproval(config,{note:'x'})).toThrow('não foi informado');
  expect(()=>resolveAgentDatabaseApproval({...config,filters:[]},{note:'x'})).toThrow('exigem ao menos um filtro');
 });
 it('includes caller filters in the approval instead of resolving them from mutable execution state',()=>{
  const result=resolveAgentDatabaseApproval({...config,filters:[],values:{}},{filter_column:'id',filter_value:'123',data:{status:'ready'}});
  expect(result.proposal.filters).toEqual([{column:'id',operator:'eq',value:'123'}]);
 });
});
