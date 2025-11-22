import { createClient } from './client';

export async function uploadFileToStorage(
    file: File | Blob,
    bucket: string,
    path: string
): Promise<{ publicUrl: string | null; error: string | null }> {
    const supabase = createClient();

    try {
        const { data, error } = await supabase.storage
            .from(bucket)
            .upload(path, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            console.error('Error uploading file:', error);
            return { publicUrl: null, error: error.message };
        }

        const { data: { publicUrl } } = supabase.storage
            .from(bucket)
            .getPublicUrl(path);

        return { publicUrl, error: null };
    } catch (err) {
        console.error('Unexpected error uploading file:', err);
        return { publicUrl: null, error: 'Unexpected error occurred' };
    }
}
