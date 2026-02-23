import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({
    region: 'us-east-1',
    endpoint: 'https://storage.klyraai.com.br',
    credentials: {
        accessKeyId: 'jS5Uv7JIFvyFU5j2TlfC',
        secretAccessKey: 'gVS1WwLNJz3Xg7M4jomTT1b0HQ3C13CZxwnUkIB8',
    },
    forcePathStyle: true,
});

async function testUpload() {
    try {
        console.log('Testing upload...');
        const buffer = Buffer.from('test text content');
        const command = new PutObjectCommand({
            Bucket: 'crm',
            Key: 'test/test.txt',
            Body: buffer,
            ContentType: 'text/plain',
            ACL: 'public-read',
        });

        await s3Client.send(command);
        console.log('Upload successful!');
    } catch (error: any) {
        console.error('Upload failed:', error.name, error.message, error.Code);
    }
}

testUpload();
