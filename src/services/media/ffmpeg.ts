import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// @ts-ignore ffmpeg-static has platform-dependent typings.
import ffmpegStaticPath from 'ffmpeg-static';

function resolveFfmpegPath(): string {
  const configuredPath = process.env.FFMPEG_PATH?.trim();
  const isWindows = process.platform === 'win32';

  if (configuredPath && (isWindows || !/[\\:]/.test(configuredPath)) && existsSync(configuredPath)) {
    return configuredPath;
  }

  if (!isWindows && existsSync('/usr/bin/ffmpeg')) return '/usr/bin/ffmpeg';
  if (ffmpegStaticPath) return ffmpegStaticPath;
  return 'ffmpeg';
}

export async function runFfmpeg(input: {
  inputPath: string;
  outputPath: string;
  args: string[];
  timeoutMs: number;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      /*turbopackIgnore: true*/ resolveFfmpegPath(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-i',
        input.inputPath,
        ...input.args,
        input.outputPath,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`FFmpeg timed out after ${input.timeoutMs}ms.`));
    }, input.timeoutMs);

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${chunk}`.slice(-2_000);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const detail = stderr.trim();
      finish(new Error(`FFmpeg exited with ${signal || `code ${code}`}${detail ? `: ${detail}` : '.'}`));
    });
  });
}
