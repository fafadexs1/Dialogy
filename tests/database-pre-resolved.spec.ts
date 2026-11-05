import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({connect:vi.fn(),query:vi.fn(),end:vi.fn(),credential:vi.fn(),client:vi.fn()}));
vi.mock('pg',()=>({Client:vi.fn(function(config){ mocks.client(config); return { connect:mocks.connect, query:mocks.query, end:mocks.end }; })}));
vi.mock('@/lib/db',()=>({db:{query:vi.fn(),connect:vi.fn()}}));
vi.mock('@/modules/nexus/services/credentials',()=>({loadNexusCredentialPayload:mocks.credential}));
import { executeNexusDatabaseOperation } from '@/modules/nexus/services/integration-executors';
beforeEach(()=>{vi.resetAllMocks();mocks.connect.mockResolvedValue(undefined);mocks.end.mockResolvedValue(undefined);mocks.query.mockResolvedValue({rows:[],rowCount:1});mocks.credential.mockResolvedValue({payload:{connectionString:'postgres://test',ssl:false}});});
describe('pre-resolved database writes',()=>{
 it('uses exactly approved literal values and never expands another template',async()=>{
  await executeNexusDatabaseOperation({workspaceId:'workspace',credentialId:'credential',preResolved:true,runtimeSource:{variables:{secret:'not-approved'}},config:{operation:'update',table:'public.orders',values:{note:'{{variables.secret}}'},filters:[{column:'id',operator:'eq',value:'123'}]}});
  expect(mocks.query).toHaveBeenCalledWith('UPDATE "public"."orders" SET "note" = $2 WHERE "id" = $1',['123','{{variables.secret}}']);
 });
 it('rejects update or delete without an effective filter',async()=>{
  await expect(executeNexusDatabaseOperation({workspaceId:'workspace',credentialId:'credential',preResolved:true,runtimeSource:{},config:{operation:'delete',table:'orders',filters:[]}})).rejects.toThrow('exigem ao menos um filtro');
  expect(mocks.connect).not.toHaveBeenCalled();
 });
 it.each(['sslmode=disable','sslmode=no-verify','ssl=0','ssl=no-verify','ssl=false','uselibpqcompat=true&sslmode=require'])('refuses insecure TLS override %s by default',async(query)=>{
  mocks.credential.mockResolvedValue({payload:{connectionString:`postgres://user:secret@localhost/db?${query}`}});
  await expect(executeNexusDatabaseOperation({workspaceId:'workspace',credentialId:'credential',runtimeSource:{},config:{operation:'select',table:'orders'}})).rejects.toThrow(/TLS/);
  expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.connect).not.toHaveBeenCalled();
 });
 it.each(['sslcert','sslkey','sslrootcert'])('never loads local path from %s parameter',async(key)=>{
  mocks.credential.mockResolvedValue({payload:{connectionString:`postgres://user:secret@localhost/db?${key}=%2Fprivate%2Fkey`,ssl:false}});
  await expect(executeNexusDatabaseOperation({workspaceId:'workspace',credentialId:'credential',runtimeSource:{},config:{operation:'select',table:'orders'}})).rejects.toThrow(/locais/);
  expect(mocks.client).not.toHaveBeenCalled();
 });
 it('enforces the workspace TLS choice while allowing a normal Supabase-style URI',async()=>{
  mocks.credential.mockResolvedValue({payload:{connectionString:'postgres://user:secret@db.example/db?sslmode=require'}});
  await executeNexusDatabaseOperation({workspaceId:'workspace',credentialId:'credential',runtimeSource:{},config:{operation:'select',table:'orders'}});
  expect(mocks.credential).toHaveBeenCalledWith({workspaceId:'workspace',credentialId:'credential',allowedTypes:['database']});
  expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({connectionString:'postgres://user:secret@db.example/db',ssl:{rejectUnauthorized:true}}));
 });
 it('permits plaintext only when explicitly selected on the workspace credential',async()=>{
  mocks.credential.mockResolvedValue({payload:{connectionString:'postgres://user:secret@localhost/db?sslmode=disable',ssl:false}});
  await executeNexusDatabaseOperation({workspaceId:'workspace',credentialId:'credential',runtimeSource:{},config:{operation:'select',table:'orders'}});
  expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({connectionString:'postgres://user:secret@localhost/db',ssl:false}));
 });
});
