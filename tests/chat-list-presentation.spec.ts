import { describe, expect, it } from 'vitest';

import {
  badgeColorStyle,
  isUsableBadgeColor,
  readableTextColor,
} from '@/lib/color-contrast';
import { buildChatTeamLateralSql } from '@/lib/chat-team-resolution';

describe('badge contrast', () => {
  it('picks dark text on light backgrounds that are not literally #fff', () => {
    // A regra antiga era `cor.startsWith('#fff')`, entao todos estes recebiam
    // texto branco e a etiqueta sumia.
    for (const light of ['#f5f5f5', '#FFEB3B', '#e0e0e0', '#c8e6c9', '#fafafa']) {
      expect(readableTextColor(light)).toBe('#0f172a');
    }
  });

  it('picks light text on dark backgrounds', () => {
    for (const dark of ['#1e293b', '#0B0B10', '#7c3aed', '#b91c1c']) {
      expect(readableTextColor(dark)).toBe('#ffffff');
    }
  });

  it('accepts short hex and rgb() notations', () => {
    expect(readableTextColor('#fff')).toBe('#0f172a');
    expect(readableTextColor('#000')).toBe('#ffffff');
    expect(readableTextColor('rgb(20, 20, 20)')).toBe('#ffffff');
  });

  it('refuses colors that cannot serve as a solid chip background', () => {
    // O fundo padrao de antes: branco a 10%. Com texto branco por cima, a
    // etiqueta ficava invisivel no tema claro.
    expect(isUsableBadgeColor('rgba(255,255,255,0.1)')).toBe(false);
    expect(isUsableBadgeColor('#ffffff20')).toBe(false);
    expect(isUsableBadgeColor(undefined)).toBe(false);
    expect(isUsableBadgeColor(null)).toBe(false);
    expect(isUsableBadgeColor('')).toBe(false);
    expect(isUsableBadgeColor('   ')).toBe(false);
    expect(isUsableBadgeColor('not-a-color')).toBe(false);
  });

  it('returns null styling when there is no usable color, so the theme class wins', () => {
    expect(badgeColorStyle(null)).toBeNull();
    expect(badgeColorStyle('rgba(255,255,255,0.1)')).toBeNull();

    expect(badgeColorStyle('#FFEB3B')).toEqual({
      backgroundColor: '#FFEB3B',
      color: '#0f172a',
      borderColor: '#FFEB3B',
    });
  });
});

describe('chat team resolution', () => {
  const sql = buildChatTeamLateralSql({ chatAlias: 'c' });

  it('reads the team stored on the chat as the primary source', () => {
    expect(sql).toContain('c.team_id');
    expect(sql.indexOf('c.team_id')).toBeLessThan(sql.indexOf('team_members'));
  });

  it('keeps the legacy membership guess only as a fallback', () => {
    expect(sql).toContain('COALESCE(');
    expect(sql).toContain('FROM team_members tm');
    expect(sql).toContain('WHERE tm.user_id = c.agent_id');
  });

  it('scopes both sources to the chat workspace', () => {
    const workspaceScopes = sql.match(/workspace_id = c\.workspace_id/g) ?? [];
    expect(workspaceScopes.length).toBeGreaterThanOrEqual(2);
  });

  it('honours the requested aliases', () => {
    const aliased = buildChatTeamLateralSql({ chatAlias: 'chat', alias: 'resolved_team' });
    expect(aliased).toContain('chat.team_id');
    expect(aliased).toContain(') resolved_team ON true');
    expect(aliased).not.toContain('c.team_id');
  });
});
