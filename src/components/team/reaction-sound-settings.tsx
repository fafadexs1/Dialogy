'use client';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { saveReactionSoundPreference, saveTeamReactionPreference } from '@/actions/reaction-sound-preference';
import { notifyTeamReactionPreference } from '@/lib/team-reactions/preferences';
import { useTeamReactionPreferences } from '@/hooks/use-team-reaction-preferences';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export function ReactionSoundSettings() {
  const user = useCurrentUser();
  const preference = useTeamReactionPreferences(user?.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(kind: 'receive' | 'sound', value: boolean) {
    if (!user?.id) return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'receive') notifyTeamReactionPreference(await saveTeamReactionPreference(value));
      else {
        const result = await saveReactionSoundPreference(!value);
        notifyTeamReactionPreference({ userId: user.id, enabled: preference.enabled, muted: result.muted });
      }
    } catch { setError('Não foi possível salvar esta preferência.'); }
    finally { setBusy(false); }
  }
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" />Surpresas da equipe</CardTitle>
      <CardDescription>GIFs, figurinhas e brincadeiras ficam desligados por padrão. Ative somente se quiser receber na sua tela.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
        <div><Label htmlFor="receive-team-reactions">Receber GIFs e brincadeiras da equipe</Label><p className="mt-1 text-xs text-muted-foreground">Quando desativado, nenhuma surpresa aparece ou toca som. Sua escolha vale para sua conta.</p></div>
        <Switch id="receive-team-reactions" checked={preference.enabled} disabled={!preference.ready || busy} onCheckedChange={value => void change('receive', value)} />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
        <div><Label htmlFor="team-reaction-sound">Tocar sons das surpresas</Label><p className="mt-1 text-xs text-muted-foreground">Permita som nas surpresas que você escolheu receber.</p></div>
        <Switch id="team-reaction-sound" checked={!preference.muted} disabled={!preference.ready || !preference.enabled || busy} onCheckedChange={value => void change('sound', value)} />
      </div>
      {(error || preference.error) && <p role="alert" className="text-sm text-destructive">{error || preference.error}</p>}
    </CardContent>
  </Card>;
}
