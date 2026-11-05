import 'server-only';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type PrivateS3Config = {
  bucket: string;
  client: S3Client;
};

let cachedConfig: PrivateS3Config | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required storage configuration: ${name}`);
  return value;
}

function getPrivateS3Config(): PrivateS3Config {
  if (cachedConfig) return cachedConfig;

  const endpoint = requiredEnv('PRIVATE_S3_ENDPOINT');
  const accessKeyId = requiredEnv('PRIVATE_S3_ACCESS_KEY_ID');
  const secretAccessKey = requiredEnv('PRIVATE_S3_SECRET_ACCESS_KEY');
  const bucket = requiredEnv('PRIVATE_S3_BUCKET');

  cachedConfig = {
    bucket,
    client: new S3Client({
      region: process.env.PRIVATE_S3_REGION?.trim() || 'us-east-1',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: process.env.PRIVATE_S3_FORCE_PATH_STYLE !== 'false',
    }),
  };

  return cachedConfig;
}

export async function putPrivateObject(input: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  const { bucket, client } = getPrivateS3Config();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
  }));
}

export async function createPrivateObjectDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
  const { bucket, client } = getPrivateS3Config();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: Math.min(Math.max(expiresInSeconds, 60), 900),
  });
}

export async function readPrivateObject(key: string, maxBytes: number): Promise<Buffer> {
  const { bucket, client } = getPrivateS3Config();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error('Arquivo indisponível.');
  if (Number(response.ContentLength || 0) > maxBytes) throw new Error('Arquivo excede o limite permitido.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      (response.Body as { destroy?: () => void }).destroy?.();
      throw new Error('Arquivo excede o limite permitido.');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function deletePrivateObject(key: string): Promise<void> {
  const { bucket, client } = getPrivateS3Config();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
