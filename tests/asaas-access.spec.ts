import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({user:vi.fn(),query:vi.fn(),start:vi.fn(),cancel:vi.fn(),read:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.user}})}));
vi.mock('@/lib/db',()=>({db:{query:m.query}}));
vi.mock('@/services/billing/asaas',()=>({startAsaasSubscription:m.start,cancelAsaasSubscription:m.cancel,reconcileAsaasSubscription:vi.fn()}));
vi.mock('@/services/billing/asaas-client',()=>({readAsaasConfig:m.read,asaasRequest:vi.fn()}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
import {createAsaasCheckoutAction,cancelAsaasSubscriptionAction,getAsaasSettingsAction} from '@/actions/asaas';
import { getAsaasPaymentAction, prepareAsaasPaymentAction, payAsaasCardAction } from '@/actions/asaas';
const input={workspaceId:'workspace-a',planId:'pro',name:'Cliente Teste',cpfCnpj:'12345678901'};
beforeEach(()=>{vi.resetAllMocks();m.user.mockResolvedValue({data:{user:{id:'owner',email:'test@example.test'}}});m.query.mockResolvedValue({rows:[]});});
describe('ASAAS authorization',()=>{
 it('requires login before reading workspace or starting checkout',async()=>{m.user.mockResolvedValue({data:{user:null}});expect((await createAsaasCheckoutAction(input)).success).toBe(false);expect(m.query).not.toHaveBeenCalled();expect(m.start).not.toHaveBeenCalled();});
 it('rejects a workspace member who is not its owner',async()=>{m.query.mockResolvedValue({rows:[{id:'workspace-a',owner_id:'another-owner'}]});expect((await createAsaasCheckoutAction(input)).success).toBe(false);expect(m.start).not.toHaveBeenCalled();});
 it('does not charge a different workspace after the active workspace changes',async()=>{m.query.mockResolvedValue({rows:[{id:'workspace-b',owner_id:'owner'}]});expect((await createAsaasCheckoutAction(input)).success).toBe(false);expect(m.start).not.toHaveBeenCalled();});
 it('does not cancel a different active workspace',async()=>{m.query.mockResolvedValue({rows:[{id:'workspace-b',owner_id:'owner'}]});expect((await cancelAsaasSubscriptionAction('workspace-a')).success).toBe(false);expect(m.cancel).not.toHaveBeenCalled();});
 it('rejects admin settings access before reading credentials',async()=>{m.query.mockResolvedValue({rows:[{is_superadmin:false}]});await expect(getAsaasSettingsAction()).rejects.toThrow('superadmin');expect(m.read).not.toHaveBeenCalled();});
});

describe('transparent checkout action authorization',()=>{
 const calls = [
  () => getAsaasPaymentAction({workspaceId:'workspace-a',paymentId:'pay_test'}),
  () => prepareAsaasPaymentAction({workspaceId:'workspace-a',paymentId:'pay_test',method:'PIX'}),
  () => payAsaasCardAction({workspaceId:'workspace-a',paymentId:'pay_test',card:{} as any}),
 ];
 it.each(calls)('requires authentication for every checkout entry point',async action=>{
  m.user.mockResolvedValue({data:{user:null}});
  expect((await action()).success).toBe(false);
  expect(m.query).not.toHaveBeenCalled();
 });
 it.each(calls)('requires ownership of the active workspace for every checkout entry point',async action=>{
  m.query.mockResolvedValue({rows:[{id:'workspace-a',owner_id:'another-owner'}]});
  expect((await action()).success).toBe(false);
  expect(m.read).not.toHaveBeenCalled();
 });
 it.each(calls)('rejects a changed active workspace before reading an invoice',async action=>{
  m.query.mockResolvedValue({rows:[{id:'workspace-b',owner_id:'owner'}]});
  expect((await action()).success).toBe(false);
  expect(m.query).toHaveBeenCalledTimes(1);
 });
 it('does not reflect invalid card data in action errors',async()=>{
  m.query.mockResolvedValue({rows:[{id:'workspace-a',owner_id:'owner'}]});
  const result=await payAsaasCardAction({workspaceId:'workspace-a',paymentId:'pay_test',card:{creditCard:{number:'private-invalid-number'}} as any});
  expect(result.success).toBe(false);
  expect(JSON.stringify(result)).not.toContain('private-invalid-number');
 });
});
