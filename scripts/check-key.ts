
import dotenv from 'dotenv';
dotenv.config();

function checkKey() {
    const key = process.env.GOOGLE_GENAI_API_KEY;
    if (!key) {
        console.log('GOOGLE_GENAI_API_KEY is NOT set.');
    } else if (key === 'no-key-configured') {
        console.log('GOOGLE_GENAI_API_KEY is set to default placeholder.');
    } else {
        console.log(`GOOGLE_GENAI_API_KEY is set. Length: ${key.length}. Starts with: ${key.substring(0, 4)}...`);
    }
}

checkKey();
