'use server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { buildPresenceAvailabilitySql, getPresenceRecentActivitySeconds, getPresenceTtlSeconds } from '@/lib/presence';
import { broadcastRealtimeEvent } from '@/lib/realtime/broadcast';
import { consumeRateLimit } from '@/lib/ratelimit';
import { isReactionKind, reactionTopic } from '@/lib/team-reactions/catalog';
import { isSafeGifUrl } from '@/lib/team-reactions/gifs';
import { reserveReactionDelivery, releaseReactionDelivery, renewReactionDelivery } from '@/lib/team-reactions/delivery-guard';

const schema = z.object({ workspaceId: z.string().uuid(), targetId: z.string().uuid(), kind: z.string().refine(value => value === 'gif' || isReactionKind(value)), gifId: z.string().uuid().optional(), message: z.string().trim().max(140).optional() }).refine(value => value.kind !== 'gif' || !!value.gifId);
export async function sendTeamReaction(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Escolha uma brincadeira válida.' };
  const { workspaceId, targetId, kind } = parsed.data;
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user || !await hasWorkspacePermission(user.id, workspaceId, 'inbox:access')) return { success: false, error: 'Não foi possível enviar para esta pessoa.' };
  if (!consumeRateLimit(`team-reaction:${workspaceId}:${user.id}`, 6, 30_000).ok) return { success: false, error: 'Calma aí! Espere um pouquinho antes de enviar outra.' };
  const available = buildPresenceAvailabilitySql('p', '$3', '$4');
  const result = await db.query(`SELECT sender.full_name AS sender_name, preference.enabled AS reactions_enabled FROM users sender
    JOIN workspaces w ON w.id=$1
    JOIN users recipient ON recipient.id=$2
    LEFT JOIN user_team_reaction_preferences preference ON preference.user_id=recipient.id
    JOIN user_workspace_presence p ON p.user_id=recipient.id AND p.workspace_id=w.id
    WHERE sender.id=$5 AND ${available}
    AND (w.owner_id=recipient.id OR EXISTS (SELECT 1 FROM user_workspace_roles r WHERE r.workspace_id=w.id AND r.user_id=recipient.id))`,
    [workspaceId,targetId,getPresenceTtlSeconds(),getPresenceRecentActivitySeconds(),user.id]);
  if (!result.rows.length) return { success: false, error: 'Esta pessoa não está mais disponível neste workspace.' };
  if (result.rows[0].reactions_enabled !== true) return { success: false, error: 'Esta pessoa desativou as surpresas da equipe.' };
  let gif: {url:string; name:string; sound:string} | undefined;
  if (kind === 'gif') {
    const saved = await db.query('SELECT url,name,sound FROM workspace_team_gifs WHERE workspace_id=$1 AND id=$2', [workspaceId, parsed.data.gifId]);
    const item = saved.rows[0];
    if (!item || !isSafeGifUrl(item.url)) return {success:false,error:'Este GIF não está mais disponível na biblioteca.'};
    gif = {url:item.url,name:item.name,sound:item.sound};
  }
  const reactionId = randomUUID();
  if (!await reserveReactionDelivery(targetId, reactionId)) return { success:false, error:'Esta pessoa já está vendo uma surpresa. Aguarde alguns segundos e tente novamente.' };
  try {
    const delivered = await broadcastRealtimeEvent(reactionTopic(targetId), 'team_reaction', {
      id: reactionId, kind, senderName: String(result.rows[0].sender_name || 'Alguém da equipe').slice(0,80), workspaceId, ...(gif ? {gif} : {}), ...(parsed.data.message ? {message: parsed.data.message} : {}),
    });
    if (delivered === 'failed') {
      await releaseReactionDelivery(targetId,reactionId).catch(() => undefined);
      return { success: false, error: 'Não foi possível enviar agora. Tente novamente.' };
    }
    return { success: true };
  } catch {
    await releaseReactionDelivery(targetId,reactionId).catch(() => undefined);
    return { success:false, error:'Não foi possível enviar agora. Tente novamente.' };
  }
}

/** Only the recipient can keep their own displayed reaction reserved. */
export async function keepTeamReactionVisible(reactionId:unknown) {
 const parsed=z.string().uuid().safeParse(reactionId);
 if(!parsed.success)return {success:false};
 const {data:{user}}=await (await createClient()).auth.getUser();
 if(!user)return {success:false};
 return {success:await renewReactionDelivery(user.id,parsed.data)};
}
