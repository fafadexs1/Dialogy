import { isRecord } from './utils';

type JsonSchema = Record<string, unknown>;

const TOKEN_ALIASES: Record<string, string> = {
  ssid: 'name',
  nome: 'name',
  network: 'name',
  rede: 'name',
  password: 'password',
  passwd: 'password',
  pwd: 'password',
  passphrase: 'password',
  senha: 'password',
  band: 'band',
  banda: 'band',
  frequency: 'band',
  frequencia: 'band',
  channel: 'channel',
  canal: 'channel',
  enabled: 'enabled',
  enable: 'enabled',
  active: 'enabled',
  ativo: 'enabled',
  visible: 'visible',
  visibility: 'visible',
  visivel: 'visible',
  id: 'id',
};

const QUALIFIER_TOKENS = new Set([
  'new', 'novo', 'nova', 'updated', 'desired', 'requested',
  'value', 'valor', 'input', 'wifi', 'wireless', 'is',
]);

function normalizedTokens(value: string): string[] {
  return value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function canonicalKey(value: string): string {
  return normalizedTokens(value).join('');
}

function semanticKey(value: string): string {
  return normalizedTokens(value)
    .filter((token) => !QUALIFIER_TOKENS.has(token))
    .map((token) => TOKEN_ALIASES[token] || token)
    .join('');
}

function schemaProperties(schema: JsonSchema): Record<string, JsonSchema> {
  if (!isRecord(schema.properties)) return {};
  return Object.fromEntries(
    Object.entries(schema.properties)
      .filter((entry): entry is [string, JsonSchema] => isRecord(entry[1])),
  );
}

function resolvePropertyName(inputKey: string, properties: Record<string, JsonSchema>): string | null {
  if (Object.prototype.hasOwnProperty.call(properties, inputKey)) return inputKey;

  const canonical = canonicalKey(inputKey);
  const canonicalMatches = Object.keys(properties).filter((property) => canonicalKey(property) === canonical);
  if (canonicalMatches.length === 1) return canonicalMatches[0];

  const semantic = semanticKey(inputKey);
  if (!semantic) return null;
  const semanticMatches = Object.keys(properties).filter((property) => semanticKey(property) === semantic);
  return semanticMatches.length === 1 ? semanticMatches[0] : null;
}

function enumValue(value: unknown, values: unknown[]): unknown {
  if (values.some((candidate) => Object.is(candidate, value))) return value;
  if (typeof value !== 'string') return value;
  const normalized = semanticKey(value.replace(/ghz/gi, ''));
  const matches = values.filter((candidate) => (
    typeof candidate === 'string'
    && semanticKey(candidate.replace(/ghz/gi, '')) === normalized
  ));
  return matches.length === 1 ? matches[0] : value;
}

function coercePrimitive(value: unknown, schema: JsonSchema): unknown {
  if (Array.isArray(schema.enum)) return enumValue(value, schema.enum);
  const type = String(schema.type || '');
  if (type === 'string') {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  if (type === 'boolean' && typeof value === 'string') {
    const normalized = semanticKey(value);
    if (['true', '1', 'yes', 'sim', 'on', 'enabled', 'ligado'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nao', 'off', 'disabled', 'desligado'].includes(normalized)) return false;
  }
  if ((type === 'number' || type === 'integer') && typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed) && (type !== 'integer' || Number.isInteger(parsed))) return parsed;
  }
  return value;
}

function coerceValue(value: unknown, schema: JsonSchema): unknown {
  const type = String(schema.type || '');
  if (type === 'object') {
    let objectValue = value;
    if (typeof objectValue === 'string') {
      try { objectValue = JSON.parse(objectValue); } catch { return value; }
    }
    return isRecord(objectValue) ? normalizeObject(objectValue, schema) : value;
  }
  if (type === 'array') {
    let arrayValue = value;
    if (typeof arrayValue === 'string') {
      const stringValue = arrayValue;
      try {
        arrayValue = JSON.parse(stringValue);
      } catch {
        arrayValue = stringValue.split(',').map((item: string) => item.trim()).filter(Boolean);
      }
    }
    if (!Array.isArray(arrayValue)) return value;
    const itemSchema = isRecord(schema.items) ? schema.items : {};
    return (arrayValue as unknown[]).map((item: unknown) => coerceValue(item, itemSchema));
  }
  return coercePrimitive(value, schema);
}

function normalizeObject(value: Record<string, unknown>, schema: JsonSchema): Record<string, unknown> {
  const properties = schemaProperties(schema);
  const normalized: Record<string, unknown> = {};

  for (const [inputKey, inputValue] of Object.entries(value)) {
    const property = resolvePropertyName(inputKey, properties);
    if (!property) {
      if (isRecord(schema.additionalProperties)) {
        normalized[inputKey] = coerceValue(inputValue, schema.additionalProperties);
      } else if (schema.additionalProperties !== false) {
        normalized[inputKey] = inputValue;
      }
      continue;
    }
    // Prefer a correctly named value if the model supplied both an alias and
    // the canonical property.
    if (normalized[property] !== undefined && inputKey !== property) continue;
    normalized[property] = coerceValue(inputValue, properties[property]);
  }

  for (const [property, propertySchema] of Object.entries(properties)) {
    if (normalized[property] === undefined && propertySchema.default !== undefined) {
      normalized[property] = structuredClone(propertySchema.default);
    }
  }
  return normalized;
}

/**
 * Repairs common LLM representation differences strictly from the tool's own
 * JSON Schema. It never invents a missing required value; it only renames
 * unambiguous aliases, applies declared defaults, and coerces declared types.
 */
export function normalizeToolArgumentsFromJsonSchema(
  value: Record<string, unknown>,
  schema?: JsonSchema | null,
): Record<string, unknown> {
  if (!schema || Object.keys(schema).length === 0) return value;
  return normalizeObject(value, schema);
}

function compactPropertySchema(schema: JsonSchema): JsonSchema {
  const compact: JsonSchema = {};
  for (const key of ['type', 'format', 'enum', 'default', 'minimum', 'maximum', 'minLength', 'maxLength']) {
    if (schema[key] !== undefined) compact[key] = schema[key];
  }
  if (typeof schema.description === 'string' && schema.description.trim()) {
    compact.description = schema.description.trim().slice(0, 240);
  }
  if (isRecord(schema.items)) compact.items = compactPropertySchema(schema.items);
  if (isRecord(schema.additionalProperties)) {
    compact.additionalProperties = compactPropertySchema(schema.additionalProperties);
  }
  return compact;
}

/** Keeps every field name, required marker and type while removing provider
 * metadata that spends prompt tokens without helping construct the call. */
export function toolInputSchemaForPrompt(schema?: JsonSchema | null): JsonSchema {
  if (!schema || Object.keys(schema).length === 0) return {};
  const properties = schemaProperties(schema);
  return {
    type: schema.type || 'object',
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, property]) => [name, compactPropertySchema(property)]),
    ),
    required: Array.isArray(schema.required) ? schema.required.map(String) : [],
    ...(schema.additionalProperties === false ? { additionalProperties: false } : {}),
  };
}
