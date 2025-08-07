

'use client';

import * as React from 'react';
import {
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { User } from '@/lib/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { useRouter } from 'next/navigation';

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
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const router = useRouter();

  const activeWorkspace = user.workspaces?.find(ws => ws.id === activeWorkspaceId);

  if (!activeWorkspace) {
    return null;
  }

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
                                src={activeWorkspace.avatar}
                                alt={activeWorkspace.name}
                                data-ai-hint="logo"
                            />
                            <AvatarFallback>
                                {activeWorkspace.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                    </Button>
                    </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">
                <p>{activeWorkspace.name}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>

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
                    setPopoverOpen(false);
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
                 <CommandItem
                    onSelect={() => {
                        setPopoverOpen(false);
                        router.push('/settings/workspace/new');
                    }}
                 >
                    <PlusCircledIcon className="mr-2 h-5 w-5" />
                    Criar Workspace
                 </CommandItem>
            </CommandList>
        </Command>
        </PopoverContent>
    </Popover>
  );
}
