import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn(), save: vi.fn(), load: vi.fn(), credential: vi.fn(), oauth: vi.fn() }));
vi.mock('@/modules/nexus/services/public-http', () => ({ requestPublicHttps: mocks.request }));
vi.mock('@/modules/nexus/services/workflow-files', () => ({ saveWorkflowFile: mocks.save, loadWorkflowFile: mocks.load }));
vi.mock('@/modules/nexus/services/credentials', () => ({ loadNexusCredentialPayload: mocks.credential }));
vi.mock('@/modules/nexus/services/oauth-credentials', () => ({ resolveNexusOAuthToken: mocks.oauth }));
import { executeNexusHttpOperation } from '@/modules/nexus/services/http-executor';
const file = { kind: 'workflow_file', id: '53ba52bb-6416-4510-a1b0-14f8345a3208', name: 'voz.mp3', mimeType: 'audio/mpeg', size: 4 };
const execute = (config: Record<string, unknown>) => executeNexusHttpOperation({ workspaceId: 'ws', config: { url: 'https://example.com', ...config }, runtimeSource: {}, signal: new AbortController().signal });
beforeEach(() => { vi.resetAllMocks(); mocks.save.mockResolvedValue(file); mocks.load.mockResolvedValue({ file, data: Buffer.from([0, 255, 128, 7]) }); });
describe('HTTP binary files and bounded pagination', () => {
  it('does not re-render an approved, already resolved request', async () => {
    mocks.request.mockResolvedValue({ status: 200, headers: {}, body: Buffer.from('{}') });
    await executeNexusHttpOperation({ workspaceId: 'ws', config: { url: 'https://example.com', method: 'POST', bodyType: 'json', body: { text: '{{variables.secret}}' } }, runtimeSource: { variables: { secret: 'should-not-be-sent' } }, preResolved: true, signal: new AbortController().signal });
    expect(JSON.parse(mocks.request.mock.calls[0][0].body)).toEqual({ text: '{{variables.secret}}' });
  });
  it('does not allow a credentialed URL template to replace its origin', async () => {
    await expect(executeNexusHttpOperation({ workspaceId: 'ws', config: { url: 'https://{{current.host}}/api', method: 'GET', credentialId: 'credential' }, runtimeSource: { current: { host: 'evil.example' } }, signal: new AbortController().signal })).rejects.toThrow('origem');
    expect(mocks.credential).not.toHaveBeenCalled();
  });
  it('stores exactly the received audio bytes', async () => {
    const bytes = Buffer.from([0, 255, 128, 7]);
    mocks.request.mockResolvedValue({ status: 200, headers: { 'content-type': 'audio/mpeg' }, body: bytes });
    expect(await execute({ responseFormat: 'file' })).toMatchObject({ selected: file });
    expect(mocks.save.mock.calls[0][0].data).toEqual(bytes);
  });
  it('uploads a canonical private file as multipart and replaces stale boundaries', async () => {
    mocks.request.mockResolvedValue({ status: 200, headers: {}, body: Buffer.from('{}') });
    await execute({ method: 'POST', bodyType: 'form-data', body: { audio: file, text: 'olá' }, headers: { 'content-type': 'multipart/form-data' } });
    const call = mocks.request.mock.calls[0][0];
    expect(Buffer.isBuffer(call.body)).toBe(true);
    expect(call.body.includes(Buffer.from([0, 255, 128, 7]))).toBe(true);
    expect(call.headers['Content-Type']).toContain('boundary=');
    expect(mocks.load).toHaveBeenCalledWith('ws', file);
  });
  it('collects cursor pages in order', async () => {
    mocks.request.mockResolvedValueOnce({ status: 200, headers: {}, body: Buffer.from('{"items":[1],"next":"b"}') }).mockResolvedValueOnce({ status: 200, headers: {}, body: Buffer.from('{"items":[2],"next":null}') });
    const result = await execute({ responseFormat: 'json', pagination: { mode: 'cursor', itemsPath: 'items', nextCursorPath: 'next' } });
    expect(result.selected).toEqual([1, 2]);
    expect(result.pagination).toMatchObject({ pages: 2, hasMore: false });
    expect(mocks.request.mock.calls[1][0].url).toContain('cursor=b');
  });
  it('rejects repeated cursors and excessive item counts', async () => {
    mocks.request.mockResolvedValue({ status: 200, headers: {}, body: Buffer.from('{"items":[1],"next":"same"}') });
    await expect(execute({ pagination: { mode: 'cursor', itemsPath: 'items', nextCursorPath: 'next' } })).rejects.toThrow('repetiu');
    await expect(execute({ pagination: { mode: 'page', itemsPath: 'items', maxItems: 1 } })).rejects.toThrow('limite de itens');
  });
  it('reports an unfinished bounded result without concealing remaining pages', async () => {
    mocks.request.mockResolvedValue({ status: 200, headers: {}, body: Buffer.from('[1]') });
    expect(await execute({ pagination: { mode: 'page', maxPages: 1 } })).toMatchObject({ selected: [1], pagination: { hasMore: true } });
  });
  it('preserves text and JSON response modes', async () => {
    mocks.request.mockResolvedValue({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"ok":true}') });
    expect(await execute({ responseFormat: 'text' })).toMatchObject({ selected: '{"ok":true}' });
    expect(await execute({ responsePath: 'ok' })).toMatchObject({ selected: true });
  });
  it('blocks writes using a read-only Google credential before token refresh', async () => {
    mocks.credential.mockResolvedValue({ type:'oauth2', payload:{}, metadata:{provider:'google_workspace',access:'read'} });
    await expect(execute({ credentialId:'credential', method:'POST', bodyType:'json', body:{} })).rejects.toThrow('apenas leitura');
    expect(mocks.oauth).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  });
  it('restricts GitHub credentials to their origin and rejects writes in local read-only mode', async () => {
    mocks.credential.mockResolvedValue({type:'bearer',payload:{token:'secret'},metadata:{provider:'github',allowedOrigin:'https://api.github.com',access:'read'}});
    await expect(execute({credentialId:'credential'})).rejects.toThrow('origem');
    await expect(execute({url:'https://api.github.com/user/repos',credentialId:'credential',method:'POST',bodyType:'json',body:{name:'new'}})).rejects.toThrow('leitura');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('permits Notion search in read-only mode without permitting other POST requests', async () => {
    mocks.credential.mockResolvedValue({type:'oauth2',payload:{},metadata:{provider:'notion',allowedOrigin:'https://api.notion.com',access:'read'}});mocks.oauth.mockResolvedValue('token');mocks.request.mockResolvedValue({status:200,headers:{},body:Buffer.from('{}')});
    await execute({url:'https://api.notion.com/v1/search',method:'POST',bodyType:'json',body:{query:'x'},credentialId:'credential'});
    await expect(execute({url:'https://api.notion.com/v1/pages',method:'POST',bodyType:'json',body:{},credentialId:'credential'})).rejects.toThrow('leitura');
    expect(mocks.request).toHaveBeenCalledOnce();
  });
  it('applies protected OAuth tokens and never follows a supplied next URL', async () => {
    mocks.credential.mockResolvedValue({ type: 'oauth2', payload: {} }); mocks.oauth.mockResolvedValue('token');
    mocks.request.mockResolvedValue({ status: 200, headers: {}, body: Buffer.from('{}') });
    await execute({ credentialId: 'credential' });
    expect(mocks.oauth).toHaveBeenCalledWith('ws', 'credential', 'https://example.com', expect.any(AbortSignal));
    expect(mocks.request.mock.calls[0][0].headers.Authorization).toBe('Bearer token');
  });
});
