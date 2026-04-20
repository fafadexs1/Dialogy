import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_DEBUG_DIR = path.join(os.tmpdir(), 'dialogy');
const warnedFailures = new Set<string>();

function getCandidatePaths(fileName: string): string[] {
  const configuredFilePath = process.env.DEBUG_LOG_PATH?.trim();
  const configuredDirPath = process.env.DEBUG_LOG_DIR?.trim();
  const fallbackPath = path.join(configuredDirPath || DEFAULT_DEBUG_DIR, fileName);

  return Array.from(new Set([configuredFilePath, fallbackPath].filter((value): value is string => Boolean(value))));
}

function appendToDebugFile(fileName: string, message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  let lastError: unknown = null;

  for (const candidatePath of getCandidatePaths(fileName)) {
    try {
      fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
      fs.appendFileSync(candidatePath, line, 'utf8');
      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (!warnedFailures.has(fileName)) {
    warnedFailures.add(fileName);
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    console.warn(`[DEBUG_LOG] Unable to write ${fileName}. Falling back to stdout. Reason: ${reason}`);
  }

  console.debug(`[DEBUG_LOG_FALLBACK:${fileName}] ${line.trimEnd()}`);
}

export const logToDebugFile = (message: string) => {
  appendToDebugFile('debug_log.txt', message);
};

export const logToNamedDebugFile = (fileName: string, message: string) => {
  appendToDebugFile(fileName, message);
};
