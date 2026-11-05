import { describe, expect, it } from 'vitest';
import { requestPublicHttps } from '@/modules/nexus/services/public-http';

describe('Microsoft download network boundary',()=>{
  it.each(['https://127.0.0.1/private?signature=secret','https://169.254.169.254/latest/meta-data?signature=secret','http://example.com/file?signature=secret'])('rejects a non-public HTTPS destination without leaking the signed URL',async(url)=>{
    try {
      await requestPublicHttps({url,method:'GET',headers:{Accept:'application/octet-stream'},timeoutMs:1000,maxResponseBytes:1024,signal:AbortSignal.timeout(1000)});
      throw new Error('O destino deveria ter sido recusado.');
    } catch(error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('secret');
      expect((error as Error).message).toMatch(/HTTPS|public|private|reserved/i);
    }
  });
});
