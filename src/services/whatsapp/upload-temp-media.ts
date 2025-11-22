'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'crypto';

const TEMP_MEDIA_BUCKET = 'temp-media';
const DELETE_DELAY_MS = 5 * 60 * 1000; // 5 minutes

type UploadParams = {
    media: string; // Base64 (with or without data URI) or remote URL
    mimetype: string;
    fileName?: string;
};

const sanitizeFileName = (name: string) =>
    name.replace(/[^a-zA-Z0-9._-]/g, '_');

const inferExtension = (mimetype: string, fallback: string = 'bin') => {
    const [, subtype] = mimetype.split('/');
    if (!subtype) return fallback;
    // Handle mimetypes like "jpeg" or "svg+xml"
    return subtype.split('+')[0];
};

async function toBufferFromSource(source: string): Promise<Buffer> {
    const trimmed = source.trim();
    const isUrl = /^https?:\/\//i.test(trimmed);

    if (isUrl) {
        const response = await fetch(trimmed);
        if (!response.ok) {
            throw new Error(`Falha ao baixar mídia da URL: ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    const base64Data = trimmed.includes(',')
        ? trimmed.split(',').pop() || ''
        : trimmed;

    if (!base64Data) {
        throw new Error('Conteúdo da mídia vazio ou inválido.');
    }

    return Buffer.from(base64Data, 'base64');
}

function scheduleTempDeletion(filePath: string) {
    // Best-effort cleanup; não aguardamos o resultado.
    setTimeout(async () => {
        try {
            const { error } = await supabaseAdmin.storage.from(TEMP_MEDIA_BUCKET).remove([filePath]);
            if (error) {
                console.error('[TEMP_MEDIA] Erro ao apagar arquivo expirado:', error, 'Path:', filePath);
            }
        } catch (error) {
            console.error('[TEMP_MEDIA] Exceção ao apagar arquivo expirado:', error, 'Path:', filePath);
        }
    }, DELETE_DELAY_MS);
}

export async function uploadTempMedia({ media, mimetype, fileName }: UploadParams) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL não configurada.');
    }

    const buffer = await toBufferFromSource(media);

    const finalFileName = sanitizeFileName(
        fileName ||
        `media-${Date.now()}-${randomUUID()}.${inferExtension(mimetype)}`
    );
    const filePath = `${randomUUID()}/${finalFileName}`;

    const { error } = await supabaseAdmin.storage
        .from(TEMP_MEDIA_BUCKET)
        .upload(filePath, buffer, {
            contentType: mimetype,
            upsert: true,
        });

    if (error) {
        console.error('[TEMP_MEDIA] Upload error:', error);
        throw new Error(`Falha ao fazer upload da mídia: ${error.message}`);
    }

    const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${TEMP_MEDIA_BUCKET}/${filePath}`;

    scheduleTempDeletion(filePath);

    return { publicUrl, filePath };
}
