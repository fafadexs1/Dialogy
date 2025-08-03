
'use client';

import * as React from 'react';
import {
  CaretSortIcon,
  CheckIcon,
  PlusCircledIcon,
} from '@radix-ui/react-icons';

import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { User, Workspace } from '@/lib/types';

type PopoverTriggerProps = React.ComponentPropsWithoutRef<
  typeof PopoverTrigger
>;

interface WorkspaceSwitcherProps extends PopoverTriggerProps {
    user: User;
    activeWorkspaceId: string;
    onWorkspaceChange: (workspaceId: string) => void;
}

export function WorkspaceSwitcher({
  className,
  user,
  activeWorkspaceId,
  onWorkspaceChange,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const [showNewTeamDialog, setShowNewTeamDialog] = React.useState(false);

  const activeWorkspace = user.workspaces?.find(ws => ws.id === activeWorkspaceId);

  return (
    <Dialog open={showNewTeamDialog} onOpenChange={setShowNewTeamDialog}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label="Select a workspace"
            className={cn('w-full justify-start p-2 h-auto', className)}
          >
            <Avatar className="mr-2 h-8 w-8">
              <AvatarImage
                src={activeWorkspace?.avatar}
                alt={activeWorkspace?.name}
                data-ai-hint="logo"
              />
              <AvatarFallback>
                {activeWorkspace?.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col items-start">
                <span className="font-semibold text-sm">
                    {activeWorkspace?.name}
                </span>
                <span className='text-xs text-muted-foreground'>Plano Business</span>
            </div>
            <CaretSortIcon className="ml-auto h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-0">
          <Command>
            <CommandList>
              <CommandInput placeholder="Buscar workspace..." />
              <CommandEmpty>Nenhum workspace encontrado.</CommandEmpty>
              <CommandGroup heading="Workspaces">
                {user.workspaces?.map((ws) => (
                  <CommandItem
                    key={ws.id}
                    onSelect={() => {
                      onWorkspaceChange(ws.id);
                      setOpen(false);
                    }}
                    className="text-sm"
                  >
                    <Avatar className="mr-2 h-5 w-5">
                      <AvatarImage
                        src={ws.avatar}
                        alt={ws.name}
                      />
                      <AvatarFallback>{ws.name.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    {ws.name}
                    <CheckIcon
                      className={cn(
                        'ml-auto h-4 w-4',
                        activeWorkspaceId === ws.id
                          ? 'opacity-100'
                          : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <CommandSeparator />
            <CommandList>
              <CommandGroup>
                <DialogTrigger asChild>
                  <CommandItem
                    onSelect={() => {
                      setOpen(false);
                      setShowNewTeamDialog(true);
                    }}
                  >
                    <PlusCircledIcon className="mr-2 h-5 w-5" />
                    Criar Workspace
                  </CommandItem>
                </DialogTrigger>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar Workspace</DialogTitle>
          <DialogDescription>
            Crie um novo workspace para colaborar com sua equipe.
          </DialogDescription>
        </DialogHeader>
        <div>
          <div className="space-y-4 py-2 pb-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome do Workspace</Label>
              <Input id="name" placeholder="Ex: Acme Inc." />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowNewTeamDialog(false)}>
            Cancelar
          </Button>
          <Button type="submit">Continuar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
