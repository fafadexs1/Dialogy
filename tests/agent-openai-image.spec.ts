import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), edit: vi.fn(), toFile: vi.fn(), apiKey: vi.fn(), reserve: vi.fn(), usage: vi.fn() }));
vi.mock('@/services/ai/platform-config', () => ({ platformApiKey: mocks.apiKey }));
vi.mock('@/services/ai/metered-call', () => ({ meteredAiCall: mocks.reserve }));
vi.mock('openai', () => ({ default: class { images = { generate: mocks.generate, edit: mocks.edit }; }, toFile: mocks.toFile }));
import { generateOpenAiAgentImage } from '@/modules/nexus/services/openai-image-agent';

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('imagens OpenAI do agente', () => {
  it('recusa modelo não explicitamente configurado', async () => {
    vi.stubEnv('DIALOGY_AGENT_OPENAI_IMAGE_MODEL', '');
    await expect(generateOpenAiAgentImage({ workspaceId: 'ws', prompt: 'teste', signal: new AbortController().signal })).rejects.toThrow(/modelo/);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('reserva créditos e registra uso ao gerar', async () => {
    vi.stubEnv('DIALOGY_AGENT_OPENAI_IMAGE_MODEL', 'openai/gpt-image-1');
    mocks.apiKey.mockResolvedValue('fake-key');
    mocks.reserve.mockImplementation(async (args) => args.execute(mocks.usage));
    mocks.generate.mockResolvedValue({ usage: { input_tokens: 5, output_tokens: 20 }, data: [{ b64_json: 'aGVsbG8=' }] });
    expect(await generateOpenAiAgentImage({ workspaceId: 'ws', prompt: 'uma casa', signal: new AbortController().signal })).toMatchObject({ dataBase64: 'aGVsbG8=' });
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws', model: 'openai/gpt-image-1', independent: true }));
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-image-1', n: 1, quality: 'low' }), expect.anything());
    expect(mocks.usage).toHaveBeenCalledWith({ inputTokens: 5, outputTokens: 20 });
  });
  it('envia a referência somente para edição', async () => {
    vi.stubEnv('DIALOGY_AGENT_OPENAI_IMAGE_MODEL', 'openai/gpt-image-1');
    mocks.apiKey.mockResolvedValue('fake-key'); mocks.reserve.mockImplementation(async (args) => args.execute(mocks.usage)); mocks.toFile.mockResolvedValue('upload');
    mocks.edit.mockResolvedValue({ usage: { input_tokens: 8, output_tokens: 20 }, data: [{ b64_json: 'aGVsbG8=' }] });
    await generateOpenAiAgentImage({ workspaceId: 'ws', prompt: 'edite', image: { data: Buffer.from('image'), mimeType: 'image/png' }, signal: new AbortController().signal });
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({ image: 'upload' }), expect.anything());
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
