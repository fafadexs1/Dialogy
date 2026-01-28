const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SOURCE_ICON = path.join(__dirname, '../public/logo-new.jpg');
const DEST_DIR = path.join(__dirname, '../public/icons');

const SIZES = [
    { name: 'icon-192x192.png', size: 192 },
    { name: 'icon-512x512.png', size: 512 },
    { name: 'apple-touch-icon.png', size: 180 }, // Common size for iOS
];

if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
}

async function generateIcons() {
    console.log(`Generating icons from ${SOURCE_ICON}...`);

    if (!fs.existsSync(SOURCE_ICON)) {
        console.error('Source icon not found!');
        process.exit(1);
    }

    for (const icon of SIZES) {
        const destPath = path.join(DEST_DIR, icon.name);
        await sharp(SOURCE_ICON)
            .resize(icon.size, icon.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toFile(destPath);
        console.log(`Created ${icon.name}`);
    }
}

generateIcons().catch(err => {
    console.error(err);
    process.exit(1);
});
