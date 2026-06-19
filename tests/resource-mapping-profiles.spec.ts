import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import {
  formatResourceMappingAliasText,
  loadResourceMappingProfileAliases,
  normalizeResourceMappingAliasProfile,
  parseResourceMappingAliasText,
  upsertResourceMappingProfile,
} from '@/services/resource-mapper/profiles';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

describe('resource mapping profiles', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
  });

  it('parses editable alias text into a bounded field profile', () => {
    const profile = parseResourceMappingAliasText(`
      Nome completo: nome, titular, cliente, nome
      CPF = documento, cpf/cnpj
      linha invalida sem separador
      Endereco:
    `);

    expect(profile).toEqual({
      fields: {
        'Nome completo': ['nome', 'titular', 'cliente'],
        CPF: ['documento', 'cpf/cnpj'],
      },
    });
  });

  it('formats both wrapped and legacy alias profile shapes', () => {
    expect(formatResourceMappingAliasText({
      fields: {
        CPF: ['documento', 'cpf/cnpj'],
      },
    })).toBe('CPF: documento, cpf/cnpj');

    expect(formatResourceMappingAliasText({
      Telefone: ['whatsapp'],
    })).toBe('Telefone: whatsapp');
  });

  it('normalizes JSON strings and drops empty aliases', () => {
    expect(normalizeResourceMappingAliasProfile(JSON.stringify({
      fields: {
        CPF: ['documento', '', 'cpf'],
        vazio: [],
      },
    }))).toEqual({
      fields: {
        CPF: ['documento', 'cpf'],
      },
    });
  });

  it('loads aliases from the workspace profile table', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{
        field_aliases_json: {
          fields: {
            'field-cpf': ['cpf', 'documento'],
          },
        },
      }],
    } as any);

    await expect(loadResourceMappingProfileAliases({
      workspaceId: 'workspace-1',
    })).resolves.toEqual({
      'field-cpf': ['cpf', 'documento'],
    });
  });

  it('degrades to an empty profile before the migration exists', async () => {
    vi.mocked(db.query).mockRejectedValueOnce(new Error('relation "resource_mapping_profiles" does not exist'));

    await expect(loadResourceMappingProfileAliases({
      workspaceId: 'workspace-1',
    })).resolves.toEqual({});
  });

  it('upserts a normalized alias profile', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any);

    await upsertResourceMappingProfile({
      workspaceId: 'workspace-1',
      aliasesText: 'CPF: documento, cpf',
    });

    expect(vi.mocked(db.query).mock.calls[0]?.[0]).toContain('INSERT INTO public.resource_mapping_profiles');
    expect(vi.mocked(db.query).mock.calls[0]?.[1]).toEqual([
      'workspace-1',
      'crm.contact.custom_fields',
      JSON.stringify({ fields: { CPF: ['documento', 'cpf'] } }),
    ]);
  });
});
