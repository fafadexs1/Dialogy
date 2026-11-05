import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeLocalAgentSandbox } from '@/modules/nexus/services/local-agent-sandbox';

const image = process.env.DIALOGY_SANDBOX_INTEGRATION_IMAGE;
afterEach(() => vi.unstubAllEnvs());

describe('Python no sandbox local', () => {
  it.skipIf(!image)('executa análise com NumPy e pandas no contêiner isolado', async () => {
    vi.stubEnv('DIALOGY_AGENT_SANDBOX_IMAGE', image!);
    const result = await executeLocalAgentSandbox({ language: 'python', code: "import numpy as np, pandas as pd, site\nprint(int(pd.Series(np.array([2, 3, 4])).sum()))\nprint(site.ENABLE_USER_SITE)" }, AbortSignal.timeout(30000));
    expect(result).toMatchObject({ exitCode: 0, stdout: '9\nFalse\n', timedOut: false });
  }, 30000);
});
