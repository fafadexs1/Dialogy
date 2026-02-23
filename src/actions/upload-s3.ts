'use server';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({
    region: 'us-east-1', // MinIO doesn't strictly need a region, but AWS SDK does
    endpoint: 'https://storage.klyraai.com.br',
    credentials: {
        accessKeyId: 'jS5Uv7JIFvyFU5j2TlfC',
        secretAccessKey: 'gVS1WwLNJz3Xg7M4jomTT1b0HQ3C13CZxwnUkIB8',
    },
    forcePathStyle: true, // Necessary for many S3-compatible APIs
});

export async function uploadToS3Action(formData: FormData) {
    try {
        const file = formData.get('file') as File;
        const pathPrefix = formData.get('pathPrefix') as string || 'crm-uploads';

        if (!file) {
            return { success: false, error: 'No file provided' };
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // Generate a unique file name
        const extension = file.name.split('.').pop();
        const uniqueFileName = `${pathPrefix}/${uuidv4()}.${extension}`;

        const command = new PutObjectCommand({
            Bucket: 'crm', // As requested by user
            Key: uniqueFileName,
            Body: buffer,
            ContentType: file.type,
            ACL: 'public-read', // Not all S3 compatible providers support this, but usually good to try for public links
        });

        await s3Client.send(command);

        // Construct the public URL
        // Format is usually endpoint/bucket/key if path style is forced
        const publicUrl = `https://storage.klyraai.com.br/crm/${uniqueFileName}`;

        return {
            success: true,
            url: publicUrl,
            fileName: file.name
        };
    } catch (error) {
        console.error('Error uploading file to S3:', error);
        return { success: false, error: 'Failed to upload file' };
    }
}
