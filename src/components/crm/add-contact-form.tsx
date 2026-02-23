
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
      className="rounded-xl bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all font-medium h-10 px-6 border border-white/10 dark:border-white/5"
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
          className="w-full justify-between h-auto min-h-[44px] bg-background/50 border-border/40 hover:bg-background/80 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm px-4"
        >
          <div className="flex flex-wrap gap-1.5 py-1.5">
            {selectedTags.length > 0 ? selectedTags.map(tag => (
              <Badge key={tag.id} style={{ backgroundColor: tag.color, color: tag.color.startsWith('#FEE') || tag.color === '#FFFFFF' || tag.color.toLowerCase() === '#fff' ? '#000' : '#fff' }} className="border-transparent rounded-lg px-2.5 py-0.5 text-[11px] font-medium shadow-sm transition-transform hover:scale-105" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); toggleTag(tag); }}>
                {tag.label}
                <X className="ml-1.5 h-3 w-3 hover:bg-black/20 rounded-full transition-colors" />
              </Badge>
            )) : <span className="text-muted-foreground/70 font-normal">Selecione as etiquetas...</span>}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-xl border-border/40 shadow-xl overflow-hidden">
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
    <div className="group space-y-3 p-1">
      <Label htmlFor={fieldName} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">{field.label}</Label>

      {/* The hidden input stores the entire array serialized as JSON */}
      <input type="hidden" name={fieldName} value={JSON.stringify(files)} />

      {files.length > 0 && (
        <div className="space-y-3">
          {files.map((file, index) => (
            <div key={index} className="flex flex-col gap-2 p-3 rounded-xl bg-background/50 border border-border/40 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <a href={file.url} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-blue-500 hover:underline truncate max-w-[80%]" title={file.name}>
                  {file.name}
                </a>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 shrink-0" onClick={() => handleRemoveFile(index)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Input
                placeholder="Nota / Descrição (Opcional)"
                value={file.note}
                onChange={(e) => handleNoteChange(index, e.target.value)}
                className="h-9 text-[12px] bg-background border-border/40 placeholder:text-muted-foreground/50"
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
          className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-[11px] file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 text-[12px]"
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
      toast({ title: "Contato salvo!", description: "As informações do contato foram salvas com sucesso." });
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
          <div key={field.id} className="group space-y-2">
            <Label htmlFor={fieldName} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">{field.label}</Label>
            <Select name={fieldName} defaultValue={defaultValue}>
              <SelectTrigger id={fieldName} className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm px-4">
                <SelectValue placeholder={field.placeholder || 'Selecione...'} />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border/40 shadow-xl">
                {field.options?.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      case 'file':
        return (
          <FileUploadField key={field.id} field={field} fieldName={fieldName} defaultValue={defaultValue} />
        );
      default:
        return (
          <div key={field.id} className="group space-y-2">
            <Label htmlFor={fieldName} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">{field.label}</Label>
            <Input id={fieldName} name={fieldName} type={field.type} placeholder={field.placeholder} defaultValue={defaultValue} className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm px-4" />
          </div>
        )
    }
  }


  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[800px] p-0 gap-0 overflow-hidden bg-background/80 backdrop-blur-2xl border-border/40 shadow-2xl rounded-3xl">
        {/* Glow effects */}
        <div className="pointer-events-none absolute -top-40 -right-40 h-[400px] w-[400px] rounded-full bg-primary/20 blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-blue-500/10 blur-[100px]" />

        <DialogHeader className="relative z-10 p-8 pb-4">
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            {contact ? 'Editar Contato' : 'Criar Novo Contato'}
          </DialogTitle>
          <DialogDescription className="text-sm font-medium text-muted-foreground mt-1.5">
            Preencha os detalhes abaixo para adicionar ou atualizar um contato no seu CRM.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="relative z-10 flex flex-col">
          <input type="hidden" name="id" value={contact?.id || ''} />
          <input type="hidden" name="workspaceId" value={workspaceId} />

          <Tabs defaultValue="personal" className="w-full flex flex-col relative z-10">
            <div className="px-8 mb-2">
              <TabsList className="grid w-full grid-cols-3 bg-muted/30 p-1 rounded-xl h-11 border border-border/20">
                <TabsTrigger value="personal" className="rounded-lg text-[11px] font-semibold uppercase tracking-wider data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all">Pessoal</TabsTrigger>
                <TabsTrigger value="location" className="rounded-lg text-[11px] font-semibold uppercase tracking-wider data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all">Local / Mídia</TabsTrigger>
                <TabsTrigger value="management" className="rounded-lg text-[11px] font-semibold uppercase tracking-wider data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all">Gestão</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[55vh] px-8 py-2">
              <TabsContent forceMount value="personal" className="mt-0 space-y-6 focus-visible:outline-none focus-visible:ring-0 data-[state=inactive]:hidden">
                {/* Seção Pessoal */}
                <div className="rounded-2xl border border-border/30 bg-card/30 backdrop-blur-md p-6 space-y-6 shadow-sm transition-all hover:bg-card/50">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <UserIcon className="h-4 w-4" />
                    </div>
                    <h3 className="font-semibold text-[15px] tracking-tight">Informações Pessoais</h3>
                  </div>

                  <div className="space-y-5">
                    <div className="group space-y-2">
                      <Label htmlFor="name" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">Nome Completo <span className="text-primary">*</span></Label>
                      <Input id="name" name="name" placeholder="Ex: João da Silva" required defaultValue={contact?.name || ''} className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm px-4" />
                    </div>

                    <div className="group space-y-2">
                      <Label htmlFor="phone_number_jid" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">WhatsApp</Label>
                      <input
                        type="hidden"
                        name="phone_number_jid"
                        value={phoneJidLocalPart ? `${phoneJidLocalPart}${WHATSAPP_JID_SUFFIX}` : ''}
                      />
                      <div className="flex items-center rounded-xl border border-border/40 bg-background/50 overflow-hidden focus-within:ring-1 focus-within:ring-ring focus-within:bg-background transition-all shadow-sm hover:border-border/80">
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
                          className="h-11 border-0 shadow-none bg-transparent focus-visible:ring-0 px-0 placeholder:text-muted-foreground/50"
                        />
                        <div className="bg-foreground/[0.02] px-4 h-11 flex items-center justify-center text-[11px] text-muted-foreground border-l border-border/40 font-medium tracking-wider">
                          @s.whatsapp.net
                        </div>
                      </div>
                    </div>

                    <div className="group space-y-2">
                      <Label htmlFor="email" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">E-mail</Label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
                        <Input id="email" name="email" type="email" placeholder="joao@exemplo.com" defaultValue={contact?.email || ''} className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm pl-11" />
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent forceMount value="location" className="mt-0 space-y-6 focus-visible:outline-none focus-visible:ring-0 data-[state=inactive]:hidden">
                {/* Seção Endereço/Outros */}
                <div className="rounded-2xl border border-border/30 bg-card/30 backdrop-blur-md p-6 space-y-6 shadow-sm transition-all hover:bg-card/50">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <h3 className="font-semibold text-[15px] tracking-tight">Localização e Mídia</h3>
                  </div>

                  <div className="space-y-5">
                    <div className="group space-y-2">
                      <Label htmlFor="address" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">Endereço Completo</Label>
                      <div className="relative">
                        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
                        <Input id="address" name="address" placeholder="Rua, Número, Bairro, Cidade" defaultValue={contact?.address || ''} className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm pl-11" />
                      </div>
                    </div>

                    <div className="group space-y-2">
                      <Label htmlFor="avatar_url" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">URL do Avatar</Label>
                      <div className="relative">
                        <Link className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
                        <Input id="avatar_url" name="avatar_url" type="url" placeholder="https://exemplo.com/avatar.png" defaultValue={contact?.avatar_url || ''} className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm pl-11" />
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent forceMount value="management" className="mt-0 space-y-6 focus-visible:outline-none focus-visible:ring-0 data-[state=inactive]:hidden">
                <div className="rounded-2xl border border-border/30 bg-card/30 backdrop-blur-md p-6 space-y-6 shadow-sm transition-all hover:bg-card/50">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <h3 className="font-semibold text-[15px] tracking-tight">Atribuição e Organização</h3>
                  </div>

                  <div className="space-y-5">
                    <div className="group space-y-2">
                      <Label htmlFor="owner_id" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest group-focus-within:text-primary transition-colors">Vendedor Responsável</Label>
                      <Select name="owner_id" defaultValue={contact?.owner_id || 'unassigned'}>
                        <SelectTrigger id="owner_id" className="h-11 bg-background/50 border-border/40 hover:border-border/80 focus:bg-background transition-all rounded-xl shadow-sm px-4">
                          <SelectValue placeholder="Selecione um proprietário" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-border/40 shadow-xl">
                          <SelectItem value="unassigned">Nenhum</SelectItem>
                          {agents.map(owner => (<SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="group space-y-2">
                      <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 group-focus-within:text-primary transition-colors">Etiquetas (Tags)</Label>
                      <MultiSelectTags availableTags={availableTags} initialSelectedTags={contact?.tags} />
                    </div>
                  </div>
                </div>

                {/* Informações Adicionais */}
                {customFields.length > 0 && (
                  <div className="rounded-2xl border border-border/30 bg-card/30 backdrop-blur-md p-6 space-y-6 shadow-sm transition-all hover:bg-card/50">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <LayoutList className="h-4 w-4" />
                      </div>
                      <h3 className="font-semibold text-[15px] tracking-tight">Informações Adicionais</h3>
                    </div>
                    <div className="space-y-5">
                      {customFields.map(renderCustomField)}
                    </div>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>

          <div className="px-8 pb-4">
            {state.error && (
              <Alert variant="destructive" className="mt-2 rounded-xl border-destructive/30 bg-destructive/5 text-destructive backdrop-blur-sm">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Erro ao Salvar</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="relative z-10 p-8 pt-5 border-t border-border/20 bg-background/30 backdrop-blur-md rounded-b-3xl">
            <Button type="button" variant="ghost" className="rounded-xl hover:bg-foreground/5 transition-colors font-medium h-10 px-6" onClick={() => setIsOpen(false)}>Cancelar</Button>
            <SaveButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
