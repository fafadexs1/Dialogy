'use server';

import { z } from 'zod';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { transferChatAction } from '@/actions/chats';

const payload = z.object({
  workspaceId: z.string().uuid(),
  operationId: z.string().min(1).max(100).optional(),
  expectedStates: z.record(z.object({agentId:z.string().nullable(),teamId:z.string().nullable(),systemAgentId:z.string().nullable()})).optional(),
  chatIds: z.array(z.string().uuid()).min(1).max(100),
  destination: z.discriminatedUnion('type', [
    z.object({type:z.literal('agent'),id:z.string().uuid()}),
    z.object({type:z.literal('team'),id:z.string().uuid()}),
  ]),
});
export async function transferChatsBulkAction(input: z.infer<typeof payload>) {
  const parsed=payload.safeParse(input);
  if (!parsed.success) return {success:false as const,error:'Selecione até 100 conversas e um destino válido.'};
  const { data:{user} }=await (await createClient()).auth.getUser();
  if (!user) return {success:false as const,error:'Entre na sua conta novamente.'};
  const {workspaceId,destination}=parsed.data;
  if (!(await hasWorkspacePermission(user.id,workspaceId,'inbox:access')) || !(await hasWorkspacePermission(user.id,workspaceId,'teams:view'))) return {success:false as const,error:'Você não tem permissão para transferir conversas neste workspace.'};
  const ids=[...new Set(parsed.data.chatIds)];
  const existing=await db.query('SELECT id,agent_id,team_id,assigned_system_agent_id FROM chats WHERE workspace_id=$1 AND id=ANY($2::uuid[])',[workspaceId,ids]);
  const allowed=new Set(existing.rows.map(row=>String(row.id)));
  const transferred:string[]=[];
  const failed:Array<{id:string;error:string}>=[];
  for (const id of ids) {
    if (!allowed.has(id)) {failed.push({id,error:'Conversa indisponível neste workspace.'});continue;}
    try {
      const snapshot=parsed.data.expectedStates?.[id] ?? existing.rows.find(row=>String(row.id)===id);
      const expected=parsed.data.expectedStates?.[id];
      const result=await transferChatAction({chatId:id,
        operationId:parsed.data.operationId?`${parsed.data.operationId}:${id}`:undefined,
        expectedAgentId:expected?.agentId ?? snapshot?.agent_id ?? null,
        expectedTeamId:expected?.teamId ?? snapshot?.team_id ?? null,
        expectedSystemAgentId:expected?.systemAgentId ?? snapshot?.assigned_system_agent_id ?? null,...(destination.type==='agent'?{agentId:destination.id}:{teamId:destination.id})});
      if (result.success) transferred.push(id);
      else failed.push({id,error:result.error||'Não foi possível transferir esta conversa.'});
    } catch {failed.push({id,error:'Não foi possível confirmar a transferência.'});}
  }
  return {success:true as const,transferred,failed};
}
