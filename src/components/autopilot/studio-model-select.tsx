'use client';

import { useEffect, useId } from 'react';
import Link from 'next/link';
import { getAiModelProviderLabel, resolveConfiguredAiModel, type AiModelCatalogEntry } from '@/lib/ai-models';
import { Label } from '@/components/ui/label';

export function StudioModelSelect({ models, value, onChange, disabled = false }: {
  models: AiModelCatalogEntry[];
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const options = models.filter((model) => model.enabled);
  const selected = options.find((model) => model.id === value);
  const effectiveValue = selected ? value : (resolveConfiguredAiModel(value, options) || value);
  const effectiveSelected = options.find((model) => model.id === effectiveValue);

  useEffect(() => {
    if (value && !selected && effectiveSelected && effectiveValue !== value) {
      onChange(effectiveValue);
    }
  }, [value, selected, effectiveSelected, effectiveValue, onChange]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Modelo de IA</Label>
      <select id={id} aria-describedby={`${id}-help`} value={effectiveValue} onChange={(event) => onChange(event.target.value)}
        disabled={disabled || options.length === 0} className="w-full min-w-0 rounded-md border border-input bg-background p-2 text-sm text-foreground disabled:opacity-60">
        {!effectiveValue && <option value="" disabled>Selecione um modelo cadastrado</option>}
        {effectiveValue && !effectiveSelected && <option value={effectiveValue} disabled>Atual: {effectiveValue} · cadastro indisponível</option>}
        {options.map((model) => <option key={model.id} value={model.id}>{getAiModelProviderLabel(model.provider)} · {model.label}</option>)}
      </select>
      <p id={`${id}-help`} className="text-xs font-normal text-muted-foreground">
        {options.length === 0 ? 'Nenhum modelo cadastrado e ativo neste workspace. Cadastre um na aba Modelos de IA para continuar.'
          : 'Escolha um dos modelos que você já cadastrou e ativou na aba Modelos de IA.'}
      </p>
      <Link href="/integrations/ai" className="inline-block text-xs font-medium text-primary underline">Abrir Modelos de IA</Link>
    </div>
  );
}
