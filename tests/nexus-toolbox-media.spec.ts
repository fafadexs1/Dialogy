import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { NodeRuntimeInput } from '@/services/workflow-runtime/types';
import { workflowNode, workflowDefinition } from './workflow-runtime-fixtures';
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), download: vi.fn(), http: vi.fn(), credential: vi.fn(), media: vi.fn(), transcribe: vi.fn() }));
vi.mock('@/modules/nexus/services/workflow-files', () => ({ loadWorkflowFile: mocks.load, saveWorkflowFile: mocks.save, workflowFileDownload: mocks.download }));
vi.mock('@/modules/nexus/services/public-http', () => ({ requestPublicHttps: mocks.http }));
vi.mock('@/modules/nexus/services/credentials', () => ({ loadNexusCredentialPayload: mocks.credential }));
vi.mock('@/services/ai/platform-media', () => ({ requestPlatformMedia: mocks.media }));
vi.mock('@/services/audio/transcription-service', () => ({ transcribePrivateAudioWithWhisper: mocks.transcribe }));
import { executeToolboxMedia } from '@/modules/nexus/services/toolbox-media';
import { assertBoundedSpreadsheetArchive } from '@/modules/nexus/services/spreadsheet-limits';
const ref = { kind: 'workflow_file', id: '60000000-0000-4000-8000-000000000001', name: 'audio.mp3', mimeType: 'audio/mpeg', size: 4 };
function runtime(type: string, config: Record<string, unknown>): NodeRuntimeInput {
  const node = workflowNode(type, 'toolbox', config);
  return { node, workflow: workflowDefinition([node], [], { workspaceId: 'workspace' }), execution: { variables: {}, input: {}, context: {}, nodeResults: {} } as NodeRuntimeInput['execution'], input: {}, attachments: {}, emit: async () => undefined, signal: new AbortController().signal };
}
beforeEach(() => { vi.resetAllMocks(); mocks.save.mockResolvedValue(ref); });
describe('workflow audio and document operations', () => {
  it('uses ElevenLabs through binary HTTP without returning the API key', async () => {
    mocks.credential.mockResolvedValue({ type: 'api_key', payload: { value: 'secret-key' } }); mocks.http.mockResolvedValue({ status:200, headers:{'content-type':'audio/mpeg'},body:Buffer.from('ID3audio') });
    const result = await executeToolboxMedia(runtime('audio.elevenlabs', { text: 'Olá!', voiceId: 'voice_1', credentialId: 'credential' }));
    expect(mocks.http.mock.calls[0][0]).toMatchObject({ url:'https://api.elevenlabs.io/v1/text-to-speech/voice_1?output_format=mp3_44100_128',headers: { 'xi-api-key': 'secret-key' } });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({workspaceId:'workspace',name:'voz.mp3',mimeType:'audio/mpeg',data:Buffer.from('ID3audio')}));
    expect(result.output).toEqual(ref); expect(JSON.stringify(result)).not.toContain('secret-key');
  });
  it('rejects empty credentials and non-audio ElevenLabs responses without storing a file',async()=>{
    mocks.credential.mockResolvedValueOnce({type:'api_key',payload:{value:''}});
    await expect(executeToolboxMedia(runtime('audio.elevenlabs',{text:'Olá',voiceId:'voice_1',credentialId:'credential'}))).rejects.toThrow('credencial');
    expect(mocks.http).not.toHaveBeenCalled();
    mocks.credential.mockResolvedValueOnce({type:'api_key',payload:{value:'secret'}});mocks.http.mockResolvedValueOnce({status:200,headers:{'content-type':'application/json'},body:Buffer.from('{}')});
    await expect(executeToolboxMedia(runtime('audio.elevenlabs',{text:'Olá',voiceId:'voice_1',credentialId:'credential'}))).rejects.toThrow('MP3');expect(mocks.save).not.toHaveBeenCalled();
  });
  it('transcribes only a canonical private audio file', async () => {
    mocks.load.mockResolvedValue({ file: ref, data: Buffer.from('audio') }); mocks.transcribe.mockResolvedValue('Gostaria do plano de 500 mega.');
    expect((await executeToolboxMedia(runtime('audio.transcribe', { file: ref }))).output).toEqual({ text: 'Gostaria do plano de 500 mega.' });
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.objectContaining({data:Buffer.from('audio'),mimeType:'audio/mpeg',scope:expect.stringContaining('workspace:workspace:workflow:')}));expect(mocks.download).not.toHaveBeenCalled();
    mocks.load.mockResolvedValue({ file: { ...ref, mimeType: 'text/plain' }, data:Buffer.from('text') });
    await expect(executeToolboxMedia(runtime('audio.transcribe', { file: ref }))).rejects.toThrow('áudio');
  });
  it('generates CSV with spreadsheet formulas escaped', async () => {
    await executeToolboxMedia(runtime('files.write', { format: 'csv', source: [{ name: '=HYPERLINK("https://evil.test")', total: 10 }] }));
    expect(mocks.save.mock.calls[0][0].data.toString()).toContain("'=HYPERLINK");
  });
  it('does not expand model-supplied document contents as workflow templates', async () => {
    const input = runtime('files.write', {});
    input.execution.variables = { secret: 'do-not-copy' };
    await executeToolboxMedia(input, { format: 'txt', source: '{{variables.secret}}' });
    expect(mocks.save.mock.calls[0][0].data.toString()).toBe('{{variables.secret}}');
  });
  it('generates PDF, DOCX, XLSX and PPTX as private files', async () => {
    for (const [format, source] of [
      ['pdf', { text: 'Relatório de atendimento' }],
      ['docx', { text: 'Documento de atendimento' }],
      ['xlsx', [{ nome: 'Maria', valor: 42 }]],
      ['pptx', { slides: [{ title: 'Resumo', text: 'Resultados do período' }] }],
    ] as const) {
      await executeToolboxMedia(runtime('files.write', { format, source, fileName: 'resultado.json' }));
      const saved = mocks.save.mock.calls.at(-1)?.[0];
      expect(saved.name).toBe(`resultado.${format}`);
      expect(saved.data.subarray(0, format === 'pdf' ? 5 : 2).toString()).toBe(format === 'pdf' ? '%PDF-' : 'PK');
      if (format === 'docx') {
        const { default: mammoth } = await import('mammoth');
        expect((await mammoth.extractRawText({ buffer: saved.data })).value).toContain('Documento de atendimento');
      }
      if (format === 'xlsx') {
        const { default: readExcel } = await import('read-excel-file/universal');
        const sheets = await readExcel(new Uint8Array(saved.data).buffer);
        expect(sheets[0].data).toEqual([['nome', 'valor'], ['Maria', 42]]);
      }
      if (format === 'pptx') {
        const JSZip = (await import('jszip')).default;
        const archive = await JSZip.loadAsync(saved.data);
        expect(await archive.file('ppt/slides/slide1.xml')!.async('string')).toContain('Resultados do período');
      }
      if (format === 'pdf') {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const task = pdfjs.getDocument({ data: new Uint8Array(saved.data), useSystemFonts: true });
        const pdf = await task.promise;
        const content = await (await pdf.getPage(1)).getTextContent();
        expect(content.items.map((item) => 'str' in item ? item.str : '').join('')).toContain('Relatório de atendimento');
        await task.destroy();
      }
    }
  });
  it('reads CSV and preserves column names', async () => {
    mocks.load.mockResolvedValue({ file: { ...ref, name: 'leads.csv', mimeType: 'text/csv' }, data: Buffer.from('nome,plano\nMaria,500\nJoão,300') });
    expect((await executeToolboxMedia(runtime('files.read', { file: ref }))).output).toEqual({ items: [{ nome: 'Maria', plano: '500' }, { nome: 'João', plano: '300' }] });
  });
  it('reads a Word document from the workspace file store', async () => {
    mocks.load.mockResolvedValue({ file: { ...ref, name: 'politica.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, data: readFileSync('tests/fixtures/studio-knowledge.docx') });
    const result = await executeToolboxMedia(runtime('files.read', { file: ref }));
    expect(result.output).toMatchObject({ content: 'Atendimento de segunda a sexta.' });
  });
  it('detects a downloaded document by MIME type when the private file has no extension', async () => {
    mocks.load.mockResolvedValue({ file: { ...ref, name: 'arquivo-drive', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, data: readFileSync('tests/fixtures/studio-knowledge.docx') });
    expect((await executeToolboxMedia(runtime('files.read', { file: ref }))).output).toMatchObject({ content: 'Atendimento de segunda a sexta.' });
  });
  it('preflights a real XLSX fixture and rejects non-ZIP content', () => {
    expect(() => assertBoundedSpreadsheetArchive(readFileSync('tests/fixtures/campaign-sgp-report.xlsx'))).not.toThrow();
    expect(() => assertBoundedSpreadsheetArchive(Buffer.from('not excel'))).toThrow('XLSX');
  });
  it('reports unavailable multimodal capabilities without changing provider', async () => {
    mocks.load.mockResolvedValue({ file: { ...ref, mimeType: 'application/pdf' }, data: Buffer.from('%PDF') }); mocks.media.mockRejectedValue(new Error('O modelo da plataforma não suporta este tipo de mídia.'));
    await expect(executeToolboxMedia(runtime('media.analyze', { file: ref }))).rejects.toThrow('não suporta');
    expect(mocks.media).toHaveBeenCalledTimes(1);
  });
});
