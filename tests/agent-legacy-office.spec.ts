import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { NodeRuntimeInput } from '@/services/workflow-runtime/types';
import { workflowDefinition, workflowNode } from './workflow-runtime-fixtures';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), download: vi.fn() }));
vi.mock('@/modules/nexus/services/workflow-files', () => ({ loadWorkflowFile: mocks.load, saveWorkflowFile: mocks.save, workflowFileDownload: mocks.download }));
import { convertLegacyOffice } from '@/modules/nexus/services/legacy-office';
import { executeToolboxMedia } from '@/modules/nexus/services/toolbox-media';
import { extractStudioKnowledgeFile } from '@/services/agent-studio/knowledge-file';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const legacyDoc = () => readFileSync('tests/fixtures/studio-knowledge-legacy.doc');
const legacyXls = () => readFileSync('tests/fixtures/studio-knowledge-legacy.xls');
const testImage = process.env.DIALOGY_LEGACY_OFFICE_TEST_IMAGE;
function runtime(): NodeRuntimeInput {
  const node = workflowNode('files.read', 'reader', { format: 'auto', file: {} });
  return { node, workflow: workflowDefinition([node], [], { workspaceId: 'ws' }), execution: { variables: {}, input: {}, context: {}, nodeResults: {} } as NodeRuntimeInput['execution'], input: {}, attachments: {}, emit: async () => undefined, signal: new AbortController().signal };
}

describe('documentos Office legados', () => {
  it('recusa conversão sem imagem configurada ou assinatura Office', async () => {
    vi.stubEnv('DIALOGY_LEGACY_OFFICE_IMAGE', '');
    await expect(convertLegacyOffice(legacyDoc(), 'doc')).rejects.toThrow(/não configurado/);
    vi.stubEnv('DIALOGY_LEGACY_OFFICE_IMAGE', 'dialogy-agent-legacy-office:local');
    await expect(convertLegacyOffice(Buffer.from('não é Office'), 'doc')).rejects.toThrow(/inválido/);
  });
  it.skipIf(!testImage)('importa DOC e XLS reais como fontes de conhecimento', async () => {
    vi.stubEnv('DIALOGY_LEGACY_OFFICE_IMAGE', testImage!);
    const doc = await extractStudioKnowledgeFile(new File([legacyDoc()], 'politica.doc'));
    const xls = await extractStudioKnowledgeFile(new File([legacyXls()], 'relatorio.xls'));
    expect(doc.content).toContain('Atendimento de segunda a sexta.');
    expect(doc.mimeType).toBe('application/msword');
    expect(xls.content.length).toBeGreaterThan(20);
    expect(xls.mimeType).toBe('application/vnd.ms-excel');
  }, 90000);
  it.skipIf(!testImage)('lê DOC e XLS reais do arquivo privado por workspace', async () => {
    vi.stubEnv('DIALOGY_LEGACY_OFFICE_IMAGE', testImage!);
    mocks.load.mockResolvedValueOnce({ file: { name: 'politica.doc', mimeType: 'application/msword' }, data: legacyDoc() });
    expect((await executeToolboxMedia(runtime())).output).toMatchObject({ content: 'Atendimento de segunda a sexta.' });
    mocks.load.mockResolvedValueOnce({ file: { name: 'sem-extensao', mimeType: 'application/vnd.ms-excel' }, data: legacyXls() });
    const result = await executeToolboxMedia(runtime());
    expect(Array.isArray(result.output?.items)).toBe(true);
    expect((result.output?.items as unknown[]).length).toBeGreaterThan(0);
  }, 90000);
});
