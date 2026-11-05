import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const mocks = vi.hoisted(() => ({ request: vi.fn(), load: vi.fn(), save: vi.fn(), frames: vi.fn(), analyze: vi.fn() }));
vi.mock('@/modules/nexus/services/public-http', () => ({ requestPublicHttps: mocks.request }));
vi.mock('@/modules/nexus/services/workflow-files', () => ({ loadWorkflowFile: mocks.load, saveWorkflowFile: mocks.save }));
vi.mock('@/modules/nexus/services/video-frames', () => ({ extractVideoFrames: mocks.frames }));
vi.mock('@/services/ai/platform-video', () => ({ analyzePlatformVideoFrames: mocks.analyze }));
import { executeMediaAgentTool } from '@/modules/nexus/services/media-agent-tools';

const file = { kind: 'workflow_file', id: '123e4567-e89b-42d3-a456-426614174000', name: 'entrada.png', mimeType: 'image/png', size: 12 };
const signal = new AbortController().signal;
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function configure() { vi.stubEnv('DIALOGY_AGENT_MEDIA_ENDPOINT', 'https://media.example/v1'); vi.stubEnv('DIALOGY_AGENT_MEDIA_TOKEN', 'media-secret'); }

describe('ferramentas de mídia do agente', () => {
  it('falha sem serviço configurado e não chama a rede', async () => {
    vi.stubEnv('DIALOGY_AGENT_MEDIA_ENDPOINT', ''); vi.stubEnv('DIALOGY_AGENT_MEDIA_TOKEN', '');
    await expect(executeMediaAgentTool('tool.image', { prompt: 'crie uma paisagem' }, 'ws1', signal)).rejects.toThrow(/não configurado/);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('gera arquivo privado e valida os bytes devolvidos', async () => {
    configure();
    const image = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'red' } }).png().toBuffer();
    mocks.request.mockResolvedValueOnce({ headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ version: 1, mimeType: 'image/png', dataBase64: image.toString('base64') })) });
    mocks.save.mockResolvedValueOnce(file);
    expect(await executeMediaAgentTool('tool.image', { prompt: 'crie uma paisagem' }, 'ws1', signal)).toEqual({ file, width: 2, height: 3 });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws1', mimeType: 'image/png', data: image }));
    expect(JSON.parse(mocks.request.mock.calls[0][0].body)).toMatchObject({ action: 'generate_image' });
  });
  it('carrega edição do workspace e rejeita imagem adulterada', async () => {
    configure();
    mocks.load.mockResolvedValueOnce({ file, data: Buffer.from('source') });
    mocks.request.mockResolvedValueOnce({ headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ version: 1, mimeType: 'image/png', dataBase64: Buffer.from('not-an-image').toString('base64') })) });
    await expect(executeMediaAgentTool('tool.image', { prompt: 'altere', reference: file }, 'ws1', signal)).rejects.toThrow();
    expect(mocks.load).toHaveBeenCalledWith('ws1', file);
    expect(JSON.parse(mocks.request.mock.calls[0][0].body)).toMatchObject({ action: 'edit_image', image: { mimeType: 'image/png' } });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('analisa vídeo privado e protege o token', async () => {
    configure(); const video = { ...file, name: 'a.mp4', mimeType: 'video/mp4' };
    mocks.load.mockResolvedValueOnce({ file: video, data: Buffer.from('video') });
    mocks.request.mockResolvedValueOnce({ headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ version: 1, text: 'Análise media-secret' })) });
    expect(await executeMediaAgentTool('tool.video_analysis', { prompt: 'descreva', video }, 'ws2', signal)).toEqual({ text: 'Análise [protegido]' });
    expect(mocks.load).toHaveBeenCalledWith('ws2', video);
  });
  it('envia imagem privada para análise no mesmo escopo', async () => {
    configure();
    mocks.load.mockResolvedValueOnce({ file, data: Buffer.from('image') });
    mocks.request.mockResolvedValueOnce({ headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ version: 1, text: 'Uma imagem' })) });
    expect(await executeMediaAgentTool('tool.image_analysis', { prompt: 'descreva', image: file }, 'ws3', signal)).toEqual({ text: 'Uma imagem' });
    expect(JSON.parse(mocks.request.mock.calls[0][0].body)).toMatchObject({ action: 'analyze_image', image: { mimeType: 'image/png' } });
    expect(mocks.load).toHaveBeenCalledWith('ws3', file);
  });
  it('analisa quadros localmente no modelo da plataforma sem prometer áudio', async () => {
    vi.stubEnv('DIALOGY_AGENT_VIDEO_IMAGE', 'video:local');
    const video = { ...file, name: 'a.mp4', mimeType: 'video/mp4' };
    mocks.load.mockResolvedValueOnce({ file: video, data: Buffer.from('video') });
    mocks.frames.mockResolvedValueOnce({ frames: [Buffer.from('frame')], estimatedDurationSeconds: 100, sampleTimesSeconds: [0], coverage: 'distributed' }); mocks.analyze.mockResolvedValueOnce('Pessoa caminha.');
    expect(await executeMediaAgentTool('tool.video_analysis', { prompt: 'descreva', video }, 'ws2', signal)).toMatchObject({ text: 'Pessoa caminha.', framesAnalyzed: 1, coverage: 'distributed', estimatedDurationSeconds: 100, sampleTimesSeconds: [0], audioAnalyzed: false });
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws2', frames: [Buffer.from('frame')] }));
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
