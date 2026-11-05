import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));
import { executeLocalAgentSandbox } from '@/modules/nexus/services/local-agent-sandbox';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('sandbox local descartável', () => {
  it('requires an operator-configured image and uses bounded Docker isolation', async () => {
    vi.stubEnv('DIALOGY_AGENT_SANDBOX_IMAGE', '');
    await expect(executeLocalAgentSandbox({ language: 'python', code: 'print(2)' }, new AbortController().signal)).rejects.toThrow('não configurada');
    vi.stubEnv('DIALOGY_AGENT_SANDBOX_IMAGE', 'dialogy-agent-sandbox:local');
    spawn.mockImplementationOnce(() => {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      child.stdin.on('data', () => {});
      child.stdin.on('finish', () => { child.stdout.write(JSON.stringify({ version: 1, exitCode: 0, stdout: '2\n', stderr: '', timedOut: false })); child.emit('close', 0); });
      return child;
    });
    expect(await executeLocalAgentSandbox({ language: 'python', code: 'print(2)' }, new AbortController().signal)).toMatchObject({ stdout: '2\n', exitCode: 0 });
    const args = spawn.mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining(['--network=none', '--read-only', '--cap-drop=ALL', '--pids-limit=64', '--memory=256m', '--pull=never']));
    expect(args).not.toContain('-v'); expect(args).not.toContain('--mount');
  });
});
