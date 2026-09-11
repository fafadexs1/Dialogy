import { describe, expect, it } from 'vitest';
import { changedCrmFields } from '@/modules/nexus/services/crm-option-trigger';
import { nexusInternalEventTriggerMatches } from '@/modules/nexus/services/internal-event-dispatcher';
import { createStandaloneNexusWorkflow } from '@/modules/nexus/services/standalone-workflows';
import { InMemoryWorkflowPersistence, WorkflowExecutor, createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';

const config = { eventName: 'contact.updated', crmOption: { fieldId: 'contract', value: 'Assinou' } };

describe('CRM option triggers', () => {
  it('runs only on an exact changed option after a save', () => {
    const payload = { changedFields: changedCrmFields({ contract: 'Não assinou' }, { contract: 'Assinou' }) };
    expect(nexusInternalEventTriggerMatches(config, 'contact.updated', payload)).toBe(true);
    expect(nexusInternalEventTriggerMatches(config, 'contact.updated', { changedFields: { contract: 'Não assinou' } })).toBe(false);
    expect(nexusInternalEventTriggerMatches(config, 'contact.updated', { changedFields: changedCrmFields({ contract: 'Assinou' }, { contract: 'Assinou' }) })).toBe(false);
    expect(nexusInternalEventTriggerMatches(config, 'contact.updated', { changedFields: { other: 'Assinou' } })).toBe(false);
    expect(nexusInternalEventTriggerMatches(config, 'chat.closed', payload)).toBe(false);
    expect(nexusInternalEventTriggerMatches(config, 'contact.updated', {})).toBe(false);
  });

  it('accepts a newly created contact and preserves ordinary internal events', () => {
    expect(nexusInternalEventTriggerMatches(config, 'contact.created', { changedFields: changedCrmFields({}, { contract: 'Assinou' }) })).toBe(true);
    expect(nexusInternalEventTriggerMatches({ eventName: 'chat.closed' }, 'chat.closed')).toBe(true);
    expect(nexusInternalEventTriggerMatches({ crmOption: null }, 'contact.updated')).toBe(false);
  });

  it('executes the conventional Nexus graph without an AI agent or conversation', async () => {
    const workflow = createStandaloneNexusWorkflow({ id: 'crm-test', workspaceId: 'workspace-a', name: 'Assinatura', template: 'crm_option', crmOption: config.crmOption });
    expect(validateWorkflowDefinition(workflow).valid).toBe(true);
    const executor = new WorkflowExecutor(new InMemoryWorkflowPersistence(), createDefaultNodeHandlerRegistry());
    const execution = await executor.start({ workflow, input: { contactId: 'contact-a', changedFields: { contract: 'Assinou' } } });
    expect(execution.status).toBe('completed');
    expect(execution.nodeResults.crm_option?.selectedOutput).toBe('event');
    expect(execution.previousNodeId).toBe('crm_end');
  });

  it('rejects publication when the option has not been configured', () => {
    const workflow = createStandaloneNexusWorkflow({ id: 'crm-test', workspaceId: 'workspace-a', name: 'Assinatura', template: 'crm_option' });
    expect(validateWorkflowDefinition(workflow).valid).toBe(false);
  });
});
