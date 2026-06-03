import type { UniversalAutopilotIntent } from '@/services/autopilot/intent-types';

export type AiWorkflowClassifierInput = {
  customerMessage: string;
  [key: string]: unknown;
};

export type AiWorkflowDecision = {
  shouldUseTools: boolean;
  needsCustomerIdentifier: boolean;
  suggestedTools: string[];
  confidence: number;
  reason: string;
};

export function shouldUseAiWorkflowClassifier(_input: {
  intent: UniversalAutopilotIntent;
  confidence: number;
  executionMode: string;
  plannedActions: string[];
  missingSlots: string[];
  enabledToolNames: string[];
  hasCustomerIdentifier: boolean;
  customerMessage?: string;
}) {
  return false;
}

export async function classifyAutopilotWorkflowWithAi(_input: AiWorkflowClassifierInput): Promise<AiWorkflowDecision> {
  return {
    shouldUseTools: false,
    needsCustomerIdentifier: false,
    suggestedTools: [],
    confidence: 0,
    reason: 'universal_workflow_classifier_disabled',
  };
}
