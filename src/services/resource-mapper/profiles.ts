import { db } from '@/lib/db';

export const CRM_CONTACT_CUSTOM_FIELDS_RESOURCE = 'crm.contact.custom_fields';

export type ResourceMappingAliasProfile = {
  fields: Record<string, string[]>;
};

function parseJsonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value ?? null;
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(
      value
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ));
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

export function normalizeResourceMappingAliasProfile(value: unknown): ResourceMappingAliasProfile {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { fields: {} };
  const source = parsed as Record<string, unknown>;
  const rawFields = source.fields && typeof source.fields === 'object' && !Array.isArray(source.fields)
    ? source.fields as Record<string, unknown>
    : source;

  const fields = Object.fromEntries(
    Object.entries(rawFields)
      .map(([key, aliases]) => [key.trim().slice(0, 120), parseStringList(aliases).slice(0, 30)] as const)
      .filter(([key, aliases]) => key.length > 0 && aliases.length > 0),
  );

  return { fields };
}

export function parseResourceMappingAliasText(value: string): ResourceMappingAliasProfile {
  const fields: Record<string, string[]> = {};
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 80);

  for (const line of lines) {
    const separatorIndex = line.search(/[:=]/);
    if (separatorIndex <= 0) continue;
    const fieldKey = line.slice(0, separatorIndex).trim().slice(0, 120);
    const rawAliases = line.slice(separatorIndex + 1);
    if (!fieldKey) continue;

    const aliases = Array.from(new Set(
      rawAliases
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean)
        .map((alias) => alias.slice(0, 120)),
    )).slice(0, 30);

    if (aliases.length > 0) {
      fields[fieldKey] = aliases;
    }
  }

  return { fields };
}

export function formatResourceMappingAliasText(value: unknown): string {
  const profile = normalizeResourceMappingAliasProfile(value);
  return Object.entries(profile.fields)
    .map(([field, aliases]) => `${field}: ${aliases.join(', ')}`)
    .join('\n');
}

export async function loadResourceMappingProfileAliases(input: {
  workspaceId: string;
  resource?: string;
}): Promise<Record<string, string[]>> {
  try {
    const profileRes = await db.query(
      `SELECT field_aliases_json
       FROM public.resource_mapping_profiles
       WHERE workspace_id = $1
         AND resource = $2
       LIMIT 1`,
      [input.workspaceId, input.resource || CRM_CONTACT_CUSTOM_FIELDS_RESOURCE],
    );
    return normalizeResourceMappingAliasProfile(profileRes.rows[0]?.field_aliases_json).fields;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('resource_mapping_profiles')) {
      console.error('[RESOURCE_MAPPING_PROFILE] Failed to load aliases:', error);
    }
    return {};
  }
}

export async function loadResourceMappingProfileText(input: {
  workspaceId: string;
  resource?: string;
}): Promise<string> {
  const aliases = await loadResourceMappingProfileAliases(input);
  return formatResourceMappingAliasText({ fields: aliases });
}

export async function upsertResourceMappingProfile(input: {
  workspaceId: string;
  aliasesText: string;
  resource?: string;
}): Promise<ResourceMappingAliasProfile> {
  const profile = parseResourceMappingAliasText(input.aliasesText);
  await db.query(
    `INSERT INTO public.resource_mapping_profiles (
       workspace_id,
       resource,
       field_aliases_json,
       mapping_preferences_json,
       updated_at
     ) VALUES ($1, $2, $3::jsonb, '{}'::jsonb, timezone('utc', now()))
     ON CONFLICT (workspace_id, resource)
     DO UPDATE SET
       field_aliases_json = EXCLUDED.field_aliases_json,
       updated_at = timezone('utc', now())`,
    [
      input.workspaceId,
      input.resource || CRM_CONTACT_CUSTOM_FIELDS_RESOURCE,
      JSON.stringify(profile),
    ],
  );
  return profile;
}
