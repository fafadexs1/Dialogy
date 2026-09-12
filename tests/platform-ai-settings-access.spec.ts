import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({user:vi.fn(),permission:vi.fn(),query:vi.fn(),readConfig:vi.fn(),checkout:vi.fn(),grant:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{query:mocks.query}}));
vi.mock('@/actions/user',()=>({getCurrentUser:mocks.user}));
vi.mock('@/lib/workspace-permissions',()=>({hasWorkspacePermission:mocks.permission}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/services/ai/platform-config',()=>({readPlatformAiConfig:mocks.readConfig,requirePlatformAiConfig:mocks.readConfig,platformModel:vi.fn(),platformApiKey:vi.fn()}));
vi.mock('@/services/ai/credits',()=>({addAiCredits:mocks.grant,settleAiCredits:vi.fn(),finishAiCreditCall:vi.fn()}));
vi.mock('@/lib/stripe',()=>({getStripe:async()=>({checkout:{sessions:{create:mocks.checkout}}})}));
import { getAiCreditBalanceAction,savePlatformAiSettingsAction,createAiCreditCheckoutAction } from '@/actions/ai-credits';
import { listWorkspaceConfiguredAiModels } from '@/services/ai/workspace-ai-credentials';

beforeEach(()=>{
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({id:'user',activeWorkspaceId:'active-workspace'});
  mocks.permission.mockResolvedValue(true);
  mocks.query.mockResolvedValue({rows:[],rowCount:0});
  mocks.readConfig.mockResolvedValue(null);
});

describe('AI settings readiness and access',()=>{
  it('returns an empty presentation catalog before admin setup, without losing agent access',async()=>{
    await expect(listWorkspaceConfiguredAiModels('workspace')).resolves.toEqual([]);
  });
  it('returns only the active platform default to workspace UI',async()=>{
    mocks.readConfig.mockResolvedValue({defaultModel:'openai/default',models:[{id:'openai/default',enabled:true},{id:'deepseek/internal',enabled:true}]});
    const models=await listWorkspaceConfiguredAiModels('workspace');
    expect(models.map(m=>m.id)).toEqual(['openai/default']);
    expect(models[0].label).toBe('IA Dialogy');
  });
  it('rejects workspace users trying to change global pricing',async()=>{
    await expect(savePlatformAiSettingsAction({} as any)).rejects.toThrow('superadmin');
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0]).toContain('SELECT is_superadmin');
  });
  it('rejects unauthenticated balance requests before querying wallets',async()=>{
    mocks.user.mockResolvedValue(null);
    await expect(getAiCreditBalanceAction()).rejects.toThrow('Acesso negado');
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('scopes the balance and ledger to the authenticated active workspace',async()=>{
    const result=await getAiCreditBalanceAction();
    expect(result.workspaceId).toBe('active-workspace');
    expect(mocks.permission).toHaveBeenCalledWith('user','active-workspace','billing:view');
    for(const call of mocks.query.mock.calls)expect(call[1]).toEqual(['active-workspace']);
  });
  it('does not start checkout without editing permission',async()=>{
    mocks.permission.mockImplementation(async(_u:string,_w:string,p:string)=>p==='billing:view');
    await expect(createAiCreditCheckoutAction(1000)).rejects.toThrow('permissao');
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('exposes the public credit value and billing status without supplier pricing',async()=>{
    mocks.readConfig.mockResolvedValue({creditValueBrl:.01,billingEnabled:false,usdToBrl:5.0918,costCurrency:'USD',models:[{inputCost:.3,outputCost:1.2}]});
    const result=await getAiCreditBalanceAction();
    expect(result).toMatchObject({creditValueBrl:.01,billingEnabled:false});
    for(const field of ['models','usdToBrl','costCurrency','inputCost','outputCost'])expect(result).not.toHaveProperty(field);
  });
  it('computes checkout price server-side and binds the order to the active workspace',async()=>{
    mocks.readConfig.mockResolvedValue({creditValueBrl:.02});
    mocks.checkout.mockResolvedValue({id:'cs_test',url:'https://checkout.stripe.com/test'});
    await createAiCreditCheckoutAction(1000);
    expect(mocks.query.mock.calls[0][1].slice(1)).toEqual(['active-workspace',1000,2000]);
    expect(mocks.checkout.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(2000);
    expect(mocks.checkout.mock.calls[0][0].metadata.orderId).toBe(mocks.query.mock.calls[0][1][0]);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
});
