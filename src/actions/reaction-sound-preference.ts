'use server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';

async function userId() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) throw new Error('Entre na sua conta novamente.');
  return user.id;
}

export async function getTeamReactionPreference() {
  const id = await userId();
  const result = await db.query('SELECT enabled, muted FROM user_team_reaction_preferences WHERE user_id=$1', [id]);
  return { userId: id, enabled: result.rows[0]?.enabled === true, muted: result.rows[0]?.muted !== false };
}

export async function saveTeamReactionPreference(input: unknown) {
  const enabled = z.boolean().parse(input);
  const id = await userId();
  const result = await db.query(`INSERT INTO user_team_reaction_preferences(user_id,enabled) VALUES($1,$2)
    ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()
    RETURNING muted`, [id, enabled]);
  return { userId: id, enabled, muted: result.rows[0]?.muted !== false };
}

export async function getReactionSoundPreference() {
  const preference = await getTeamReactionPreference();
  return { muted: preference.muted };
}

export async function saveReactionSoundPreference(input: unknown) {
  const muted = z.boolean().parse(input);
  const id = await userId();
  await db.query(`INSERT INTO user_team_reaction_preferences(user_id,muted) VALUES($1,$2)
    ON CONFLICT(user_id) DO UPDATE SET muted=EXCLUDED.muted,updated_at=now()`, [id, muted]);
  return { muted };
}
