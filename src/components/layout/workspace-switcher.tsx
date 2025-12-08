
'use client';

import * as React from 'react';
import { CheckIcon, PlusCircledIcon } from '@radix-ui/react-icons';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { User } from '@/lib/types';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import { switchWorkspaceAction } from '@/actions/workspace';
import Link from 'next/link';
import { Separator } from '../ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { useActionState, useEffect } from 'react';
import { joinWorkspaceAction } from '@/actions/invites';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle, Loader2, LogIn, Crown, Shield, Building2, ChevronRight, Check } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';

type PopoverTriggerProps = React.ComponentPropsWithoutRef<
  typeof PopoverTrigger
>;

interface WorkspaceSwitcherProps extends PopoverTriggerProps {
  user: User;
}

function JoinWorkspaceDialog() {
  const [state, formAction] = useActionState(joinWorkspaceAction, { success: false, error: null });
  const { pending } = useFormStatus();

  return (
    <DialogContent className="sm:max-w-[400px] bg-[#0f1117] border-white/10 text-white">
      <form action={formAction}>
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">Entrar em um Workspace</DialogTitle>
          <DialogDescription className="text-white/60">
            Insira o código de convite que você recebeu para se juntar a uma equipe existente.
          </DialogDescription>
        </DialogHeader>
        <div className="py-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-code-dialog" className="text-white/80">Código de Convite</Label>
            <Input
              id="invite-code-dialog"
              name="inviteCode"
              placeholder="Ex: ABC-123"
              required
              autoFocus
              disabled={pending}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-blue-500/50"
            />
          </div>
          {state.error && (
            <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-red-200">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Erro</AlertTitle>
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium" disabled={pending}>
            {pending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando...</>
            ) : (
              <><LogIn className="mr-2 h-4 w-4" /> Entrar no Workspace</>
            )}
          </Button>
        </div>
      </form>
    </DialogContent>
  )
}

export function WorkspaceSwitcher({
  className,
  user,
}: WorkspaceSwitcherProps) {
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const router = useRouter();

  const handleWorkspaceChange = async (workspaceId: string) => {
    setPopoverOpen(false);
    await switchWorkspaceAction(workspaceId);
    router.refresh();
  };

  if (!user.workspaces || user.workspaces.length === 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" className={cn('h-10 w-10 p-0', className)}>
              <Link href="/settings/workspace/new">
                <PlusCircledIcon className="h-6 w-6 text-muted-foreground hover:text-white transition-colors" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-black/90 border-white/10 text-white z-[200]">
            <p>Criar um Workspace</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const currentWorkspace = user.workspaces.find(ws => ws.id === user.activeWorkspaceId) || user.workspaces[0];


  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                role="combobox"
                aria-expanded={popoverOpen}
                aria-label="Select a workspace"
                className={cn('h-10 w-10 p-0 relative group', className)}
              >
                <div className="relative">
                  <Avatar className="h-8 w-8 border border-white/10 group-hover:border-white/20 transition-all shadow-sm">
                    <AvatarImage
                      src={currentWorkspace.avatar}
                      alt={currentWorkspace.name}
                      data-ai-hint="logo"
                    />
                    <AvatarFallback className="bg-gradient-to-br from-zinc-800 to-zinc-900 text-white font-medium">
                      {currentWorkspace.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {/* Active Indicator Dot often looks nice */}
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-[#0f1117] rounded-full"></span>
                </div>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-black/90 border-white/10 text-white z-[200]">
            <p className="font-medium">{currentWorkspace.name}</p>
            <p className="text-xs text-white/50 capitalize">{currentWorkspace.isOwner ? 'Proprietário' : 'Membro'}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent className="w-[340px] p-0 bg-[#0f1117]/95 backdrop-blur-xl border-white/10 text-white shadow-2xl overflow-hidden ml-2 z-[200]" align="start" side="right" sideOffset={10}>
        <div className="flex flex-col max-h-[calc(100vh-100px)]">

          {/* Header */}
          <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
            <h4 className="text-xs font-semibold text-white/40 uppercase tracking-widest">Meus Workspaces</h4>
          </div>

          {/* List */}
          <div className="p-2 space-y-1 overflow-y-auto custom-scrollbar">
            {user.workspaces.map((ws) => {
              const isActive = user.activeWorkspaceId === ws.id;
              return (
                <div
                  key={ws.id}
                  onClick={() => handleWorkspaceChange(ws.id)}
                  className={cn(
                    "group flex items-center gap-3 p-3 rounded-xl transition-all duration-200 cursor-pointer border border-transparent",
                    isActive
                      ? "bg-blue-600/10 border-blue-600/20"
                      : "hover:bg-white/5 hover:border-white/5"
                  )}
                >
                  <Avatar className={cn(
                    "h-10 w-10 border transition-all",
                    isActive ? "border-blue-500/30 ring-2 ring-blue-500/20" : "border-white/10 group-hover:border-white/20"
                  )}>
                    <AvatarImage src={ws.avatar} alt={ws.name} />
                    <AvatarFallback className="bg-zinc-800 text-sm font-medium text-white/80">
                      {ws.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn(
                        "font-semibold truncate text-sm",
                        isActive ? "text-blue-100" : "text-white/90"
                      )}>
                        {ws.name}
                      </span>
                      {isActive && (
                        <Badge variant="secondary" className="bg-blue-500/20 text-blue-300 hover:bg-blue-500/20 text-[10px] px-1.5 h-4 border-none">
                          Ativo
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {ws.isOwner ? (
                        <Badge variant="outline" className="border-yellow-500/30 text-yellow-500 bg-yellow-500/10 text-[10px] px-1.5 h-4 rounded-md gap-1">
                          <Crown className="w-2.5 h-2.5" />
                          Proprietário
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-white/10 text-white/50 bg-white/5 text-[10px] px-1.5 h-4 rounded-md gap-1">
                          <Shield className="w-2.5 h-2.5" />
                          Membro
                        </Badge>
                      )}
                    </div>
                  </div>

                  {isActive && (
                    <div className="flex-shrink-0 text-blue-500">
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Separator className="bg-white/5" />

          {/* Actions Footer */}
          <div className="p-2 space-y-1 bg-black/20">
            <Button
              asChild
              variant="ghost"
              className="w-full justify-start text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 h-10 rounded-lg group"
            >
              <Link href="/settings/workspace/new">
                <div className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center mr-3 group-hover:bg-white/10 transition-colors border border-white/5">
                  <PlusCircledIcon className="h-4 w-4" />
                </div>
                Criar Workspace
                <ChevronRight className="ml-auto w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            </Button>

            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 h-10 rounded-lg group"
                >
                  <div className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center mr-3 group-hover:bg-white/10 transition-colors border border-white/5">
                    <LogIn className="h-4 w-4" />
                  </div>
                  Entrar com Convite
                  <ChevronRight className="ml-auto w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Button>
              </DialogTrigger>
              <JoinWorkspaceDialog />
            </Dialog>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
