'use client';

import { useState } from 'react';
import { Copy, Loader2, RefreshCw } from 'lucide-react';
import { reconfigureEvolutionWebhook } from '@/actions/evolution-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { EvolutionInstance } from '@/lib/types';

export function EvolutionWebhookPanel({ instance, workspaceId }: {
  instance: Omit<EvolutionInstance, 'status' | 'qrCode'>;
  workspaceId: string;
}) {
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = useState(instance.webhook_url || '');
  const [isSaving, setIsSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `evolution-webhook-${instance.id}`;

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast({ title: 'Link do webhook copiado' });
    } catch {
      toast({ title: 'Não foi possível copiar', description: 'Selecione o link no campo e copie manualmente.', variant: 'destructive' });
    }
  };

  const reconfigure = async () => {
    setIsSaving(true);
    setError(null);
    setConfirmed(false);
    try {
      const result = await reconfigureEvolutionWebhook(instance.id, workspaceId);
      if (!result.success || !result.webhookUrl) {
        setError(result.error || 'Não foi possível reconfigurar o webhook.');
        return;
      }
      setWebhookUrl(result.webhookUrl);
      setConfirmed(true);
      toast({ title: 'Webhook reconfigurado', description: 'URL e eventos confirmados na Evolution API. Envie uma mensagem para testar o recebimento.' });
    } catch {
      setError('Falha ao comunicar com o servidor. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section aria-label={`Webhook de ${instance.display_name}`} className="space-y-2 border-t bg-muted/20 px-5 py-3 md:px-6">
      <Label htmlFor={inputId} className="text-xs font-semibold">Webhook da Evolution API → Dialogy</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id={inputId} readOnly value={webhookUrl} placeholder="Link indisponível: verifique a configuração do servidor" className="min-w-0 flex-1 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copyUrl} disabled={!webhookUrl} aria-label={`Copiar webhook de ${instance.display_name}`}>
            <Copy className="mr-2 h-4 w-4" /> Copiar link
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={reconfigure} disabled={isSaving || !webhookUrl || Boolean(instance.webhook_configuration_error)}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Reconfigurar webhook
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Na Evolution API, use este link com o webhook ativado e “Webhook por eventos” desativado. O link contém uma chave: não o compartilhe publicamente.
        {instance.type === 'wa_cloud' && ' Este endereço não substitui o webhook cadastrado na Meta.'}
      </p>
      {!confirmed && instance.webhook_needs_sync && <p className="text-xs text-amber-700">O endereço salvo está desatualizado. Clique em “Reconfigurar webhook” para aplicar este link.</p>}
      {instance.webhook_configuration_error && <p role="alert" className="text-xs text-destructive">{instance.webhook_configuration_error}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {confirmed && <p role="status" className="text-xs text-emerald-700">Configuração confirmada na Evolution API. O recebimento ainda precisa ser validado com uma mensagem.</p>}
    </section>
  );
}
