'use client';
import {useEffect,useState} from 'react';
import {ArrowRightLeft,Loader2,Save} from 'lucide-react';
import {getLogoutTransferSettings,saveLogoutTransferSettings} from '@/actions/logout-transfer';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Switch} from '@/components/ui/switch';
import {Label} from '@/components/ui/label';
import {toast} from '@/hooks/use-toast';
export function LogoutTransferSettings({workspaceId}:{workspaceId:string;userId:string}){
 const [loading,setLoading]=useState(true),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[enabled,setEnabled]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;setLoading(true);setLoaded(false);setError('');getLogoutTransferSettings().then(v=>{if(active){setEnabled(v.enabled);setLoaded(true);}}).catch(()=>{if(active)setError('Não foi possível carregar a configuração.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[workspaceId]);
 async function save(){setBusy(true);setError('');try{await saveLogoutTransferSettings({enabled});toast({title:'Transferência ao sair atualizada.'});}catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);}}
 return <Card><CardHeader><CardTitle className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5"/>Transferir meus atendimentos ao sair</CardTitle><CardDescription>Uma preferência pessoal para este workspace, aplicada quando você sair da conta.</CardDescription></CardHeader><CardContent className="space-y-4">{loading?<p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Carregando...</p>:!loaded?<p role="alert" className="text-sm text-destructive">{error}</p>:<><div className="flex items-center justify-between gap-4 rounded-xl border p-4"><div><Label htmlFor="logout-transfer-enabled">Transferência automática</Label><p className="mt-1 text-xs text-muted-foreground">Ao sair da conta, seus atendimentos vão para outra pessoa disponível da sua equipe. Se não houver, voltam para a fila geral.</p></div><Switch id="logout-transfer-enabled" checked={enabled} onCheckedChange={setEnabled}/></div><p className="text-xs leading-relaxed text-muted-foreground">Somente suas conversas em atendimento neste workspace serão movimentadas. Quedas de conexão e fechamento de abas não acionam esta opção.</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={busy} onClick={save}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Save className="h-4 w-4"/>}Salvar preferência</Button></>}</CardContent></Card>;
}
