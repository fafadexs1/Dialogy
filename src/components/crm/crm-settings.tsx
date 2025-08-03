'use client';

import React, { useState } from 'react';
import type { CustomFieldDefinition, SelectableOption, Tag } from '@/lib/types';
import { 
    mockCustomFieldDefinitions, 
    leadSources as mockLeadSources, 
    contactChannels as mockContactChannels, 
    jobTitles as mockJobTitles,
    mockTags 
} from '@/lib/mock-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Trash2, Palette } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HTMLInputTypeAttribute } from 'react';

// A generic manager for lists of selectable options (like lead sources, job titles, etc.)
function OptionsManager({ 
    title, 
    options, 
    setOptions 
}: { 
    title: string, 
    options: (SelectableOption | Tag)[], 
    setOptions: React.Dispatch<React.SetStateAction<(SelectableOption | Tag)[]>> 
}) {
    const [newItemLabel, setNewItemLabel] = useState('');
    const [newItemColor, setNewItemColor] = useState('#cccccc');

    const handleAddItem = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newItemLabel.trim()) return;
        
        const newItem = {
            id: newItemLabel.toLowerCase().replace(/\s+/g, '_') + Date.now(),
            value: newItemLabel.toLowerCase().replace(/\s+/g, '_'),
            label: newItemLabel,
            color: newItemColor,
        };
        
        setOptions([...options, newItem]);
        setNewItemLabel('');
        setNewItemColor('#cccccc');
    };

    const handleRemoveItem = (itemToRemove: SelectableOption | Tag) => {
        setOptions(options.filter(item => item.id !== itemToRemove.id));
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleAddItem} className="flex items-end gap-2 mb-4">
                    <div className='flex-1'>
                        <Label htmlFor={`new-option-${title}`} className='text-xs'>Nome da Opção</Label>
                        <Input
                            id={`new-option-${title}`} 
                            placeholder={`Nova opção para ${title}...`}
                            value={newItemLabel}
                            onChange={(e) => setNewItemLabel(e.target.value)}
                        />
                    </div>
                     <div>
                        <Label htmlFor={`new-color-${title}`} className='text-xs'>Cor</Label>
                        <div className="flex items-center gap-2 border rounded-md h-10 px-2 bg-background">
                            <Palette className="h-4 w-4 text-muted-foreground"/>
                            <input
                                id={`new-color-${title}`}
                                type="color"
                                value={newItemColor}
                                onChange={(e) => setNewItemColor(e.target.value)}
                                className="w-6 h-6 p-0 border-none bg-transparent"
                            />
                        </div>
                    </div>
                    <Button type="submit" size="sm">Adicionar</Button>
                </form>
                <div className="space-y-2">
                    {options.map(option => (
                        <div key={option.id} className="flex items-center justify-between p-2 border rounded-md bg-background text-sm">
                            <div className='flex items-center gap-2'>
                                <span className='h-4 w-4 rounded-full' style={{backgroundColor: option.color}}></span>
                                <span>{option.label}</span>
                            </div>
                             <Button variant="ghost" size="icon" onClick={() => handleRemoveItem(option)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                                <span className="sr-only">Remover</span>
                            </Button>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}


export function CrmSettings({ children }: { children: React.ReactNode }) {
  const [fields, setFields] = useState<CustomFieldDefinition[]>(mockCustomFieldDefinitions);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<HTMLInputTypeAttribute>('text');

  const [leadSources, setLeadSources] = useState<SelectableOption[]>(mockLeadSources);
  const [contactChannels, setContactChannels] = useState<SelectableOption[]>(mockContactChannels);
  const [jobTitles, setJobTitles] = useState<SelectableOption[]>(mockJobTitles);
  const [tags, setTags] = useState<Tag[]>(mockTags);


  const handleAddField = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldLabel.trim()) return;

    const newField: CustomFieldDefinition = {
      id: `custom_${newFieldLabel.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
      label: newFieldLabel,
      type: newFieldType,
      placeholder: `Insira ${newFieldLabel}...`,
    };

    setFields([...fields, newField]);
    setNewFieldLabel('');
    setNewFieldType('text');
  };

  const handleRemoveField = (id: string) => {
    setFields(fields.filter(field => field.id !== id));
  };


  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Configurações do CRM</DialogTitle>
          <DialogDescription>
            Gerencie os campos e opções que aparecerão nos formulários e perfis. Adapte o CRM às necessidades do seu negócio.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto p-1">
            <Tabs defaultValue="fields">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="fields">Campos Personalizados</TabsTrigger>
                    <TabsTrigger value="options">Etiquetas e Opções</TabsTrigger>
                </TabsList>
                <TabsContent value="fields">
                    <Card className='border-0 shadow-none'>
                    <CardHeader>
                        <CardTitle>Gerenciador de Campos</CardTitle>
                         <CardDescription>Crie campos únicos para capturar informações essenciais para o seu negócio.</CardDescription>
                    </CardHeader>
                    <CardContent>
                            <form onSubmit={handleAddField} className="flex items-end gap-4 mb-6 p-4 border rounded-lg bg-secondary/30">
                                <div className="flex-1 space-y-2">
                                    <Label htmlFor="field-label">Nome do Campo</Label>
                                    <Input 
                                        id="field-label"
                                        placeholder="Ex: Orçamento Anual"
                                        value={newFieldLabel}
                                        onChange={(e) => setNewFieldLabel(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="field-type">Tipo do Campo</Label>
                                    <Select value={newFieldType} onValueChange={(val) => setNewFieldType(val as HTMLInputTypeAttribute)}>
                                        <SelectTrigger id="field-type" className="w-[180px]">
                                            <SelectValue placeholder="Selecione o tipo" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="text">Texto</SelectItem>
                                            <SelectItem value="number">Número</SelectItem>
                                            <SelectItem value="date">Data</SelectItem>
                                            <SelectItem value="email">Email</SelectItem>
                                            <SelectItem value="tel">Telefone</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Button type="submit">
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    Adicionar Campo
                                </Button>
                            </form>

                            <div className="space-y-4">
                                <h3 className="font-semibold text-lg text-muted-foreground">Campos Atuais</h3>
                                {fields.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {fields.map(field => (
                                        <div key={field.id} className="flex items-center justify-between p-3 border rounded-md bg-background">
                                            <div>
                                                <p className="font-medium">{field.label}</p>
                                                <p className="text-xs text-muted-foreground capitalize bg-secondary px-2 py-0.5 rounded-full inline-block mt-1">{field.type}</p>
                                            </div>
                                            <Button variant="ghost" size="icon" onClick={() => handleRemoveField(field.id)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                                <span className="sr-only">Remover</span>
                                            </Button>
                                        </div>
                                    ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground p-4 text-center border-dashed border rounded-md">
                                        Nenhum campo personalizado criado. Adicione um acima para começar.
                                    </p>
                                )}
                            </div>
                    </CardContent>
                    </Card>
                </TabsContent>
                 <TabsContent value="options">
                     <Card className='border-0 shadow-none'>
                        <CardHeader>
                            <CardTitle>Gerenciador de Etiquetas e Opções</CardTitle>
                            <CardDescription>Personalize as etiquetas e as opções disponíveis nos campos de seleção do CRM.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <OptionsManager title="Etiquetas (Tags)" options={tags} setOptions={setTags as any} />
                            <OptionsManager title="Cargos" options={jobTitles} setOptions={setJobTitles as any} />
                            <OptionsManager title="Origem do Lead" options={leadSources} setOptions={setLeadSources as any} />
                            <OptionsManager title="Canais de Contato" options={contactChannels} setOptions={setContactChannels as any} />
                        </CardContent>
                     </Card>
                </TabsContent>
            </Tabs>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline">Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
