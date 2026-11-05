import { describe, expect, it, vi } from 'vitest';
import type { WorkflowExecution } from '@/services/workflow-runtime/types';
import { workflowDefinition } from './workflow-runtime-fixtures';

const media = vi.hoisted(() => vi.fn());
vi.mock('@/modules/nexus/services/toolbox-media', () => ({ executeToolboxMedia: media }));
import { createNexusToolRegistry } from '@/modules/nexus/services/tool-registry';
import { createWorkflowNode } from '@/services/workflow-runtime/catalog';

describe('documentos como ferramentas do agente', () => {
  it('expõe apenas ferramentas conectadas e encaminha entrada validada ao executor do workspace', async () => {
    const node = createWorkflowNode('tool.document_write', { id: 'document', position: { x: 0, y: 0 } });
    const workflow = workflowDefinition([node], [], { workspaceId: 'workspace' });
    const registry = createNexusToolRegistry({ workspaceId: 'workspace', toolNodes: [node] });
    const definition = registry.get('generate_document')!;
    expect(registry.list().map((entry) => entry.name)).toEqual(['generate_document']);
    media.mockResolvedValue({ status: 'success', output: { id: 'file' } });
    const context = { execution: {} as WorkflowExecution, workflow, node, signal: new AbortController().signal, idempotencyKey: 'one' };
    expect(await definition.execute({ format: 'pdf', source: { text: 'Olá' } }, context)).toEqual({ id: 'file' });
    expect(media).toHaveBeenCalledWith(expect.objectContaining({ workflow, node: expect.objectContaining({ type: 'files.write', config: { format: 'pdf', source: { text: 'Olá' }, outputKey: 'result' } }) }), { format: 'pdf', source: { text: 'Olá' }, outputKey: 'result' });
    await expect(definition.execute({ format: 'exe', source: 'x' }, context)).rejects.toThrow();
  });
  it('usa a credencial e a voz configuradas ao gerar fala', async () => {
    const node = createWorkflowNode('tool.text_to_speech', { id: 'speech', position: { x: 0, y: 0 }, config: { voiceId: 'voice_1', credentialId: 'credential_1' } });
    const workflow = workflowDefinition([node], [], { workspaceId: 'workspace' });
    const definition = createNexusToolRegistry({ workspaceId: 'workspace', toolNodes: [node] }).get('text_to_speech')!;
    media.mockResolvedValue({ status: 'success', output: { id: 'audio' } });
    const context = { execution: {} as WorkflowExecution, workflow, node, signal: new AbortController().signal, idempotencyKey: 'one' };
    await definition.execute({ text: 'Olá' }, context);
    expect(media).toHaveBeenLastCalledWith(expect.objectContaining({ node: expect.objectContaining({ type: 'audio.elevenlabs' }) }), expect.objectContaining({ text: 'Olá', voiceId: 'voice_1', credentialId: 'credential_1' }));
    await expect(definition.execute({ text: 'Olá', credentialId: 'other' }, context)).rejects.toThrow();
  });
});
