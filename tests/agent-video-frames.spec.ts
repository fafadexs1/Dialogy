import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
// @ts-ignore ffmpeg-static has platform-dependent types.
import ffmpegPath from 'ffmpeg-static';
import { extractVideoFrames } from '@/modules/nexus/services/video-frames';

describe('extração isolada de quadros', () => {
  it('falha fechada quando a imagem não foi configurada', async () => {
    vi.stubEnv('DIALOGY_AGENT_VIDEO_IMAGE', '');
    await expect(extractVideoFrames(Buffer.from('x'), new AbortController().signal)).rejects.toThrow(/não configurada/);
    vi.unstubAllEnvs();
  });
  it.skipIf(!process.env.DIALOGY_VIDEO_INTEGRATION_IMAGE)('extrai vídeo sintético em contêiner sem rede', async () => {
    if (!ffmpegPath) throw new Error('FFmpeg indisponível para gerar fixture.');
    const video = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=128x128:r=1:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { maxBuffer: 5_000_000 });
    vi.stubEnv('DIALOGY_AGENT_VIDEO_IMAGE', process.env.DIALOGY_VIDEO_INTEGRATION_IMAGE!);
    try {
      const result = await extractVideoFrames(video, new AbortController().signal);
      expect(result.frames.length).toBeGreaterThanOrEqual(1);
      expect(result.frames[0].subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    } finally { vi.unstubAllEnvs(); }
  }, 30000);
  it.skipIf(!process.env.DIALOGY_VIDEO_INTEGRATION_IMAGE)('amostra mudanças após o primeiro minuto de um vídeo real', async () => {
    if (!ffmpegPath) throw new Error('FFmpeg indisponível para gerar fixture.');
    const video = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=1:d=65', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=1:d=35', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-g', '10', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { maxBuffer: 5_000_000 });
    vi.stubEnv('DIALOGY_AGENT_VIDEO_IMAGE', process.env.DIALOGY_VIDEO_INTEGRATION_IMAGE!);
    try {
      const result = await extractVideoFrames(video, new AbortController().signal);
      expect(result.coverage).toBe('distributed'); expect(result.estimatedDurationSeconds).toBeGreaterThan(95);
      expect(result.sampleTimesSeconds.some(time => time > 65)).toBe(true);
      const sharp = (await import('sharp')).default;
      const { data } = await sharp(result.frames.at(-1)!).raw().toBuffer({ resolveWithObject: true });
      expect(data[0]).toBeGreaterThan(data[2] + 100);
    } finally { vi.unstubAllEnvs(); }
  }, 30000);
  it.skipIf(!process.env.DIALOGY_VIDEO_INTEGRATION_IMAGE)('sinaliza cobertura inicial quando o leitor de duração está indisponível', () => {
    if (!ffmpegPath) throw new Error('FFmpeg indisponível para gerar fixture.');
    const video = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=1:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { maxBuffer: 5_000_000 });
    const output = execFileSync('docker', ['run', '--rm', '--pull=never', '--network=none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=256m', '--cpus=1', '-e', 'FFPROBE_BINARY=/missing/ffprobe', '-i', process.env.DIALOGY_VIDEO_INTEGRATION_IMAGE!], { input: video, timeout: 25000, maxBuffer: 2_700_000 });
    const result = JSON.parse(output.toString());
    expect(result).toMatchObject({ coverage: 'initial', estimatedDurationSeconds: null, sampleTimesSeconds: [] });
    expect(result.frames.length).toBeGreaterThan(0);
  }, 30000);
  it.skipIf(!process.env.DIALOGY_VIDEO_INTEGRATION_IMAGE)('aceita vídeo WebM além de MP4', async () => {
    if (!ffmpegPath) throw new Error('FFmpeg indisponível para gerar fixture.');
    const video = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=64x64:r=1:d=4', '-c:v', 'libvpx', '-f', 'webm', 'pipe:1'], { maxBuffer: 5_000_000 });
    vi.stubEnv('DIALOGY_AGENT_VIDEO_IMAGE', process.env.DIALOGY_VIDEO_INTEGRATION_IMAGE!);
    try { expect((await extractVideoFrames(video, new AbortController().signal)).frames.length).toBeGreaterThan(0); }
    finally { vi.unstubAllEnvs(); }
  }, 30000);
});
