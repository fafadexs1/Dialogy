import { describe, expect, it, vi } from 'vitest';
import type { NodeRuntimeInput } from '@/services/workflow-runtime/types';
import { workflowDefinition, workflowNode } from './workflow-runtime-fixtures';
const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/modules/nexus/services/workflow-files', () => ({ loadWorkflowFile: mock.load, saveWorkflowFile: vi.fn(), workflowFileDownload: vi.fn() }));
import { generateToolboxDocument } from '@/modules/nexus/services/toolbox-documents';
import { executeToolboxMedia } from '@/modules/nexus/services/toolbox-media';
import { extractStudioKnowledgeFile } from '@/services/agent-studio/knowledge-file';

function runtime(workspaceId = 'workspace-a'): NodeRuntimeInput {
  const node = workflowNode('files.read', 'reader', { format: 'auto', file: { id: 'file' } });
  return { node, workflow: workflowDefinition([node], [], { workspaceId }), execution: { variables: {}, input: {}, context: {}, nodeResults: {} } as NodeRuntimeInput['execution'], input: {}, attachments: {}, emit: async () => undefined, signal: new AbortController().signal };
}

describe('leitura de apresentações PPTX', () => {
  it('lê conteúdo e ordem de slides de um PPTX real gerado pelo próprio Studio', async () => {
    const generated = await generateToolboxDocument('pptx', { slides: [{ title: 'Primeiro & único', text: 'Olá mundo' }, { title: 'Segundo', text: 'Conclusão' }] });
    const result = await extractStudioKnowledgeFile(new File([new Uint8Array(generated.data)], 'apresentação.pptx', { type: generated.mimeType }));
    expect(result.slides).toHaveLength(2);
    expect(result.slides?.[0].content).toContain('Primeiro & único');
    expect(result.slides?.[0].content).toContain('Olá mundo');
    expect(result.slides?.[1].content).toContain('Conclusão');
  });
  it('recupera PPTX por workspace e usa MIME quando extensão não é reconhecida', async () => {
    const generated = await generateToolboxDocument('pptx', { slides: [{ title: 'Resumo', text: 'Informação privada' }] });
    mock.load.mockResolvedValueOnce({ file: { name: 'arquivo.bin', mimeType: generated.mimeType }, data: generated.data });
    const result = await executeToolboxMedia(runtime('workspace-a'));
    expect(mock.load).toHaveBeenCalledWith('workspace-a', { id: 'file' });
    expect(result.output?.content).toContain('Informação privada');
  });
  it('recusa arquivo PPTX inválido', async () => {
    await expect(extractStudioKnowledgeFile(new File(['invalido'], 'falso.pptx'))).rejects.toThrow();
  });
  it('recusa ZIP com nome divergente entre diretório e cabeçalho local', async () => {
    const generated = await generateToolboxDocument('pptx', { slides: [{ title: 'Teste', text: 'Conteúdo' }] });
    const tampered = Buffer.from(generated.data);
    expect(tampered.readUInt32LE(0)).toBe(0x04034b50);
    tampered[30] = tampered[30] ^ 1;
    await expect(extractStudioKnowledgeFile(new File([new Uint8Array(tampered)], 'falso.pptx'))).rejects.toThrow(/inconsistente/);
  });
});
