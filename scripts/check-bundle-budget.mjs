import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.NEXT_DIST_DIR || '.next', 'static', 'chunks');
const maxBytes = Number(process.env.MAX_CHUNK_BYTES || 750 * 1024);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  }));
  return nested.flat();
}

const files = (await listFiles(root)).filter((file) => file.endsWith('.js'));
const measurements = await Promise.all(files.map(async (file) => ({ file, bytes: (await stat(file)).size })));
const violations = measurements.filter(({ bytes }) => bytes > maxBytes).sort((a, b) => b.bytes - a.bytes);

if (violations.length) {
  for (const violation of violations) {
    console.error(`[bundle-budget] ${path.relative(process.cwd(), violation.file)}: ${violation.bytes} bytes (max ${maxBytes})`);
  }
  process.exitCode = 1;
} else {
  const largest = measurements.sort((a, b) => b.bytes - a.bytes)[0];
  console.log(`[bundle-budget] OK. Largest chunk: ${largest ? `${path.relative(process.cwd(), largest.file)} (${largest.bytes} bytes)` : 'none'}`);
}
