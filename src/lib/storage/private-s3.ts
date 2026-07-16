import 'server-only';

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
