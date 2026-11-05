import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ model: vi.fn(), apiKey: vi.fn(), metered: vi.fn(), create: vi.fn(), usage: vi.fn() }));
vi.mock('@/services/ai/platform-config', () => ({ platformModel: mocks.model, platformApiKey: mocks.apiKey }));
vi.mock('@/services/ai/metered-call', () => ({ meteredAiCall: mocks.metered }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mocks.create } }; } }));
import { analyzePlatformVideoFrames } from '@/services/ai/platform-video';
afterEach(() => vi.resetAllMocks());

it('analisa quadros com modelo autorizado, cobrança e ressalva sobre áudio', async () => {
  mocks.model.mockResolvedValue({ id: 'openai/test-model', supportedMediaTypes: ['image'] });
  mocks.apiKey.mockResolvedValue('fake'); mocks.metered.mockImplementation(async args => args.execute(mocks.usage));
  mocks.create.mockResolvedValue({ choices: [{ message: { content: 'Uma pessoa.' } }], usage: { prompt_tokens: 42, completion_tokens: 12 } });
  expect(await analyzePlatformVideoFrames({ workspaceId: 'ws', prompt: 'Descreva', frames: [Buffer.from('jpeg')], signal: new AbortController().signal })).toBe('Uma pessoa.');
  expect(mocks.metered).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws', independent: true }));
  expect(mocks.usage).toHaveBeenCalledWith({ inputTokens: 42, outputTokens: 12 });
  const body = mocks.create.mock.calls[0][0];
  expect(body.messages[0].content[0].text).toContain('nem ouvido o áudio');
  expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
});

it('recusa modelo não declarado multimodal antes de chamar o provedor', async () => {
  mocks.model.mockResolvedValue({ id: 'openai/text-only', supportedMediaTypes: [] });
  await expect(analyzePlatformVideoFrames({ workspaceId: 'ws', prompt: 'teste', frames: [Buffer.from('x')], signal: new AbortController().signal })).rejects.toThrow(/imagens/);
  expect(mocks.create).not.toHaveBeenCalled();
});

it('informa ao modelo os alvos aproximados e a cobertura parcial sem prometer áudio', async () => {
  mocks.model.mockResolvedValue({ id: 'openai/test-model', supportedMediaTypes: ['image'] });
  mocks.apiKey.mockResolvedValue('fake'); mocks.metered.mockImplementation(async args => args.execute(mocks.usage));
  mocks.create.mockResolvedValue({ choices: [{ message: { content: 'Imagem.' } }] });
  await analyzePlatformVideoFrames({ workspaceId: 'ws', prompt: 'Descreva', frames: [Buffer.from('jpeg')], coverage: 'partial', estimatedDurationSeconds: 120, sampleTimesSeconds: [96], signal: new AbortController().signal });
  const text = mocks.create.mock.calls[0][0].messages[0].content[0].text;
  expect(text).toContain('120 segundos'); expect(text).toContain('[96]'); expect(text).toContain('extração foi parcial'); expect(text).toContain('nem ouvido o áudio');
});
