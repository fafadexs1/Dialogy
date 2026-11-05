import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{query:mocks.query}}));
import {reserveReactionDelivery,releaseReactionDelivery,renewReactionDelivery} from '@/lib/team-reactions/delivery-guard';
const recipient='10000000-0000-4000-8000-000000000001',first='20000000-0000-4000-8000-000000000001',second='20000000-0000-4000-8000-000000000002';let sql:PGlite;
beforeAll(async()=>{sql=new PGlite();await sql.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE users(id uuid PRIMARY KEY)');await sql.exec(readFileSync(new URL('../prisma/migrations/20261027040000_team_reaction_delivery_guard/migration.sql',import.meta.url),'utf8'));await sql.query('INSERT INTO users(id) VALUES($1)',[recipient]);mocks.query.mockImplementation((q:string,v:unknown[])=>sql.query(q,v));});
afterAll(async()=>{await sql.close();});
describe('reaction delivery guard',()=>{
 it('atomically blocks another delivery until expiry, including parallel attempts',async()=>{const results=await Promise.all([reserveReactionDelivery(recipient,first),reserveReactionDelivery(recipient,second)]);expect(results.filter(Boolean)).toHaveLength(1);expect(await reserveReactionDelivery(recipient,first)).toBe(false);await sql.query("UPDATE team_reaction_delivery_guard SET expires_at=now()-interval '1 second' WHERE user_id=$1",[recipient]);expect(await reserveReactionDelivery(recipient,second)).toBe(true);});
 it('renews only a matching unexpired reservation',async()=>{expect(await renewReactionDelivery(recipient,first)).toBe(false);expect(await renewReactionDelivery(recipient,second)).toBe(true);await sql.query("UPDATE team_reaction_delivery_guard SET expires_at=now()-interval '1 second' WHERE user_id=$1",[recipient]);expect(await renewReactionDelivery(recipient,second)).toBe(false);expect(await reserveReactionDelivery(recipient,second)).toBe(true);});
 it('only the owner of a reservation can release it',async()=>{await releaseReactionDelivery(recipient,first);expect(await reserveReactionDelivery(recipient,first)).toBe(false);await releaseReactionDelivery(recipient,second);expect(await reserveReactionDelivery(recipient,first)).toBe(true);});
});
