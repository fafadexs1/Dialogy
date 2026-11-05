import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ query: vi.fn(), decrypt: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mock.query } }));
vi.mock('@/lib/security/secret-box', () => ({ encryptWithKey: vi.fn(), decryptWithKey: mock.decrypt }));
import { loadNexusCredentialPayload, nexusCredentialFingerprint } from '@/modules/nexus/services/credentials';

describe('vínculo de credencial à aprovação', () => {
  it('verifica a versão exata ao carregar e bloqueia uma troca depois da aprovação', async () => {
    mock.query.mockReset().mockResolvedValueOnce({ rows: [{ credential_type: 'database', encrypted_payload: 'before' }] }).mockResolvedValueOnce({ rows: [{ credential_type: 'database', encrypted_payload: 'after', metadata: {} }] });
    mock.decrypt.mockReset();
    const expectedFingerprint = await nexusCredentialFingerprint({ workspaceId: 'workspace', credentialId: 'credential', type: 'database' });
    await expect(loadNexusCredentialPayload({ workspaceId: 'workspace', credentialId: 'credential', allowedTypes: ['database'], expectedFingerprint })).rejects.toThrow(/mudou após a aprovação/);
    expect(mock.decrypt).not.toHaveBeenCalled();
    expect(mock.query.mock.calls.map(call => call[1])).toEqual([['workspace', 'credential'], ['workspace', 'credential']]);
  });
  it('recusa credencial de tipo incorreto antes de gerar impressão digital', async () => {
    mock.query.mockReset().mockResolvedValue({ rows: [{ credential_type: 'bearer', encrypted_payload: 'secret' }] });
    await expect(nexusCredentialFingerprint({ workspaceId: 'workspace', credentialId: 'credential', type: 'database' })).rejects.toThrow(/workspace/);
  });
});
