'use client';

import { useEffect, useId, useState } from 'react';
import { useCurrentUser } from '@/hooks/use-online-status';
import { getNexusGoogleAdsOptions } from '../actions/workflows';

export function GoogleAdsLeadFields({ config, onChange }: { config: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  const user = useCurrentUser();
  const id = useId();
  const [options, setOptions] = useState<Awaited<ReturnType<typeof getNexusGoogleAdsOptions>> | null>(null);
  const [status, setStatus] = useState('Carregando integração…');
  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setStatus('Carregando integração…');
    if (user?.activeWorkspaceId) void getNexusGoogleAdsOptions(user.activeWorkspaceId).then((result) => {
      if (!cancelled) { setOptions(result); setStatus(result.connected ? '' : 'Conecte o Google Ads nas integrações desta workspace.'); }
    }).catch(() => { if (!cancelled) setStatus('Não foi possível carregar a integração desta workspace.'); });
    return () => { cancelled = true; };
  }, [user?.activeWorkspaceId]);
  const accountSelected = options?.connected && config.customerId === options.customerId;
  const conversion = options?.conversions.find((item) => item.eventName === config.eventName && item.conversionActionId === config.conversionActionId);
  const selectClass = 'mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Envia o contato deste fluxo como conversão. O envio só é solicitado quando o fluxo alcançar este bloco.</p>
    {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
    <div><label htmlFor={`${id}-account`} className="text-sm font-medium">Conta do Google Ads</label><select id={`${id}-account`} className={selectClass} value={accountSelected ? options.customerId : ''} onChange={(event) => onChange({ customerId: event.target.value, conversionActionId: '' })}><option value="">Selecione a conta</option>{options?.connected && <option value={options.customerId}>Conta {options.customerId} · esta workspace</option>}</select></div>
    <div><label htmlFor={`${id}-conversion`} className="text-sm font-medium">Conversão a enviar</label><select id={`${id}-conversion`} className={selectClass} disabled={!accountSelected} value={conversion?.eventName || ''} onChange={(event) => { const selected = options?.conversions.find((item) => item.eventName === event.target.value); onChange({ eventName: selected?.eventName || '', conversionActionId: selected?.conversionActionId || '' }); }}><option value="">Selecione a conversão</option>{options?.conversions.map((item) => <option key={item.eventName} value={item.eventName}>{item.label} · {item.conversionActionId.split('/').pop()}</option>)}</select></div>
    {options?.connected && !options.conversions.length && <p className="text-sm text-muted-foreground">Configure uma ação de conversão na integração Google Ads para continuar.</p>}
    <p className="text-xs text-muted-foreground">O contato precisa ter atribuição de anúncio elegível. Sucesso neste bloco significa que o envio está na fila, ainda sem confirmação do Google. Repetir a mesma conversão para o mesmo contato não cria outro envio.</p>
  </div>;
}
