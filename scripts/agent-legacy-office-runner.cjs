const { spawn } = require('node:child_process');
const { writeFile, readFile, stat, mkdir } = require('node:fs/promises');

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 2_800_000) throw new Error('Arquivo excede 2 MB.'); }
  const input = JSON.parse(raw);
  if (!['doc', 'xls'].includes(input.format) || typeof input.dataBase64 !== 'string') throw new Error('Formato inválido.');
  const data = Buffer.from(input.dataBase64, 'base64');
  if (!data.length || data.length > 2_000_000 || data.toString('base64') !== input.dataBase64 || !data.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) throw new Error('Arquivo Office legado inválido.');
  await mkdir('/tmp/office-in', { recursive: true }); await mkdir('/tmp/office-out', { recursive: true });
  await writeFile(`/tmp/office-in/input.${input.format}`, data, { mode: 0o600 });
  const output = input.format === 'doc' ? 'docx' : 'xlsx';
  await new Promise((resolve, reject) => {
    const process = spawn('soffice', ['-env:UserInstallation=file:///tmp/office-profile', '--headless', '--convert-to', output, '--outdir', '/tmp/office-out', `/tmp/office-in/input.${input.format}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = ''; const timer = setTimeout(() => { process.kill('SIGKILL'); reject(new Error('Conversão excedeu o tempo limite.')); }, 30000);
    process.stderr.on('data', chunk => { error = (error + String(chunk)).slice(0, 500); });
    process.on('error', e => { clearTimeout(timer); reject(e); });
    process.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(error || 'Conversão Office falhou.')); });
  });
  const path = `/tmp/office-out/input.${output}`;
  if ((await stat(path)).size > 10_000_000) throw new Error('Arquivo convertido excede 10 MB.');
  const converted = await readFile(path);
  if (!converted.subarray(0, 2).equals(Buffer.from('PK'))) throw new Error('Arquivo convertido inválido.');
  return { format: output, dataBase64: converted.toString('base64') };
}
main().then(value => process.stdout.write(JSON.stringify(value))).catch(error => { process.stderr.write(String(error.message || error).slice(0, 500)); process.exitCode = 1; });
