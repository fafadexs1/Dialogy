import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// @ts-ignore ffmpeg-static has no stable cross-platform declaration.
import ffmpegPath from 'ffmpeg-static';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_WHATSAPP_MEDIA_BYTES,
  normalizeAudioForWhatsApp,
  normalizeVideoForWhatsApp,
} from '@/services/whatsapp/normalize-outbound-media';

const temporaryFiles: string[] = [];

function silentWavBase64(durationMs = 100): string {
  const sampleRate = 8_000;
  const samples = Math.ceil(sampleRate * durationMs / 1_000);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer.toString('base64');
}

afterEach(() => {
  for (const file of temporaryFiles.splice(0)) fs.rmSync(file, { force: true });
});

describe('WhatsApp outbound media normalization', () => {
  it('converts recorded audio to an MP3 contract understood by Evolution and Meta', async () => {
    const result = await normalizeAudioForWhatsApp(silentWavBase64(), 'audio/wav', 'audio_gravado.webm');
    const output = Buffer.from(result.media, 'base64');

    expect(result.mimetype).toBe('audio/mpeg');
    expect(result.fileName).toMatch(/^audio_gravado_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_\d+\.mp3$/);
    expect(output.length).toBeGreaterThan(0);
    expect(output.length).toBeLessThanOrEqual(MAX_WHATSAPP_MEDIA_BYTES);
  });

  it('transcodes WebM video to MP4/H.264-compatible output', async () => {
    const inputPath = path.join(os.tmpdir(), `dialogy-test-${Date.now()}.webm`);
    temporaryFiles.push(inputPath);
    if (!ffmpegPath) throw new Error('ffmpeg-static nao esta disponivel para o teste.');
    execFileSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=0.2',
      '-c:v', 'libvpx-vp9', '-an', '-y', inputPath,
    ]);

    const result = await normalizeVideoForWhatsApp(
      fs.readFileSync(inputPath).toString('base64'),
      'video/webm',
      'gravacao.webm',
    );
    const output = Buffer.from(result.media, 'base64');

    expect(result.mimetype).toBe('video/mp4');
    expect(result.fileName).toMatch(/^gravacao_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_\d+\.mp4$/);
    expect(output.subarray(4, 8).toString('ascii')).toBe('ftyp');
    expect(output.length).toBeLessThanOrEqual(MAX_WHATSAPP_MEDIA_BYTES);
  });

  it('normalizes an MP4 input without attempting an in-place conversion', async () => {
    const inputPath = path.join(os.tmpdir(), `dialogy-test-${Date.now()}.mp4`);
    temporaryFiles.push(inputPath);
    if (!ffmpegPath) throw new Error('ffmpeg-static nao esta disponivel para o teste.');
    execFileSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:d=0.2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-y', inputPath,
    ]);

    const result = await normalizeVideoForWhatsApp(
      fs.readFileSync(inputPath).toString('base64'),
      'video/mp4',
      'video-original.mp4',
    );

    expect(result.mimetype).toBe('video/mp4');
    expect(result.fileName).toMatch(/^video-original_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_\d+\.mp4$/);
    expect(Buffer.from(result.media, 'base64').subarray(4, 8).toString('ascii')).toBe('ftyp');
  });
});
