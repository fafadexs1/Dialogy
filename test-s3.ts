import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({
    region: process.env.PRIVATE_S3_REGION || 'us-east-1',
    endpoint: process.env.PRIVATE_S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.PRIVATE_S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.PRIVATE_S3_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true,
});

async function testUpload() {
    try {
        console.log('Testing upload...');
        const buffer = Buffer.from('test text content');
        const command = new PutObjectCommand({
            Bucket: process.env.PRIVATE_S3_BUCKET,
            Key: 'test/test.txt',
            Body: buffer,
            ContentType: 'text/plain',
        });

        await s3Client.send(command);
        console.log('Upload successful!');
    } catch (error: any) {
        console.error('Upload failed:', error.name, error.message, error.Code);
    }
}

testUpload();
