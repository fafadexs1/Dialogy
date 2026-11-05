'use server';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { distributionDiagnostics } from '@/services/chat-distribution/diagnostics';
import {getWorkspaceTeamAvailability} from '@/services/chat-distribution/team-availability-server';

export async function getDistributionDiagnosticsAction(teamId:string) {
  const {data:{user}}=await (await createClient()).auth.getUser();
  if(!user) return {success:false as const,error:'Entre na sua conta novamente.'};
  const team=await db.query('SELECT workspace_id FROM teams WHERE id=$1',[teamId]);
  const workspaceId=team.rows[0]?.workspace_id;
  if(!workspaceId || !await hasWorkspacePermission(user.id,workspaceId,'teams:view')) return {success:false as const,error:'Equipe indisponível.'};
  try {
    const diagnostics=await distributionDiagnostics(db,workspaceId,teamId);
    const availability=(await getWorkspaceTeamAvailability(workspaceId)).find(team=>team.teamId===teamId);
    return {success:true as const,diagnostics,availability};
  } catch(error) {
    console.error('[DISTRIBUTION_DIAGNOSTICS]',error);
    return {success:false as const,error:'Não foi possível consultar a distribuição. Verifique se a atualização do banco foi aplicada.'};
  }
}
