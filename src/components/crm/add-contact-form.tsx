
'use client';

import React, { useState, useEffect, useActionState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { Contact, User, Tag, CustomFieldDefinition } from '@/lib/types';
import { useFormStatus } from 'react-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Save, Check, ChevronsUpDown, X, User as UserIcon, Phone, Mail, MapPin, Link, Briefcase, Tag as TagIcon, LayoutList, AlertCircle, Trash2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { saveContactAction } from '@/actions/crm';
import { toast } from '@/hooks/use-toast';
import { getTags, getCustomFieldDefinitions } from '@/actions/crm';
import { Badge } from '../ui/badge';
import { uploadToS3Action } from '@/actions/upload-s3';

const WHATSAPP_JID_SUFFIX = '@s.whatsapp.net';
const LIGHT_DIALOG_SCOPE_CLASS = 'app-shell-light text-foreground';
const FORM_GROUP_CLASS = 'group space-y-2';
const FORM_LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80 transition-colors group-focus-within:text-primary';
const FORM_INPUT_CLASS = 'h-12 rounded-2xl border border-slate-200 bg-white px-4 text-[14px] shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] transition-all placeholder:text-muted-foreground/60 hover:border-primary/40 focus-visible:border-primary/70 focus-visible:bg-white focus-visible:ring-0';
const FORM_SELECT_TRIGGER_CLASS = 'h-12 rounded-2xl border border-slate-200 bg-white px-4 text-[14px] shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] transition-all hover:border-primary/40 focus:bg-white';
const SECTION_CARD_CLASS = 'rounded-[24px] border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-primary/[0.06] p-5 md:p-6 shadow-[0_28px_80px_-55px_rgba(15,23,42,0.22)] backdrop-blur-xl';

function extractWhatsappJidLocalPart(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const beforeAt = trimmed.replace(/@s\.whatsapp\.net$/i, '').split('@')[0];
  return beforeAt.replace(/\D/g, '');
}

interface AddContactFormProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onSave: (updatedContact?: Contact | null) => void;
  contact: Contact | null;
  workspaceId: string;
  agents: User[];
  user: User | null;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-11 rounded-2xl border border-white/20 bg-gradient-to-r from-emerald-300 via-primary to-cyan-300 px-7 font-semibold text-black shadow-[0_18px_40px_-18px_rgba(16,185,129,0.9)] transition-all hover:brightness-110 hover:shadow-[0_22px_42px_-16px_rgba(16,185,129,0.95)]"
    >
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      <Save className="mr-2 h-4 w-4" />
      Salvar Contato
    </Button>
  )
}

function MultiSelectTags({ availableTags, initialSelectedTags }: { availableTags: Tag[], initialSelectedTags?: Tag[] }) {
  const [open, setOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Tag[]>(initialSelectedTags || []);

  const toggleTag = (tag: Tag) => {
    setSelectedTags(prev =>
      prev.some(t => t.id === tag.id)
        ? prev.filter(t => t.id !== tag.id)
        : [...prev, tag]
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Hidden inputs to pass tag IDs to form action */}
      {selectedTags.map(tag => (
        <input key={tag.id} type="hidden" name="tags" value={tag.id} />
      ))}

      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="min-h-[48px] h-auto w-full justify-between rounded-2xl border border-slate-200 bg-white px-4 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] transition-all hover:border-primary/40 hover:bg-slate-50"
        >
          <div className="flex flex-wrap gap-1.5 py-1.5">
            {selectedTags.length > 0 ? selectedTags.map(tag => (
              <Badge key={tag.id} style={{ backgroundColor: tag.color, color: tag.color.startsWith('#FEE') || tag.color === '#FFFFFF' || tag.color.toLowerCase() === '#fff' ? '#000' : '#fff' }} className="rounded-xl border-transparent px-2.5 py-0.5 text-[11px] font-medium shadow-sm transition-transform hover:scale-105" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); toggleTag(tag); }}>
                {tag.label}
                <X className="ml-1.5 h-3 w-3 rounded-full transition-colors hover:bg-slate-200" />
              </Badge>
            )) : <span className="text-muted-foreground/70 font-normal">Selecione as etiquetas...</span>}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={`${LIGHT_DIALOG_SCOPE_CLASS} w-[--radix-popover-trigger-width] overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl`}>
        <Command>
          <CommandInput placeholder="Buscar etiqueta..." />
          <CommandList>
            <CommandEmpty>Nenhuma etiqueta encontrada.</CommandEmpty>
            <CommandGroup>
              {availableTags.map((tag) => (
                <CommandItem
                  key={tag.id}
                  value={tag.label}
                  onSelect={() => toggleTag(tag)}
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${selectedTags.some(t => t.id === tag.id) ? "opacity-100" : "opacity-0"}`}
                  />
                  {tag.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

type AttachedFile = { url: string; name: string; note: string };

function FileUploadField({ field, fieldName, defaultValue }: { field: CustomFieldDefinition, fieldName: string, defaultValue?: string }) {
  const [files, setFiles] = useState<AttachedFile[]>(() => {
    if (!defaultValue) return [];
    try {
      const parsed = JSON.parse(defaultValue);
      if (Array.isArray(parsed)) return parsed;
      // Handle legacy single url string
      return [{ url: defaultValue, name: defaultValue.split('/').pop() || 'Arquivo', note: '' }];
    } catch (e) {
      // Fallback for raw legacy url
      return [{ url: defaultValue, name: defaultValue.split('/').pop() || 'Arquivo', note: '' }];
    }
  });
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pathPrefix', 'crm-custom-fields');

    try {
      const result = await uploadToS3Action(formData);
      if (result.success && result.url) {
        setFiles(prev => [...prev, { url: result.url, name: result.fileName || file.name, note: '' }]);
        toast({ title: "Arquivo anexado com sucesso" });
        // Reset the input value so the same file can be selected again if needed
        e.target.value = '';
      } else {
        toast({ title: 'Erro ao fazer upload', description: result.error, variant: 'destructive' });
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Erro ao fazer upload', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveFile = (indexToRemove: number) => {
    setFiles(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleNoteChange = (index: number, newNote: string) => {
    setFiles(prev => {
      const updated = [...prev];
      updated[index].note = newNote;
      return updated;
    });
  };

  return (
    <div className="group space-y-3">
      <Label htmlFor={fieldName} className={FORM_LABEL_CLASS}>{field.label}</Label>

      {/* The hidden input stores the entire array serialized as JSON */}
      <input type="hidden" name={fieldName} value={JSON.stringify(files)} />

      {files.length > 0 && (
        <div className="space-y-3">
          {files.map((file, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)]">
              <div className="flex items-center justify-between gap-2">
                <a href={file.url} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-blue-500 hover:underline truncate max-w-[80%]" title={file.name}>
                  {file.name}
                </a>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-xl text-destructive hover:bg-destructive/10" onClick={() => handleRemoveFile(index)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Input
                placeholder="Nota / Descricao (Opcional)"
                value={file.note}
                onChange={(e) => handleNoteChange(index, e.target.value)}
                className="h-10 rounded-xl border-slate-200 bg-white text-[12px] placeholder:text-muted-foreground/50"
              />
            </div>
          ))}
        </div>
      )}

      <div className="relative mt-2">
        <Input
          type="file"
          onChange={handleFileChange}
          disabled={uploading}
          className="h-12 rounded-2xl border border-slate-200 bg-white text-[12px] shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] transition-all file:mr-4 file:rounded-xl file:border-0 file:bg-primary/15 file:px-4 file:py-2 file:text-[11px] file:font-semibold file:text-primary hover:border-primary/40 hover:file:bg-primary/25"
        />
        {uploading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}

export function AddContactForm({ isOpen, setIsOpen, onSave, contact, workspaceId, agents, user }: AddContactFormProps) {
  const [state, formAction] = useActionState(saveContactAction, { success: false, error: null });
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [phoneJidLocalPart, setPhoneJidLocalPart] = useState('');

  const fetchDropdownData = useCallback(async () => {
    if (isOpen && user?.activeWorkspaceId) {
      getTags(user.activeWorkspaceId).then(res => {
        if (!res.error) setAvailableTags(res.tags || []);
      });
      getCustomFieldDefinitions(user.activeWorkspaceId).then(res => {
        if (!res.error) setCustomFields(res.fields || []);
      });
    }
  }, [isOpen, user?.activeWorkspaceId]);

  useEffect(() => {
    fetchDropdownData();
  }, [fetchDropdownData]);

  useEffect(() => {
    if (!isOpen) return;
    setPhoneJidLocalPart(extractWhatsappJidLocalPart(contact?.phone_number_jid));
  }, [isOpen, contact?.id, contact?.phone_number_jid]);


  useEffect(() => {
    if (state.success) {
      toast({ title: "Contato salvo!", description: "As informacoes do contato foram salvas com sucesso." });
      onSave(state.contact);
      setIsOpen(false);
    }
  }, [state, onSave, setIsOpen]);

  const renderCustomField = (field: CustomFieldDefinition) => {
    const fieldName = `custom_field_${field.id}`;
    const defaultValue = contact?.custom_fields?.[field.id];

    switch (field.type) {
      case 'select':
        return (
          <div className={FORM_GROUP_CLASS}>
            <Label htmlFor={fieldName} className={FORM_LABEL_CLASS}>{field.label}</Label>
            <Select name={fieldName} defaultValue={defaultValue}>
              <SelectTrigger id={fieldName} className={FORM_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder={field.placeholder || 'Selecione...'} />
              </SelectTrigger>
              <SelectContent className={`${LIGHT_DIALOG_SCOPE_CLASS} rounded-2xl border border-slate-200 bg-white shadow-2xl`}>
                {field.options?.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      case 'file':
        return (
          <FileUploadField field={field} fieldName={fieldName} defaultValue={defaultValue} />
        );
      default:
        return (
          <div className={FORM_GROUP_CLASS}>
            <Label htmlFor={fieldName} className={FORM_LABEL_CLASS}>{field.label}</Label>
            <Input id={fieldName} name={fieldName} type={field.type} placeholder={field.placeholder} defaultValue={defaultValue} className={FORM_INPUT_CLASS} />
          </div>
        )
    }
  }


  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className={`${LIGHT_DIALOG_SCOPE_CLASS} sm:max-w-[980px] gap-0 overflow-hidden rounded-[30px] border border-slate-200 bg-white p-0 shadow-[0_42px_120px_-70px_rgba(15,23,42,0.18)]`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(14,165,233,0.12),transparent_36%),radial-gradient(circle_at_92%_12%,rgba(16,185,129,0.16),transparent_34%),radial-gradient(circle_at_30%_100%,rgba(59,130,246,0.10),transparent_42%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-emerald-400/10 to-transparent" />

        <DialogHeader className="relative z-10 border-b border-slate-200 px-6 py-5 md:px-8 md:py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                Cadastro CRM
              </span>
              <DialogTitle className="text-2xl font-semibold tracking-tight md:text-[2rem]">
                {contact ? 'Editar Contato' : 'Criar Novo Contato'}
              </DialogTitle>
              <DialogDescription className="max-w-2xl text-sm font-medium text-muted-foreground/85">
                Atualize os dados com rapidez. O layout foi otimizado para preenchimento direto por blocos.
              </DialogDescription>
            </div>
            <div className="hidden max-w-[200px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right md:block">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/90">Modo rapido</p>
              <p className="mt-1 text-xs text-muted-foreground/80">Preencha por aba e salve sem trocar de tela.</p>
            </div>
          </div>
        </DialogHeader>

        <form action={formAction} className="relative z-10 flex flex-col">
          <input type="hidden" name="id" value={contact?.id || ''} />
          <input type="hidden" name="workspaceId" value={workspaceId} />

          <Tabs defaultValue="personal" className="relative z-10 px-6 py-5 md:px-8 md:py-6">
            <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="space-y-4">
                <TabsList className="grid h-auto grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 md:grid-cols-1">
                  <TabsTrigger value="personal" className="h-11 gap-2 rounded-xl border border-transparent text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/15 data-[state=active]:text-primary md:justify-start md:px-3">
                    <UserIcon className="h-4 w-4" />
                    <span>Pessoal</span>
                  </TabsTrigger>
                  <TabsTrigger value="location" className="h-11 gap-2 rounded-xl border border-transparent text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/15 data-[state=active]:text-primary md:justify-start md:px-3">
                    <MapPin className="h-4 w-4" />
                    <span>Local / Midia</span>
                  </TabsTrigger>
                  <TabsTrigger value="management" className="h-11 gap-2 rounded-xl border border-transparent text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/15 data-[state=active]:text-primary md:justify-start md:px-3">
                    <Briefcase className="h-4 w-4" />
                    <span>Gestao</span>
                  </TabsTrigger>
                </TabsList>

                <div className="hidden rounded-2xl border border-slate-200 bg-slate-50 p-4 md:block">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/90">Fluxo sugerido</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground/85">
                    1. Preencha dados pessoais.
                    <br />
                    2. Ajuste local e midia.
                    <br />
                    3. Defina dono e etiquetas.
                  </p>
                </div>
              </aside>

              <div className="min-w-0">
                <div className="max-h-[56vh] space-y-6 overflow-y-auto pr-1">
                  <TabsContent forceMount value="personal" className="mt-0 space-y-6 focus-visible:outline-none focus-visible:ring-0 data-[state=inactive]:hidden">
                    <div className={SECTION_CARD_CLASS}>
                      <div className="mb-4 flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/25 bg-primary/12 text-primary">
                          <UserIcon className="h-4 w-4" />
                        </div>
                        <h3 className="text-[16px] font-semibold tracking-tight">Informacoes Pessoais</h3>
                      </div>

                      <div className="space-y-5">
                        <div className={FORM_GROUP_CLASS}>
                          <Label htmlFor="name" className={FORM_LABEL_CLASS}>
                            Nome Completo <span className="text-primary">*</span>
                          </Label>
                          <Input id="name" name="name" placeholder="Ex: Joao da Silva" required defaultValue={contact?.name || ''} className={FORM_INPUT_CLASS} />
                        </div>

                        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                          <div className={FORM_GROUP_CLASS}>
                            <Label htmlFor="phone_number_jid" className={FORM_LABEL_CLASS}>WhatsApp</Label>
                            <input
                              type="hidden"
                              name="phone_number_jid"
                              value={phoneJidLocalPart ? `${phoneJidLocalPart}${WHATSAPP_JID_SUFFIX}` : ''}
                            />
                            <div className="flex items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] transition-all hover:border-primary/40 focus-within:border-primary/70">
                              <div className="pl-4 pr-3 text-muted-foreground/70">
                                <Phone className="h-4 w-4" />
                              </div>
                              <Input
                                id="phone_number_jid"
                                name="phone_number_jid_local"
                                type="text"
                                inputMode="numeric"
                                placeholder="5511987654321"
                                value={phoneJidLocalPart}
                                onChange={(e) => setPhoneJidLocalPart(e.target.value.replace(/\D/g, ''))}
                                className="h-12 border-0 bg-transparent px-0 shadow-none placeholder:text-muted-foreground/55 focus-visible:ring-0"
                              />
                              <div className="flex h-12 items-center justify-center border-l border-slate-200 bg-slate-50 px-4 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                                @s.whatsapp.net
                              </div>
                            </div>
                          </div>

                          <div className={FORM_GROUP_CLASS}>
                            <Label htmlFor="email" className={FORM_LABEL_CLASS}>E-mail</Label>
                            <div className="relative">
                              <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                              <Input id="email" name="email" type="email" placeholder="joao@exemplo.com" defaultValue={contact?.email || ''} className={`${FORM_INPUT_CLASS} pl-11`} />
                            </div>
                          </div>
                        </div>

                        {customFields.length > 0 && (
                          <div className="space-y-4 border-t border-slate-200 pt-5">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/25 bg-primary/12 text-primary">
                                <LayoutList className="h-4 w-4" />
                              </div>
                              <h3 className="text-[16px] font-semibold tracking-tight">Informacoes Adicionais</h3>
                            </div>
                            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                              {customFields.map((field) => (
                                <div key={field.id} className={field.type === 'file' ? 'md:col-span-2' : ''}>
                                  {renderCustomField(field)}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent forceMount value="location" className="mt-0 space-y-6 focus-visible:outline-none focus-visible:ring-0 data-[state=inactive]:hidden">
                    <div className={SECTION_CARD_CLASS}>
                      <div className="mb-4 flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/25 bg-primary/12 text-primary">
                          <MapPin className="h-4 w-4" />
                        </div>
                        <h3 className="text-[16px] font-semibold tracking-tight">Localizacao e Midia</h3>
                      </div>

                      <div className="space-y-5">
                        <div className={FORM_GROUP_CLASS}>
                          <Label htmlFor="address" className={FORM_LABEL_CLASS}>Endereco Completo</Label>
                          <div className="relative">
                            <MapPin className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                            <Input id="address" name="address" placeholder="Rua, Numero, Bairro, Cidade" defaultValue={contact?.address || ''} className={`${FORM_INPUT_CLASS} pl-11`} />
                          </div>
                        </div>

                        <div className={FORM_GROUP_CLASS}>
                          <Label htmlFor="avatar_url" className={FORM_LABEL_CLASS}>URL do Avatar</Label>
                          <div className="relative">
                            <Link className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                            <Input id="avatar_url" name="avatar_url" type="url" placeholder="https://exemplo.com/avatar.png" defaultValue={contact?.avatar_url || ''} className={`${FORM_INPUT_CLASS} pl-11`} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent forceMount value="management" className="mt-0 space-y-6 focus-visible:outline-none focus-visible:ring-0 data-[state=inactive]:hidden">
                    <div className={SECTION_CARD_CLASS}>
                      <div className="mb-4 flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/25 bg-primary/12 text-primary">
                          <Briefcase className="h-4 w-4" />
                        </div>
                        <h3 className="text-[16px] font-semibold tracking-tight">Atribuicao e Organizacao</h3>
                      </div>

                      <div className="space-y-5">
                        <div className={FORM_GROUP_CLASS}>
                          <Label htmlFor="owner_id" className={FORM_LABEL_CLASS}>Vendedor Responsavel</Label>
                          <Select name="owner_id" defaultValue={contact?.owner_id || 'unassigned'}>
                            <SelectTrigger id="owner_id" className={FORM_SELECT_TRIGGER_CLASS}>
                              <SelectValue placeholder="Selecione um proprietario" />
                            </SelectTrigger>
                            <SelectContent className={`${LIGHT_DIALOG_SCOPE_CLASS} rounded-2xl border border-slate-200 bg-white shadow-2xl`}>
                              <SelectItem value="unassigned">Nenhum</SelectItem>
                              {agents.map(owner => (<SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className={FORM_GROUP_CLASS}>
                          <Label className={`${FORM_LABEL_CLASS} flex items-center gap-2`}>
                            <TagIcon className="h-3.5 w-3.5 text-primary/80" />
                            Etiquetas
                          </Label>
                          <MultiSelectTags availableTags={availableTags} initialSelectedTags={contact?.tags} />
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </div>
              </div>
            </div>
          </Tabs>

          <div className="px-6 pb-4 md:px-8">
            {state.error && (
              <Alert variant="destructive" className="mt-2 rounded-2xl border-destructive/30 bg-destructive/10 text-destructive backdrop-blur-md">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Erro ao Salvar</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="relative z-10 rounded-b-[30px] border-t border-slate-200 bg-slate-50 px-6 py-5 backdrop-blur-xl md:px-8">
            <Button type="button" variant="ghost" className="h-11 rounded-2xl px-6 font-medium transition-colors hover:bg-foreground/5" onClick={() => setIsOpen(false)}>
              Cancelar
            </Button>
            <SaveButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

