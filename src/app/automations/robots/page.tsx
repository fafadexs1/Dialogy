
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MainAppLayout } from '@/components/layout/main-app-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { getSystemAgents, createSystemAgent, deleteSystemAgent, updateSystemAgent } from '@/actions/system-agents';
import { type SystemAgent, type User } from '@/lib/types';
import { Loader2, PlusCircle, MoreVertical, Edit, Trash2, Copy, Rocket, KeyRound, Webhook, Save } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

function AgentForm({
  workspaceId,
  onSuccess,
  onClose,
  agent
}: {
  workspaceId: string;
  onSuccess: () => void;
  onClose: () => void;
  agent?: SystemAgent | null;
}) {
  const [name, setName] = useState(agent?.name || '');
  const [avatarUrl, setAvatarUrl] = useState(agent?.avatar_url || '');
  const [webhookUrl, setWebhookUrl] = useState(agent?.webhook_url || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) {
      toast({ title: "Nome é obrigatório", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);

    const data = { name, avatar_url: avatarUrl, webhook_url: webhookUrl };
    
    const result = agent 
      ? await updateSystemAgent(agent.id, data)
      : await createSystemAgent(workspaceId, data);
      
    if (result.success) {
      toast({ title: `Agente ${agent ? 'atualizado' : 'criado'}!`, description: "Seu agente do sistema está pronto." });
      onSuccess();
    } else {
      toast({ title: `Erro ao ${agent ? 'atualizar' : 'criar'}`, description: result.error, variant: 'destructive' });
    }
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{agent ? 'Editar Agente' : 'Criar Novo Agente do Sistema'}</DialogTitle>
        <DialogDescription>
          Agentes podem interagir com seu sistema através de webhooks e da API.
        </DialogDescription>
      </DialogHeader>
      <div className="py-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="agent-name">Nome do Agente</Label>
          <Input id="agent-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Robô de Qualificação" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-avatar">URL do Avatar</Label>
          <Input id="agent-avatar" value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} type="url" placeholder="https://exemplo.com/avatar.png" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-webhook">URL do Webhook</Label>
          <Input id="agent-webhook" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} type="url" placeholder="https://seu-sistema.com/api/dialogy-webhook" />
           <p className="text-xs text-muted-foreground">Deve ser uma URL completa, começando com http:// ou https://</p>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {agent ? <Save className="mr-2 h-4 w-4" /> : <PlusCircle className="mr-2 h-4 w-4" />}
          {agent ? 'Salvar Alterações' : 'Criar Agente'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CopyButton({ textToCopy }: { textToCopy: string }) {
    const { toast } = useToast();
    const handleCopy = () => {
        navigator.clipboard.writeText(textToCopy);
        toast({ title: 'Copiado!', description: 'O item foi copiado para a área de transferência.' });
    };
    return <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}><Copy className="h-4 w-4" /></Button>;
}

export default function RobotsPage() {
  const [user, setUser] = useState<User | null>(null);
  const { toast } = useToast();
  const [agents, setAgents] = useState<SystemAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<SystemAgent | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
        const res = await fetch('/api/user');
        if (res.ok) {
            setUser(await res.json());
        }
    };
    fetchUser();
  }, []);

  const fetchData = useCallback(async () => {
    if (!user?.activeWorkspaceId) return;
    setLoading(true);
    const result = await getSystemAgents(user.activeWorkspaceId);
    if (result.error) {
      toast({ title: "Erro ao carregar agentes", description: result.error, variant: 'destructive' });
      setAgents([]);
    } else {
      setAgents(result.agents || []);
    }
    setLoading(false);
  }, [user?.activeWorkspaceId, toast]);

  useEffect(() => {
    if (user) {
        fetchData();
    }
  }, [user, fetchData]);
  
  const handleSuccess = () => {
    setIsModalOpen(false);
    setEditingAgent(null);
    fetchData();
  }

  const handleEditAgent = (agent: SystemAgent) => {
    setEditingAgent(agent);
    setIsModalOpen(true);
  }

  const handleRemoveAgent = async (agentId: string) => {
    const result = await deleteSystemAgent(agentId);
    if(result.success) {
        toast({ title: "Agente removido!" });
        fetchData();
    } else {
        toast({ title: "Erro ao remover", description: result.error, variant: "destructive" });
    }
  }

  if (!user) {
    return <MainAppLayout user={user}><div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div></MainAppLayout>;
  }

  return (
    <MainAppLayout user={user}>
      <div className="flex flex-col flex-1 h-full">
        <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Rocket /> Agentes do Sistema</h1>
            <p className="text-muted-foreground">Crie e gerencie agentes virtuais para automatizar tarefas via webhooks.</p>
          </div>
          <Dialog open={isModalOpen} onOpenChange={(isOpen) => { setIsModalOpen(isOpen); if (!isOpen) setEditingAgent(null); }}>
            <DialogTrigger asChild>
                <Button onClick={() => setEditingAgent(null)}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Criar Agente
                </Button>
            </DialogTrigger>
            <DialogContent>
                 <AgentForm 
                    workspaceId={user.activeWorkspaceId!} 
                    onSuccess={handleSuccess} 
                    onClose={() => setIsModalOpen(false)}
                    agent={editingAgent}
                />
            </DialogContent>
          </Dialog>
        </header>
        <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
          {loading ? (
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
             </div>
          ) : agents.length === 0 ? (
            <div className="text-center p-10 border-dashed border-2 rounded-lg mt-8">
                <Rocket className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium">Nenhum agente criado ainda</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                    Clique em "Criar Agente" para configurar seu primeiro agente do sistema.
                </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {agents.map(agent => (
                <Card key={agent.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                         <Avatar className="h-12 w-12 border">
                            <AvatarImage src={agent.avatar_url} alt={agent.name} />
                            <AvatarFallback>{agent.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                            <CardTitle>{agent.name}</CardTitle>
                            <div className="flex items-center gap-2 mt-1">
                                <Switch checked={agent.is_active} id={`active-${agent.id}`} />
                                <Label htmlFor={`active-${agent.id}`} className="text-xs">{agent.is_active ? 'Ativo' : 'Inativo'}</Label>
                            </div>
                        </div>
                      </div>
                       <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreVertical className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleEditAgent(agent)}>
                                    <Edit className="mr-2 h-4 w-4" />
                                    Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleRemoveAgent(agent.id)} className="text-destructive">
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Remover
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-grow space-y-4">
                     <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><KeyRound className="h-3 w-3"/> Token de Acesso</Label>
                        <div className="flex items-center">
                            <Input readOnly value={agent.token} className="h-8 font-mono text-xs flex-1" type="password"/>
                            <CopyButton textToCopy={agent.token} />
                        </div>
                     </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><Webhook className="h-3 w-3"/> URL do Webhook</Label>
                        <div className="flex items-center">
                            <Input readOnly value={agent.webhook_url || 'N/A'} className="h-8 font-mono text-xs flex-1"/>
                            {agent.webhook_url && <CopyButton textToCopy={agent.webhook_url} />}
                        </div>
                     </div>
                  </CardContent>
                  <CardFooter className="text-xs text-muted-foreground">
                    Criado em {new Date(agent.created_at).toLocaleDateString()}
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </main>
      </div>
    </MainAppLayout>
  );
}
