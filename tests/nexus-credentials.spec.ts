import { describe, expect, it, vi } from 'vitest';

import { validateNexusWorkflowCredentialBindings } from '@/modules/nexus/services/credentials';
import { createWorkflowNode } from '@/services/workflow-runtime';
import { linearWorkflow } from './workflow-runtime-fixtures';

function workflowWithCredential(credentialId: string, required = true) {
  const workflow = linearWorkflow();
  workflow.nodes.push(createWorkflowNode('tool.http', {
    id: 'discord-tool',
    position: { x: 0, y: 0 },
    config: { credentialId, credentialRequired: required },
  }));
  return workflow;
}

describe('Nexus credential bindings', () => {
  it('reports required tool credentials that were not selected', async () => {
    const database = { query: vi.fn() };
    const result = await validateNexusWorkflowCredentialBindings({
      workspaceId: 'workspace-1',
      definition: workflowWithCredential(''),
      database: database as never,
    });
    expect(result).toEqual({
      valid: false,
      missingRequiredNodeIds: ['discord-tool'],
      unknownCredentialIds: [],
    });
    expect(database.query).not.toHaveBeenCalled();
  });

  it('rejects credentials outside the workspace', async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await validateNexusWorkflowCredentialBindings({
      workspaceId: 'workspace-1',
      definition: workflowWithCredential('foreign-credential'),
      database: database as never,
    });
    expect(result).toEqual({
      valid: false,
      missingRequiredNodeIds: [],
      unknownCredentialIds: ['foreign-credential'],
    });
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('workspace_id = $1'), [
      'workspace-1',
      ['foreign-credential'],
    ]);
  });

  it('accepts a credential stored in the same workspace', async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'discord-credential' }] }) };
    await expect(validateNexusWorkflowCredentialBindings({
      workspaceId: 'workspace-1',
      definition: workflowWithCredential('discord-credential'),
      database: database as never,
    })).resolves.toEqual({
      valid: true,
      missingRequiredNodeIds: [],
      unknownCredentialIds: [],
    });
  });
});
