'use client';

import { useEffect, useId, useState } from 'react';
import { useCurrentUser } from '@/hooks/use-online-status';
import { getNexusCrmOptionFields } from '../actions/workflows';
import type { CrmOptionCondition } from '../services/crm-option-trigger';

export function CrmOptionFields({ value, onChange }: { value: CrmOptionCondition; onChange: (value: CrmOptionCondition) => void }) {
  const user = useCurrentUser();
  const id = useId();
  const [fields, setFields] = useState<Awaited<ReturnType<typeof getNexusCrmOptionFields>>>([]);
  const [status, setStatus] = useState('Carregando campos…');
  useEffect(() => {
    let cancelled = false;
    setFields([]);
    setStatus('Carregando campos…');
    if (user?.activeWorkspaceId) void getNexusCrmOptionFields(user.activeWorkspaceId).then((result) => {
      if (!cancelled) { setFields(result); setStatus(result.length ? '' : 'Crie um campo de seleção nas configurações do CRM para continuar.'); }
    }).catch(() => { if (!cancelled) setStatus('Não foi possível carregar os campos desta workspace.'); });
    return () => { cancelled = true; };
  }, [user?.activeWorkspaceId]);
  const selected = fields.find((field) => field.id === value.fieldId);
  const selectClass = 'mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Quando uma opção mudar e o contato for salvo, executar as ações deste fluxo. Novos contatos com essa opção também acionam o gatilho.</p>
    {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
    <div><label htmlFor={`${id}-field`} className="text-sm font-medium">Campo do CRM</label><select id={`${id}-field`} className={selectClass} value={selected?.id || ''} onChange={(event) => onChange({ fieldId: event.target.value, value: '' })}><option value="">Selecione um campo</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></div>
    <div><label htmlFor={`${id}-value`} className="text-sm font-medium">Quando a opção for igual a</label><select id={`${id}-value`} className={selectClass} disabled={!selected} value={value.value} onChange={(event) => onChange({ ...value, value: event.target.value })}><option value="">Selecione uma opção</option>{(selected?.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
  </div>;
}
