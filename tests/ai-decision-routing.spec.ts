import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertDecisionModelsAvailable, DEFAULT_AI_DECISION_MODEL_CONFIG } from '@/lib/ai-decision-models';

const request = vi.hoisted(()=>vi.fn());
vi.mock('@/services/ai/platform-json',()=>({requestDecisionJson:request}));
import { classifyToolIntent } from '@/ai/flows/tool-intent-gate';
import { classifyAutopilotIntentWithAi } from '@/ai/flows/intent-classifier';
import { classifyAutopilotWorkflowWithAi } from '@/ai/flows/workflow-classifier';
import { extractCollectionFieldsWithAi } from '@/ai/flows/collection-field-extractor';

beforeEach(()=>{request.mockReset();});
describe('Autopilot decision callsites',()=>{
  it('routes tool authorization through its dedicated role',async()=>{
    request.mockResolvedValue({execute:false,confidence:'low',reason:'test'});
    await classifyToolIntent({workspaceId:'workspace',customerMessage:'Ola',toolName:'close_chat',candidateReason:'test',model:'untrusted',apiKey:'untrusted'});
    expect(request.mock.calls[0][0]).toBe('toolIntentGate');
    expect(request.mock.calls[0][1]).toMatchObject({workspaceId:'workspace',maxTokens:80});
    expect(request.mock.calls[0][1]).not.toHaveProperty('model');
    expect(request.mock.calls[0][1]).not.toHaveProperty('apiKey');
  });
  it('routes universal intent through its dedicated role',async()=>{
    request.mockResolvedValue({intent:'support_request',confidence:.9,reason:'test'});
    await classifyAutopilotIntentWithAi({workspaceId:'workspace',customerMessage:'Suporte',deterministicIntent:'unknown',deterministicConfidence:.2});
    expect(request.mock.calls[0][0]).toBe('intentClassifier');
  });
  it('routes the SGP workflow classifier through metered decision calls with workspace scope',async()=>{
    request.mockResolvedValue({shouldUseTools:false,needsCustomerIdentifier:false,suggestedTools:[],confidence:0,reason:'test'});
    await classifyAutopilotWorkflowWithAi({workspaceId:'workspace',customerMessage:'Fatura',intent:'unknown',confidence:.2,model:'untrusted'});
    expect(request.mock.calls[0][0]).toBe('workflowClassifier');
    expect(request.mock.calls[0][1]).toMatchObject({workspaceId:'workspace',maxTokens:180});
    expect(request.mock.calls[0][1]).not.toHaveProperty('model');
  });
  it('routes field extraction through its dedicated role and preserves value validation',async()=>{
    request.mockResolvedValue({field_0:'Joao Silva',field_1:'not-an-email'});
    const result=await extractCollectionFieldsWithAi({workspaceId:'workspace',customerMessage:'Joao Silva',pendingFields:['nome','email']});
    expect(request.mock.calls[0][0]).toBe('fieldExtractor');
    expect(result).toEqual({nome:'Joao Silva'});
  });
  it('preserves deterministic fallbacks when a decision provider fails',async()=>{
    request.mockRejectedValue(new Error('Provider unavailable'));
    await expect(classifyToolIntent({customerMessage:'Oi',toolName:'close_chat',candidateReason:'test'})).resolves.toMatchObject({execute:false});
    await expect(classifyAutopilotIntentWithAi({customerMessage:'Suporte',deterministicIntent:'unknown',deterministicConfidence:.2})).resolves.toMatchObject({intent:'unknown',confidence:.2});
    await expect(classifyAutopilotWorkflowWithAi({customerMessage:'Fatura',intent:'unknown',confidence:.2})).resolves.toMatchObject({shouldUseTools:false});
    await expect(extractCollectionFieldsWithAi({customerMessage:'Joao',pendingFields:['nome']})).resolves.toEqual({});
  });
  it('rejects deactivating a model referenced by a decision role',()=>{
    expect(()=>assertDecisionModelsAvailable(DEFAULT_AI_DECISION_MODEL_CONFIG,[])).toThrow('Tool Intent Gate');
    expect(()=>assertDecisionModelsAvailable(DEFAULT_AI_DECISION_MODEL_CONFIG,[{id:DEFAULT_AI_DECISION_MODEL_CONFIG.toolIntentGate.model,enabled:false}])).toThrow();
    expect(()=>assertDecisionModelsAvailable(DEFAULT_AI_DECISION_MODEL_CONFIG,[{id:DEFAULT_AI_DECISION_MODEL_CONFIG.toolIntentGate.model,enabled:true}])).not.toThrow();
  });
});
