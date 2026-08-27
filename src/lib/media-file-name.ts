import { v4 as uuidv4 } from 'uuid';

const MAX_BASE_NAME_LENGTH = 80;

function splitFileName(originalName: string): { baseName: string; extension: string } {
  const name = originalName.trim() || 'arquivo';
  const extensionStart = name.lastIndexOf('.');
  const hasExtension = extensionStart > 0 && extensionStart < name.length - 1;

  return {
    baseName: hasExtension ? name.slice(0, extensionStart) : name,
    extension: hasExtension ? name.slice(extensionStart + 1) : '',
  };
}

function sanitizeBaseName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_BASE_NAME_LENGTH) || 'arquivo';
}

function sanitizeExtension(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 10).toLowerCase();
}

/**
 * Creates a collision-resistant name while keeping the original extension.
 * The timestamp makes the object easy to inspect and the UUID prevents two
 * files selected/sent in the same millisecond from sharing a Storage path.
 */
export function createUniqueMediaFileName(
  originalName: string,
  timestamp = Date.now(),
  uniqueId = uuidv4(),
): string {
  const { baseName, extension } = splitFileName(originalName);
  const safeId = uniqueId.replace(/[^a-zA-Z0-9-]/g, '');
  const safeExtension = sanitizeExtension(extension);
  const suffix = `${timestamp}-${safeId || uuidv4()}`;

  return `${sanitizeBaseName(baseName)}_${suffix}${safeExtension ? `.${safeExtension}` : ''}`;
}

export function createUniqueMediaStoragePath(
  originalName: string,
  folder = 'chat-media',
  timestamp = Date.now(),
  uniqueId = uuidv4(),
): string {
  return `${folder}/${createUniqueMediaFileName(originalName, timestamp, uniqueId)}`;
}
