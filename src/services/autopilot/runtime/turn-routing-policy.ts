export type AutopilotWorkflowExecutionMode =
  | 'continue_llm'
  | 'direct_response'
  | 'pre_response_tools';

export function shouldRunAutopilotKnowledgeRetrieval(input: {
  customerMessage: string | null | undefined;
  shouldRetrieveKnowledge: boolean;
  deterministicOperationalTurn: boolean;
}): boolean {
  return Boolean(
    input.shouldRetrieveKnowledge
    && !input.deterministicOperationalTurn
    && input.customerMessage
    && input.customerMessage.trim().length > 3,
  );
}

export function shouldSendDeterministicFlowResponse(input: {
  workflowExecutionMode: AutopilotWorkflowExecutionMode;
  workflowHandledByWorkflow: boolean;
  shouldPrioritizeTurnPlan: boolean;
}): boolean {
  return (
    !input.shouldPrioritizeTurnPlan
    && !input.workflowHandledByWorkflow
    && input.workflowExecutionMode !== 'continue_llm'
  );
}
