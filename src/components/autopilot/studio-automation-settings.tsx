'use client';

import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StudioAutomationSchema, type StudioAutomation } from '@/services/agent-studio/types';

const control = 'mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white';
const hint = 'mt-1 block text-slate-400';

const clamp = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min);

function Toggle({ id, checked, onChange, title, children }: { id: string; checked: boolean; onChange: (value: boolean) => void; title: string; children?: ReactNode }) {
  return <div className="space-y-1">
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2 font-medium">
      <input id={id} type="checkbox" className="mt-0.5" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{title}</span>
    </label>
    {children && <p className="pl-6 text-slate-400">{children}</p>}
  </div>;
}

function NumberField({ id, label, value, min, max, unit, onChange }: { id: string; label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  return <label htmlFor={id} className="block">{label}
    <div className="mt-1 flex items-center gap-2">
      <Input id={id} type="number" min={min} max={max} className="w-24 border-slate-700 bg-slate-950 text-xs text-white" value={value}
        onChange={(event) => onChange(clamp(Number(event.target.value), min, max))} />
      <span className="text-slate-400">{unit}</span>
    </div>
  </label>;
}

/**
 * What this company wants the agent to do on its own: hand over, close, follow up. Saved in the draft and versioned with each
 * publication, so every company decides for its own agents. Nothing here is a server setting.
 */
export function StudioAutomationSettings({ automation: stored, onChange, teams }: {
  automation: StudioAutomation | undefined;
  onChange: (automation: StudioAutomation) => void;
  teams: { id: string; name: string }[];
}) {
  const automation = StudioAutomationSchema.parse(stored ?? {});
  const patch = (value: Partial<StudioAutomation>) => onChange({ ...automation, ...value });
  const inactivity = (value: Partial<StudioAutomation['inactivity']>) => patch({ inactivity: { ...automation.inactivity, ...value } });
  const queue = (value: Partial<StudioAutomation['queue']>) => patch({ queue: { ...automation.queue, ...value } });
  const windowInvalid = automation.inactivity.enabled && automation.inactivity.windowStartHour >= automation.inactivity.windowEndHour;
  const queueOrderInvalid = automation.queue.enabled && automation.queue.escalateAfterMinutes <= automation.queue.alertAfterMinutes;
  const webhookInvalid = Boolean(automation.queue.alertWebhookUrl) && !/^https:\/\/[^\s/@]+(\/\S*)?$/i.test(automation.queue.alertWebhookUrl!);

  return <section aria-labelledby="studio-automation-title" className="space-y-5 rounded-xl border border-slate-700 p-4">
    <div>
      <h4 id="studio-automation-title" className="text-sm font-semibold">Autonomia do agente</h4>
      <p className="mt-1 text-slate-400">Escolha o que o agente pode fazer sozinho. Cada opção só vale depois que você publicar, e você pode desligá-la a qualquer momento publicando de novo.</p>
    </div>

    <Toggle id="auto-human" checked={automation.transferWhenCustomerAsksForPerson} onChange={(value) => patch({ transferWhenCustomerAsksForPerson: value })}
      title="Transferir na hora quando o cliente pedir uma pessoa">
      Sem esperar a IA pensar. Vale para pedidos claros, como “quero falar com um atendente”. Frases ambíguas, como “pode chamar o técnico?”, não transferem.
    </Toggle>

    <Toggle id="auto-close" checked={automation.closeOnCustomerConfirmation} onChange={(value) => patch({ closeOnCustomerConfirmation: value })}
      title="Encerrar o atendimento só quando o cliente confirmar que acabou">
      O agente deixa a conversa aberta até o cliente se despedir, por exemplo “obrigado, era só isso”. Se o cliente ainda tiver dúvida, ou tiver algo em andamento, o atendimento não é encerrado.
    </Toggle>

    <div className="space-y-2">
      <Toggle id="auto-inactivity" checked={automation.inactivity.enabled} onChange={(value) => inactivity({ enabled: value })}
        title="Avisar e encerrar quando o cliente parar de responder">
        O agente manda um aviso e, se o cliente continuar em silêncio, encerra. Nunca encerra sem avisar antes e só age dentro do horário abaixo.
      </Toggle>
      {automation.inactivity.enabled && <div className="space-y-3 rounded-lg border border-slate-800 p-3">
        <div className="flex flex-wrap gap-4">
          <NumberField id="auto-in-followup" label="Avisar depois de" value={automation.inactivity.followupMinutes} min={10} max={1440} unit="minutos sem resposta" onChange={(value) => inactivity({ followupMinutes: value })} />
          <NumberField id="auto-in-close" label="Encerrar depois de mais" value={automation.inactivity.closeMinutes} min={10} max={1440} unit="minutos" onChange={(value) => inactivity({ closeMinutes: value })} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <NumberField id="auto-in-start" label="Só agir a partir das" value={automation.inactivity.windowStartHour} min={0} max={23} unit="h" onChange={(value) => inactivity({ windowStartHour: value })} />
          <NumberField id="auto-in-end" label="até as" value={automation.inactivity.windowEndHour} min={1} max={24} unit="h" onChange={(value) => inactivity({ windowEndHour: value })} />
        </div>
        {windowInvalid && <p role="alert" className="text-amber-400">O horário inicial precisa ser antes do final.</p>}
        <p className="text-slate-400">O mínimo é de 10 minutos em cada espera, para o cliente nunca ser encerrado às pressas.</p>
        <label className="block">Mensagem de aviso · opcional
          <Textarea className={control} maxLength={500} value={automation.inactivity.followupMessage} onChange={(event) => inactivity({ followupMessage: event.target.value })}
            placeholder="Oi! Você ainda está por aí? Se precisar de mais alguma coisa, é só me dizer. Se não precisar, vou encerrar este atendimento em breve." />
          <span className={hint}>Em branco usa a mensagem padrão mostrada acima.</span>
        </label>
        <label className="block">Mensagem ao encerrar · opcional
          <Textarea className={control} maxLength={500} value={automation.inactivity.closeMessage} onChange={(event) => inactivity({ closeMessage: event.target.value })}
            placeholder="Como não tivemos retorno, estou encerrando este atendimento por aqui. Se precisar de algo, é só chamar de novo!" />
        </label>
      </div>}
    </div>

    <label className="block font-medium">Quando a resposta prometer algo que não aconteceu
      <select className={control} value={automation.promiseGuard} onChange={(event) => patch({ promiseGuard: event.target.value as StudioAutomation['promiseGuard'] })}>
        <option value="observe">Só registrar para eu acompanhar (recomendado para começar)</option>
        <option value="enforce">Corrigir antes de enviar</option>
        <option value="off">Não verificar</option>
      </select>
      <span className={`${hint} font-normal`}>Exemplos: dizer “já encaminhei” sem ter transferido, ou “reservei o horário” sem ter reservado. Corrigir remove essa frase da resposta antes de chegar ao cliente.</span>
    </label>

    <div className="space-y-2">
      <Toggle id="auto-queue" checked={automation.queue.enabled} onChange={(value) => queue({ enabled: value })}
        title="Acompanhar a fila quando a equipe não tiver ninguém disponível">
        Vale para conversas que este agente transferiu e ficaram esperando uma pessoa. Conversas que esperam porque a equipe está fora do expediente não entram.
      </Toggle>
      {automation.queue.enabled && <div className="space-y-3 rounded-lg border border-slate-800 p-3">
        <div className="flex flex-wrap gap-4">
          <NumberField id="auto-q-alert" label="Alertar depois de" value={automation.queue.alertAfterMinutes} min={2} max={1440} unit="minutos na fila" onChange={(value) => queue({ alertAfterMinutes: value })} />
          <NumberField id="auto-q-escalate" label="Escalonar depois de" value={automation.queue.escalateAfterMinutes} min={3} max={2880} unit="minutos" onChange={(value) => queue({ escalateAfterMinutes: value })} />
        </div>
        {queueOrderInvalid && <p role="alert" className="text-amber-400">O escalonamento precisa vir depois do alerta.</p>}
        <label className="block">Equipe que recebe a conversa se ninguém atender
          <select className={control} value={automation.queue.escalationTeamId ?? ''} onChange={(event) => queue({ escalationTeamId: event.target.value || null })}>
            <option value="">Nenhuma: apenas marcar como “precisa de atenção”</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <Toggle id="auto-q-notice" checked={automation.queue.notifyCustomer} onChange={(value) => queue({ notifyCustomer: value })} title="Avisar o cliente que ele continua na fila" />
        <label className="block">Endereço para receber alertas · opcional
          <Input type="url" className="mt-1 border-slate-700 bg-slate-950 text-xs text-white" maxLength={500} placeholder="https://..." value={automation.queue.alertWebhookUrl ?? ''}
            aria-invalid={webhookInvalid} onChange={(event) => queue({ alertWebhookUrl: event.target.value.trim() || null })} />
          <span className={hint}>Recebe só identificadores e minutos de espera, nunca o texto da conversa. Precisa ser https.</span>
        </label>
        {webhookInvalid && <p role="alert" className="text-amber-400">Use um endereço https válido, sem usuário e senha.</p>}
      </div>}
    </div>
  </section>;
}
