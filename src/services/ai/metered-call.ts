import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { requirePlatformAiConfig } from './platform-config';
import { reserveAiCredits, settleAiCredits, finishAiCreditCall } from './credits';

export type AiUsage = { inputTokens: number; outputTokens: number };
const activeCall = new AsyncLocalStorage<{model:string;workspaceId:string;recordUsage:(usage:AiUsage)=>Promise<void>}>();

export async function meteredAiCall<T>(input: {
  workspaceId?: string | null; model: string; source: string;
  inputTokenBudget?: number; outputTokenBudget?: number;
  independent?: boolean;
  execute: (recordUsage: (usage: AiUsage) => Promise<void>) => Promise<T>;
}) {
  const parent = activeCall.getStore();
  if (parent && !input.independent) {
    if(input.model!==parent.model || (input.workspaceId && input.workspaceId!==parent.workspaceId)) throw new Error('A chamada de IA mudou de escopo durante a execucao.');
    return input.execute(parent.recordUsage);
  }
  const config = await requirePlatformAiConfig();
  const model = config.models.find(m => m.id === input.model && m.enabled);
  if (!model) throw new Error('Modelo nao autorizado pela plataforma.');
  if (!config.billingEnabled) return input.execute(async () => {});
  if (!input.workspaceId) throw new Error('Consumo de IA sem workspace identificado.');
  const id = await reserveAiCredits({ workspaceId: input.workspaceId, source: input.source, config, model,
    inputTokens: input.inputTokenBudget ?? 65536, outputTokens: input.outputTokenBudget ?? 32768 });
  let settled = false;
  let receivedUsage = false;
  try {
    const recordUsage = async (usage: AiUsage) => {
      if (settled) return;
      receivedUsage = true;
      await settleAiCredits(id, usage);
      settled = true;
    };
    const result = await activeCall.run({model:input.model,workspaceId:input.workspaceId,recordUsage}, () => input.execute(recordUsage));
    if (!settled) {
      await finishAiCreditCall(id, true);
      throw new Error('O provedor nao informou o consumo. A reserva aguarda conciliacao pelo administrador.');
    }
    return result;
  } catch (error) {
    if (!settled) {
      const status = (error as { status?: number })?.status;
      // Timeouts and transport failures can happen after provider execution.
      const definitelyRejected = !receivedUsage && status != null && [400,401,403,404,422,429].includes(status);
      await finishAiCreditCall(id, !definitelyRejected);
    }
    throw error;
  }
}
