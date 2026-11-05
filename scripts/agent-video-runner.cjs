// Runs inside a disposable networkless container; the input and temporary file are untrusted.
const { spawn } = require('node:child_process');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');

async function run(command, args, timeout, outputLimit) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let size = 0; let error = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > outputLimit) child.kill('SIGKILL'); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(0, 500); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => { clearTimeout(timer); if (timedOut || code !== 0 || size > outputLimit) reject(new Error(error || 'Não foi possível processar o vídeo.')); else resolve(Buffer.concat(chunks)); });
  });
}

function jpegFrames(data) {
  const result = []; let start = 0;
  while (start < data.length) {
    if (data[start] !== 0xff || data[start + 1] !== 0xd8) throw new Error('Quadro JPEG inválido.');
    const end = data.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    if (end < 0) throw new Error('Quadro JPEG incompleto.');
    result.push(data.subarray(start, end + 2).toString('base64')); start = end + 2;
  }
  return result;
}

async function main() {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; if (size > 5_000_000) throw new Error('Vídeo excede 5 MB.'); chunks.push(chunk); }
  if (!size) throw new Error('Vídeo vazio.');
  const directory = await mkdtemp('/tmp/dialogy-video-');
  try {
    const file = join(directory, 'input'); await writeFile(file, Buffer.concat(chunks), { mode: 0o600 });
    const common = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm'];
    let duration = null; let rate = null;
    try {
      const metadata = JSON.parse((await run(process.env.FFPROBE_BINARY || 'ffprobe', ['-v', 'error', ...common, '-show_entries', 'format=duration:stream=codec_type,duration,avg_frame_rate', '-of', 'json', file], 4000, 64_000)).toString('utf8'));
      const video = Array.isArray(metadata.streams) ? metadata.streams.find(stream => stream.codec_type === 'video') : undefined;
      const candidate = Number(video?.duration || metadata.format?.duration);
      if (Number.isFinite(candidate) && candidate > 0 && candidate <= 21600) duration = candidate;
      const match = /^(\d+)\/(\d+)$/.exec(String(video?.avg_frame_rate || ''));
      if (match && Number(match[1]) > 0 && Number(match[2]) > 0) rate = Number(match[1]) / Number(match[2]);
    } catch { /* Unknown duration uses the bounded initial-window fallback below. */ }
    if (duration !== null) {
      const end = Math.max(0, duration - Math.max(0.1, rate ? 1 / rate : 0.5));
      const targets = [0, .2, .4, .6, .8, 1].map(part => Math.round(end * part * 1000) / 1000).filter((value, index, values) => index === 0 || value > values[index - 1]);
      const frames = []; const sampleTimesSeconds = []; const deadline = Date.now() + 19000; let frameBytes = 0;
      for (const target of targets) {
        const remaining = deadline - Date.now(); if (remaining <= 0) throw new Error('Extração de quadros excedeu o tempo limite.');
        const output = await run(process.env.FFMPEG_BINARY || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', ...common, '-ss', String(target), '-threads', '1', '-i', file, '-an', '-vf', 'scale=640:640:force_original_aspect_ratio=decrease', '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '5', '-f', 'image2pipe', 'pipe:1'], remaining, 750_000);
        frameBytes += output.length; if (frameBytes > 2_000_000) throw new Error('Os quadros excedem o limite de tamanho.');
        const parsed = jpegFrames(output);
        if (parsed.length === 1) { frames.push(parsed[0]); sampleTimesSeconds.push(target); }
      }
      if (!frames.length) throw new Error('Não há quadros de vídeo válidos.');
      return { frames, estimatedDurationSeconds: duration, sampleTimesSeconds, coverage: sampleTimesSeconds.length === targets.length ? 'distributed' : 'partial' };
    }
    const output = await run(process.env.FFMPEG_BINARY || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', ...common, '-threads', '1', '-i', file, '-t', '60', '-an', '-vf', 'fps=1/10:start_time=0:round=up,scale=640:640:force_original_aspect_ratio=decrease', '-frames:v', '6', '-c:v', 'mjpeg', '-q:v', '5', '-f', 'image2pipe', 'pipe:1'], 19000, 2_000_000);
    const frames = jpegFrames(output);
    if (!frames.length || frames.length > 6) throw new Error('Não há quadros de vídeo válidos.');
    return { frames, estimatedDurationSeconds: null, sampleTimesSeconds: [], coverage: 'initial' };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().then(value => process.stdout.write(JSON.stringify(value))).catch(error => { process.stderr.write(String(error.message || error).slice(0, 500)); process.exitCode = 1; });
