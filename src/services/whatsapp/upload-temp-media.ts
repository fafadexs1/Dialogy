'use server';

import { getSupabaseAdmin } from '@/lib/supabase';

// ... (assuming usage is simple, I will check content first implicitly by trying a safe replace, but wait, I don't know the exact usage line)
// Actually I need to see the file to replace usage. I only grepped the import.
// Let's modify the import effectively using Replace.
// I will start with IMPORT.
// I will use READ to see usage first to be safe.

import { Buffer } from 'node:buffer';
import { randomUUID } from 'crypto';
import { fetchSafeRemote, readResponseBodyLimited } from '@/lib/security/safe-remote-url';
import { RETRY_MEDIA_RETENTION_MS } from '@/services/messages/temp-media-retention';

const TEMP_MEDIA_BUCKET = 'temp-media';
const DELETE_DELAY_MS = RETRY_MEDIA_RETENTION_MS;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

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
        const response = await fetchSafeRemote(trimmed, {
            cache: 'no-store',
            headers: { 'user-agent': 'Dialogy-Media-Normalizer/1.0' },
        }, {
            timeoutMs: 30_000,
            maxRedirects: 3,
        });
        if (!response.ok) {
            throw new Error(`Falha ao baixar mídia da URL: ${response.status} ${response.statusText}`);
        }
        return Buffer.from(await readResponseBodyLimited(response, MAX_MEDIA_BYTES));
    }

    const base64Data = trimmed.includes(',')
        ? trimmed.split(',').pop() || ''
        : trimmed;

    if (!base64Data) {
        throw new Error('Conteúdo da mídia vazio ou inválido.');
    }

    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) throw new Error('Conteúdo da mídia vazio ou inválido.');
    if (buffer.length > MAX_MEDIA_BYTES) throw new Error('A mídia excede o limite de 25 MB.');
    return buffer;
}

function scheduleTempDeletion(filePath: string) {
    // Best-effort cleanup; não aguardamos o resultado.
    const timeout = setTimeout(async () => {
        try {
            const { error } = await getSupabaseAdmin().storage.from(TEMP_MEDIA_BUCKET).remove([filePath]);
            if (error) {
                console.error('[TEMP_MEDIA] Erro ao apagar arquivo expirado:', error, 'Path:', filePath);
            }
        } catch (error) {
            console.error('[TEMP_MEDIA] Exceção ao apagar arquivo expirado:', error, 'Path:', filePath);
        }
    }, DELETE_DELAY_MS);
    if (typeof (timeout as any).unref === 'function') {
        (timeout as any).unref();
    }
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

    const { error } = await getSupabaseAdmin().storage
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
