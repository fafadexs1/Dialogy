import 'server-only';

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ffmpeg from 'fluent-ffmpeg';
// @ts-ignore ffmpeg-static does not expose consistent types across platforms.
import ffmpegStaticPath from 'ffmpeg-static';
// @ts-ignore ffprobe-static exports an object containing the executable path.
import ffprobeStatic from 'ffprobe-static';

import { fetchSafeRemote, readResponseBodyLimited } from '@/lib/security/safe-remote-url';

const MAX_INPUT_BYTES = 32 * 1024 * 1024;
export const MAX_WHATSAPP_MEDIA_BYTES = 16 * 1024 * 1024;
const AUDIO_TIMEOUT_MS = 60_000;
const VIDEO_TIMEOUT_MS = 180_000;

export type NormalizedOutboundMedia = {
  media: string;
  mimetype: 'audio/mpeg' | 'video/mp4';
  fileName: string;
};

function configureFfmpeg() {
  const isWindows = process.platform === 'win32';
  const configuredFfmpeg = process.env.FFMPEG_PATH;
  const configuredFfprobe = process.env.FFPROBE_PATH;

  if (configuredFfmpeg && existsSync(configuredFfmpeg) && (isWindows || !/[\\:]/.test(configuredFfmpeg))) {
    ffmpeg.setFfmpegPath(configuredFfmpeg);
  } else if (!isWindows) {
    ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
  } else if (ffmpegStaticPath) {
    ffmpeg.setFfmpegPath(ffmpegStaticPath);
  }

  if (configuredFfprobe && existsSync(configuredFfprobe) && (isWindows || !/[\\:]/.test(configuredFfprobe))) {
    ffmpeg.setFfprobePath(configuredFfprobe);
  } else if (!isWindows) {
    ffmpeg.setFfprobePath('/usr/bin/ffprobe');
  } else if (ffprobeStatic?.path) {
    ffmpeg.setFfprobePath(ffprobeStatic.path);
  }
}

configureFfmpeg();

function cleanMime(mimetype: string | undefined): string {
  return String(mimetype || '').split(';')[0].trim().toLowerCase();
}

function extensionForInput(mimetype: string | undefined, fileName: string | undefined): string {
  const extension = fileName?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (extension) return extension;

  const mimeExtensions: Record<string, string> = {
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  };
  return mimeExtensions[cleanMime(mimetype)] || 'bin';
}

function outputFileName(fileName: string | undefined, extension: 'mp3' | 'mp4'): string {
  const now = new Date();
  const timestamp = now.getTime();
  const dateTime = now.toISOString()
    .replace('T', '_')
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '');
  const baseName = String(fileName || 'media')
    .replace(/\.[^/.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 80) || 'media';
  return `${baseName}_${dateTime}_${timestamp}.${extension}`;
}

async function sourceToBuffer(source: string): Promise<Buffer> {
  const trimmed = source.trim();
  if (!trimmed) throw new Error('Conteudo de midia vazio.');

  if (/^https?:\/\//i.test(trimmed)) {
    const response = await fetchSafeRemote(trimmed, { cache: 'no-store' }, {
      timeoutMs: 30_000,
      maxRedirects: 2,
    });
    if (!response.ok) {
      throw new Error(`Nao foi possivel baixar a midia para conversao (${response.status}).`);
    }
    return Buffer.from(await readResponseBodyLimited(response, MAX_INPUT_BYTES));
  }

  const base64 = trimmed.includes(',') ? trimmed.split(',').pop() || '' : trimmed;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('Conteudo base64 de midia invalido.');
  if (buffer.length > MAX_INPUT_BYTES) throw new Error('A midia excede o limite de 32 MB para conversao.');
  return buffer;
}

async function runFfmpeg(inputPath: string, outputPath: string, kind: 'audio' | 'video'): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const command = ffmpeg(inputPath);

    if (kind === 'audio') {
      command
        .noVideo()
        .audioCodec('libmp3lame')
        .audioChannels(1)
        .audioFrequency(48_000)
        .audioBitrate('64k')
        .format('mp3');
    } else {
      command
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioBitrate('96k')
        .outputOptions([
          '-preset veryfast',
          '-crf 28',
          '-pix_fmt yuv420p',
          '-movflags +faststart',
          '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2',
        ])
        .format('mp4');
    }

    const timeoutMs = kind === 'audio' ? AUDIO_TIMEOUT_MS : VIDEO_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      command.kill('SIGKILL');
      reject(new Error(`${kind === 'audio' ? 'Audio' : 'Video'} excedeu o tempo limite de conversao.`));
    }, timeoutMs);

    command
      .on('end', () => {
        clearTimeout(timeout);
        resolve();
      })
      .on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      })
      .save(outputPath);
  });
}

async function normalize(
  kind: 'audio' | 'video',
  source: string,
  mimetype?: string,
  fileName?: string,
): Promise<NormalizedOutboundMedia> {
  const inputBuffer = await sourceToBuffer(source);
  const id = randomUUID();
  const inputPath = path.join(os.tmpdir(), `dialogy-${id}-input.${extensionForInput(mimetype, fileName)}`);
  const outputExtension = kind === 'audio' ? 'mp3' : 'mp4';
  const outputPath = path.join(os.tmpdir(), `dialogy-${id}-output.${outputExtension}`);

  try {
    await fs.writeFile(inputPath, inputBuffer);
    await runFfmpeg(inputPath, outputPath, kind);
    const outputBuffer = await fs.readFile(outputPath);
    if (!outputBuffer.length) throw new Error('A conversao gerou um arquivo vazio.');
    if (outputBuffer.length > MAX_WHATSAPP_MEDIA_BYTES) {
      throw new Error(`${kind === 'audio' ? 'O audio' : 'O video'} convertido excede o limite de 16 MB do WhatsApp.`);
    }

    return {
      media: outputBuffer.toString('base64'),
      mimetype: kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
      fileName: outputFileName(fileName, outputExtension),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha ao preparar ${kind === 'audio' ? 'audio' : 'video'} para o WhatsApp: ${reason}`);
  } finally {
    await Promise.all([
      fs.unlink(inputPath).catch(() => undefined),
      fs.unlink(outputPath).catch(() => undefined),
    ]);
  }
}

export function normalizeAudioForWhatsApp(source: string, mimetype?: string, fileName?: string) {
  return normalize('audio', source, mimetype, fileName);
}

export function normalizeVideoForWhatsApp(source: string, mimetype?: string, fileName?: string) {
  return normalize('video', source, mimetype, fileName);
}
