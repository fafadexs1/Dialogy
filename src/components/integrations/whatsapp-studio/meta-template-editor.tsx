'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, PencilLine, Send, Sparkles } from 'lucide-react';
import { editWhatsappMetaTemplate } from '@/actions/whatsapp-studio';
import { metaTemplateEditFields } from '@/lib/whatsapp/meta-template-edit';
import type { StudioTemplate } from '@/lib/whatsapp/studio';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import shared from '@/app/team/team-page.module.css';
import styles from './studio.module.css';

export function MetaTemplateEditor({ template, workspaceId, instanceId, onClose, onUpdated }: { template: StudioTemplate; workspaceId: string; instanceId: string; onClose: () => void; onUpdated: () => void }) {
  const definition = useMemo(() => { try { return {fields:metaTemplateEditFields(template), error:''}; } catch(error) { return {fields:[],error:error instanceof Error ? error.message : 'Não foi possível abrir este template.'}; } }, [template]);
  const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries(definition.fields.map(field=>[field.key,field.value])));
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const changed=definition.fields.some(field=>values[field.key]!==field.value);
  async function submit() {
    if (!template.id || !changed) return;
    setError('');setBusy(true);
    try {
      const result=await editWhatsappMetaTemplate({workspaceId,instanceId,templateId:template.id,originalComponents:JSON.stringify(template.components),originalStatus:template.status,updates:values});
      if (!result.success) {setError(result.error);return;}
      onUpdated();onClose();
    } catch {setError('A edição não foi confirmada. Atualize a biblioteca antes de tentar novamente.');}
    finally {setBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className={cn(shared.surface,styles.metaEditDialog)}>
    <DialogHeader><span className={styles.metaEditEyebrow}><Sparkles size={14}/> Estúdio de edição</span><DialogTitle className={styles.metaEditTitle}>Dê uma nova vida<br/>à sua mensagem.</DialogTitle><DialogDescription>Edite o template <strong>{template.name}</strong> em {template.language.replace('_','-')}. O nome e o idioma de registro serão mantidos.</DialogDescription></DialogHeader>
    {definition.error ? <div className={styles.metaEditNotice}><AlertCircle size={18}/><span>{definition.error}</span></div> : <><div className={styles.metaEditLayout}><div className={styles.metaEditFields}>{definition.fields.map(field=><div key={field.key} className={styles.metaEditField}><div><Label htmlFor={`meta-${field.key}`}>{field.label}</Label><span>{(values[field.key]||'').length}/{field.max}</span></div>{field.max===1024?<Textarea id={`meta-${field.key}`} maxLength={field.max} value={values[field.key]||''} onChange={event=>{setValues({...values,[field.key]:event.target.value});setError('');}} />:<Input id={`meta-${field.key}`} maxLength={field.max} value={values[field.key]||''} onChange={event=>{setValues({...values,[field.key]:event.target.value});setError('');}} />}</div>)}</div>
      <div className={styles.metaEditPreview}><div className={styles.metaEditPreviewHeading}><PencilLine size={14}/> Prévia das alterações</div><div className={styles.metaEditBubble}>{definition.fields.filter(field=>!field.label.includes('Botão')).map(field=><div key={field.key}><small>{field.label}</small><p>{values[field.key]}</p></div>)}{definition.fields.filter(field=>field.label.includes('Botão') && field.key.endsWith('.text')).map(field=><div className={styles.metaEditPreviewButton} key={field.key}>{values[field.key]}</div>)}</div><span className={styles.metaEditPreviewFoot}><CheckCircle2 size={14}/> Fotos e componentes não editados são preservados.</span></div></div>
      <div className={styles.metaEditNotice}><AlertCircle size={18}/><span>As alterações são enviadas para a Meta e podem passar por nova análise. Mantenha as variáveis, como {'{{1}}'}, para preservar a personalização.</span></div></>}
    {error&&<p className={styles.editorError} role="alert"><AlertCircle size={16}/>{error}</p>}
    <div className={styles.metaEditFooter}><Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button onClick={submit} disabled={busy||!changed||!!definition.error}>{busy?<Loader2 size={15} className="animate-spin"/>:<Send size={15}/>} Enviar alterações à Meta</Button></div>
  </DialogContent></Dialog>;
}
