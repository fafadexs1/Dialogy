// Executed only inside a disposable, networkless container.
const { spawn } = require('node:child_process');
async function main() {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 24000) throw new Error('Entrada excede limite.'); }
  const { language, code } = JSON.parse(input);
  if (!['python', 'javascript', 'shell'].includes(language) || typeof code !== 'string' || code.length > 16000) throw new Error('Entrada inválida.');
  const command = language === 'python' ? 'python3' : language === 'javascript' ? 'node' : '/bin/sh';
  const args = language === 'python' ? ['-I', '-c', code] : language === 'javascript' ? ['--disable-proto=throw', '-e', code] : ['-c', code];
  const child = spawn(command, args, { cwd: '/tmp', env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', LANG: 'C.UTF-8', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 15000);
  child.stdout.on('data', chunk => { stdout = (stdout + String(chunk)).slice(0, 32000); });
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(0, 32000); });
  const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code ?? -1)); });
  clearTimeout(timer);
  return { version: 1, exitCode, stdout, stderr, timedOut };
}
main().then(result => process.stdout.write(JSON.stringify(result))).catch(error => { process.stderr.write(String(error?.message || error).slice(0, 1000)); process.exitCode = 1; });
