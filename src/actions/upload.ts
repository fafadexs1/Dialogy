'use server';

import { getCurrentUser } from '@/actions/user';
import { db } from '@/lib/db';
import fs from 'fs/promises';
import path from 'path';

async function ensureAdmin() {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const res = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [user.id]);
    if (!res.rows[0]?.is_superadmin) {
        throw new Error('Unauthorized: Admin only');
    }
    return user;
}

export async function uploadFavicon(formData: FormData) {
    await ensureAdmin();

    const file = formData.get('file') as File;
    if (!file) throw new Error('No file provided');

    const bytes = await file.arrayBuffer();
    let buffer = Buffer.from(bytes);

    // Convert to ICO if not already .ico.
    if (!file.name.toLowerCase().endsWith('.ico')) {
        try {
            // Lazy load dependencies to avoid cold start impact if not used
            const pngToIco = require('png-to-ico');
            const generateIco = pngToIco.default || pngToIco;
            const sharp = require('sharp');

            // Resize to 256x256 explicitly to ensure good quality ICO
            const pngBuffer = await sharp(buffer)
                .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();

            buffer = await generateIco(pngBuffer);
        } catch (e) {
            console.error('ICO conversion failed:', e);
            throw new Error('Failed to convert uploaded image to a browser-compatible favicon.');
        }
    }

    const publicDir = path.join(process.cwd(), 'public');
    const filePath = path.join(publicDir, 'favicon.ico');

    try {
        await fs.writeFile(filePath, buffer);
    } catch (error: any) {
        console.error('Failed to write favicon locally:', error);
        throw new Error(`Failed to save favicon locally: ${error.message}`);
    }

    // Return the relative URL with a timestamp to bust cache
    const url = `/favicon.ico?v=${Date.now()}`;
    return { success: true, url };
}
