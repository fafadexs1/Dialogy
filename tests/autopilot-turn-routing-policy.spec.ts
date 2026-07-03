import { describe, expect, it } from 'vitest';

import {
  shouldRunAutopilotKnowledgeRetrieval,
  shouldSendDeterministicFlowResponse,
} from '@/services/autopilot/runtime/turn-routing-policy';

describe('autopilot LLM-first routing policy', () => {
  it('does not load RAG models for a turn whose resolved intent does not request knowledge', () => {
    expect(shouldRunAutopilotKnowledgeRetrieval({
      customerMessage: 'Ola, tudo bem?',
      shouldRetrieveKnowledge: false,
      deterministicOperationalTurn: false,
    })).toBe(false);
  });

  it('retrieves knowledge for a substantive LLM turn that requests it', () => {
    expect(shouldRunAutopilotKnowledgeRetrieval({
      customerMessage: 'Quais planos de internet voces oferecem?',
      shouldRetrieveKnowledge: true,
      deterministicOperationalTurn: false,
    })).toBe(true);
  });

  it('does not let a flow message bypass the LLM when the workflow selected continue_llm', () => {
    expect(shouldSendDeterministicFlowResponse({
      workflowExecutionMode: 'continue_llm',
      workflowHandledByWorkflow: false,
      shouldPrioritizeTurnPlan: false,
    })).toBe(false);
  });

  it('does not let a flow message override a response already handled by the workflow', () => {
    expect(shouldSendDeterministicFlowResponse({
      workflowExecutionMode: 'direct_response',
      workflowHandledByWorkflow: true,
      shouldPrioritizeTurnPlan: false,
    })).toBe(false);
  });

  it('keeps unhandled deterministic flow responses available', () => {
    expect(shouldSendDeterministicFlowResponse({
      workflowExecutionMode: 'direct_response',
      workflowHandledByWorkflow: false,
      shouldPrioritizeTurnPlan: false,
    })).toBe(true);
  });
});
