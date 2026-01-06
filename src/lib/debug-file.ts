
import fs from 'fs';
import path from 'path';

export const logToDebugFile = (message: string) => {
    try {
        const logPath = path.join(process.cwd(), 'debug_log.txt');
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    } catch (err) {
        console.error('Failed to write to debug log:', err);
    }
};
