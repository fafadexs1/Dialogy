'use client';

import { createContext, useContext, useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { Textarea } from '@/components/ui/textarea';

export const WorkflowFormValidation = createContext<{
  report: (key: string, message: string | null) => void;
  drafts: Map<string, string>;
  revision: number;
} | null>(null);

export function WorkflowJsonField({ value, onValueChange, fieldKey, ...props }: Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & { value: unknown; onValueChange: (value: unknown) => void; fieldKey: string }) {
  const context = useContext(WorkflowFormValidation);
  const id = useId();
  const serialized = JSON.stringify(value ?? {}, null, 2);
  const [draft, setDraft] = useState(() => context?.drafts.get(fieldKey) ?? serialized);
  const [error, setError] = useState('');
  const lastCommit = useRef({ key: '', serialized: '', revision: -1 });
  useEffect(() => {
    if (lastCommit.current.key === fieldKey && lastCommit.current.serialized === serialized && lastCommit.current.revision === (context?.revision ?? 0)) return;
    lastCommit.current = { key: fieldKey, serialized, revision: context?.revision ?? 0 };
    const next = context?.drafts.get(fieldKey) ?? serialized;
    setDraft(next);
    try { JSON.parse(next); setError(''); context?.report(fieldKey, null); }
    catch { setError('JSON inválido. Revise a sintaxe antes de salvar.'); context?.report(fieldKey, 'JSON inválido'); }
  }, [fieldKey, serialized, context]);
  return <div><Textarea {...props} id={props.id || id} value={draft} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : props['aria-describedby']}
    onChange={(event) => {
      const next = event.target.value;
      setDraft(next);
      try {
        const parsed = JSON.parse(next);
        lastCommit.current = { key: fieldKey, serialized: JSON.stringify(parsed, null, 2), revision: context?.revision ?? 0 };
        setError(''); context?.report(fieldKey, null); context?.drafts.delete(fieldKey);
        onValueChange(parsed);
      } catch {
        setError('JSON inválido. Revise a sintaxe antes de salvar.'); context?.report(fieldKey, 'JSON inválido'); context?.drafts.set(fieldKey, next);
      }
    }} />{error && <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-[var(--wf-danger)]">{error}</p>}</div>;
}
