
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
import { AlertCircle, Loader2, LogIn } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

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
        <DialogContent>
            <form action={formAction}>
                 <DialogHeader>
                    <DialogTitle>Entrar em um Workspace</DialogTitle>
                    <DialogDescription>
                        Insira o código de convite que você recebeu para se juntar a uma equipe existente.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Label htmlFor="invite-code-dialog">Código de Convite</Label>
                    <Input
                        id="invite-code-dialog"
                        name="inviteCode"
                        placeholder="Ex: ABC-123"
                        required
                        autoFocus
                        disabled={pending}
                    />
                     {state.error && (
                        <Alert variant="destructive" className="mt-4">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Erro ao entrar no workspace</AlertTitle>
                            <AlertDescription>{state.error}</AlertDescription>
                        </Alert>
                    )}
                </div>
                <div className="flex justify-end gap-2">
                     <Button type="submit" className="w-full" disabled={pending}>
                        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                         <LogIn className="mr-2 h-4 w-4" />
                        {pending ? 'Verificando...' : 'Entrar no Workspace'}
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
                             <PlusCircledIcon className="h-6 w-6" />
                        </Link>
                    </Button>
                </TooltipTrigger>
                 <TooltipContent side="right">
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
                className={cn('h-10 w-10 p-0', className)}
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage
                    src={currentWorkspace.avatar}
                    alt={currentWorkspace.name}
                    data-ai-hint="logo"
                  />
                  <AvatarFallback>
                    {currentWorkspace.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{currentWorkspace.name}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent className="w-[250px] p-0" align="start">
        <div className="space-y-1 p-2">
            <p className="text-xs font-medium text-muted-foreground px-2 py-1.5">Workspaces</p>
            {user.workspaces.map((ws) => (
            <Button
                key={ws.id}
                variant="ghost"
                onClick={() => handleWorkspaceChange(ws.id)}
                className="w-full justify-start text-sm font-normal h-auto py-2"
            >
                <Avatar className="mr-2 h-7 w-7">
                <AvatarImage
                    src={ws.avatar}
                    alt={ws.name}
                />
                <AvatarFallback>{ws.name.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left">
                    <p className="truncate">{ws.name}</p>
                    {ws.roleName && <p className="text-xs text-muted-foreground">{ws.roleName}</p>}
                </div>
                <CheckIcon
                className={cn(
                    'ml-auto h-4 w-4',
                    user.activeWorkspaceId === ws.id
                    ? 'opacity-100'
                    : 'opacity-0'
                )}
                />
            </Button>
            ))}
        </div>
        <Separator />
        <div className='p-2'>
            <Button
                asChild
                variant="ghost"
                className="w-full justify-start text-sm font-normal"
            >
                <Link href="/settings/workspace/new">
                    <PlusCircledIcon className="mr-2 h-5 w-5" />
                    Criar Workspace
                </Link>
            </Button>
            <Dialog>
                <DialogTrigger asChild>
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-sm font-normal"
                    >
                        <LogIn className="mr-2 h-5 w-5" />
                        Entrar com Convite
                    </Button>
                </DialogTrigger>
                <JoinWorkspaceDialog />
            </Dialog>
        </div>
      </PopoverContent>
    </Popover>
  );
}
