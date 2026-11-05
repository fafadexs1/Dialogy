import 'server-only';
import { z } from 'zod';
import { db } from '@/lib/db';
import type { NodeExecutionResult, NodeRuntimeInput } from '@/services/workflow-runtime/types';
import { requestAutomationApproval } from './automation-approvals';
import { executeDurableEffect } from './durable-effects';
import { waitForAutomatedProviderAcceptance } from '@/services/autopilot/runtime/provider-delivery';
import { loadStudioConversationTurns } from '@/services/agent-studio/history';

const messageSchema = z.object({ text: z.string().trim().min(1).max(4096) }).strict();
export const whatsappReplyJsonSchema = { type:'object', properties:{ text:{ type:'string', minLength:1, maxLength:4096, description:'Texto da resposta para o atendimento atual' } }, required:['text'], additionalProperties:false };
type Delivery = { success?: boolean; error?: unknown; providerAccepted?: boolean; message?: { id?: string | null } | null };

/** Resolve only the current inbound conversation on an official channel in this workspace. */
async function resolveTarget(input: NodeRuntimeInput) {
  const workspaceId = input.workflow.workspaceId, chatId = input.execution.conversationId;
  const sourceId = input.execution.context.sourceMessageId, instanceName = input.execution.context.instanceName;
  if (!workspaceId || !chatId || typeof sourceId !== 'string' || typeof instanceName !== 'string' || !instanceName) throw new Error('Esta ferramenta exige uma mensagem recebida em um atendimento WhatsApp ativo.');
  const { rows } = await db.query(`SELECT c.id::text AS chat_id, c.contact_id::text AS contact_id,
      ct.phone_number_jid, e.id::text AS instance_id, e.instance_name
    FROM chats c
    JOIN contacts ct ON ct.id=c.contact_id AND ct.workspace_id=c.workspace_id
    JOIN messages m ON m.id=$3 AND m.chat_id=c.id AND m.workspace_id=c.workspace_id
    JOIN evolution_api_instances e ON e.workspace_id=c.workspace_id AND e.instance_name=m.instance_name
    WHERE c.workspace_id=$1 AND c.id=$2 AND m.from_me=FALSE AND m.instance_name=$4
      AND m.type<>'system' AND COALESCE(m.metadata->>'isInternalNote','false')<>'true'
      AND m.created_at<=clock_timestamp() AND m.created_at>clock_timestamp()-interval '24 hours'
      AND e.type='wa_cloud' LIMIT 1`, [workspaceId,chatId,sourceId,instanceName]);
  const row=rows[0];
  if (!row || !row.contact_id || !row.instance_id || !row.phone_number_jid) throw new Error('Conversa oficial indisponível ou fora da janela de atendimento de 24 horas.');
  return { chatId:String(row.chat_id), contactId:String(row.contact_id), recipient:String(row.phone_number_jid), instanceId:String(row.instance_id), instanceName:String(row.instance_name), sourceMessageId:sourceId };
}

/** Only the current authorized chat is readable; the triggering message is already in context. */
export async function readWhatsappAgentHistory(input: NodeRuntimeInput) {
  const target=await resolveTarget(input);
  const turns=await loadStudioConversationTurns(input.workflow.workspaceId!,target.chatId,target.sourceMessageId,true);
  if (JSON.stringify(await resolveTarget(input)) !== JSON.stringify(target)) throw new Error('A conversa ou o canal mudou durante a consulta.');
  return { chatId:target.chatId, messages:turns.slice(-20).map(turn=>({ ...turn, content:turn.content.slice(0,2000) })) };
}

/** Approval and durable effect bind the message to its original chat and channel. */
export async function sendWhatsappAgentReply(input: NodeRuntimeInput, raw: unknown, invocationId: string, send: (text:string, runtimeInput:NodeRuntimeInput)=>Promise<Delivery>): Promise<NodeExecutionResult> {
  const { text }=messageSchema.parse(raw);
  const workspaceId=input.workflow.workspaceId!;
  const target=await resolveTarget(input);
  const proposal={ ...target, text };
  const pending=await requestAutomationApproval(input,proposal,'Enviar resposta no WhatsApp Business',invocationId);
  if(pending) return pending;
  const checked=await resolveTarget(input);
  if(JSON.stringify(checked)!==JSON.stringify(target)) throw new Error('A conversa ou o canal mudou; a aprovação não pode ser reutilizada.');
  const result=await executeDurableEffect(workspaceId,invocationId,proposal,async()=>{
    const sent=await send(text,{...input,node:{...input.node,id:invocationId}});
    await waitForAutomatedProviderAcceptance({result:{...sent,success:sent.success===true,error:typeof sent.error==='string'?sent.error:undefined},chatId:target.chatId});
    return {accepted:true};
  });
  return {status:'success',output:result};
}
