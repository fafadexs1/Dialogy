import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/workflow/native-workflow-builder.tsx'),
  'utf8',
);

describe('native workflow agent editor usability contract', () => {
  it('keeps multiline instructions as a local draft and only normalizes on blur', () => {
    expect(source).toContain('function EditableStringList');
    expect(source).toContain('value={draft}');
    expect(source).toContain('onBlur={commit}');
    expect(source).not.toContain("value={arrayValue('instructions')}");
  });

  it('configures the common AI resources from the agent inspector', () => {
    expect(source).toContain('title="Recursos da IA"');
    expect(source).toContain('onModelChange={handleAgentModelChange}');
    expect(source).toContain('onConfigureKnowledge={handleConfigureAgentKnowledge}');
    expect(source).toContain('onToggleTool={handleToggleAgentTool}');
    expect(source).toContain('isNativeAgentToolAttachable');
    expect(source).toContain('connectedRetainedTools');
    expect(source).toContain('connectedToolNames.has(tool.name)');
    expect(source).toContain('Ferramentas permitidas');
    expect(source).toContain('data-testid="agent-tool-selection-count"');
    expect(source).toContain('data-testid="agent-tools-select-recommended"');
    expect(source).toContain('data-testid="agent-tools-select-all-eligible"');
    expect(source).toContain('data-testid="agent-tools-clear"');
    expect(source).toContain('data-testid={nativeAgentToolTestId(tool.name)}');
    expect(source).toContain('data-testid="agent-model-select"');
    expect(source).toContain('data-testid="agent-knowledge-configure"');
    expect(source).toContain('data-testid="agent-memory-toggle"');
    expect(source).toContain('data-testid="agent-guardrail-toggle"');
  });

  it('creates a complete agent bundle including knowledge by default', () => {
    expect(source).toContain('createPrivateAgentResourceBundle({ agent, position, model: defaultModel })');
    expect(source).not.toContain("currentNodes.find((node) => node.data.workflowNode.type === type)");
  });

  it('garbage-collects private attachments when tools, resources or agents are removed', () => {
    expect(source).toContain('detachWorkflowConnectionsAndPrune');
    expect(source).toContain('deleteWorkflowNodesAndPrivateAttachments');
    expect(source).toContain('pruneOrphanedWorkflowAttachments');
  });

  it('moves technical attachment blocks behind the advanced resources section', () => {
    expect(source).toContain('!manifest.attachment');
    expect(source).toContain('Recursos avançados');
  });
});
