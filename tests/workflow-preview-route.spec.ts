import { afterEach, describe, expect, it, vi } from 'vitest';

const { notFound } = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error('NOT_FOUND'); }) }));
vi.mock('next/navigation', () => ({ notFound }));
vi.mock('./fixtures/workflow-editor-preview', () => ({ default: () => null }));

import Page from '@/app/workflow-editor-preview/page';

describe('stable workflow preview route', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it.each(['development', 'production'])('returns 404 by default in %s', async (mode) => {
    vi.stubEnv('NODE_ENV', mode);
    vi.stubEnv('WORKFLOW_EDITOR_PREVIEW', undefined);
    await expect(Page()).rejects.toThrow('NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('renders the synthetic editor when explicitly enabled by its launcher', async () => {
    vi.stubEnv('WORKFLOW_EDITOR_PREVIEW', '1');
    expect((await Page()).type).toBeTypeOf('function');
    expect(notFound).not.toHaveBeenCalled();
  });
});
