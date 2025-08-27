

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
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

type PopoverTriggerProps = React.ComponentPropsWithoutRef<
  typeof PopoverTrigger
>;

interface WorkspaceSwitcherProps extends PopoverTriggerProps {
  user: User;
}

export function WorkspaceSwitcher({
  className,
  user,
}: WorkspaceSwitcherProps) {
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  const handleWorkspaceChange = async (workspaceId: string) => {
    setPopoverOpen(false);
    await switchWorkspaceAction(workspaceId);
    window.location.reload();
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
                className="w-full justify-start text-sm font-normal"
            >
                <Avatar className="mr-2 h-5 w-5">
                <AvatarImage
                    src={ws.avatar}
                    alt={ws.name}
                />
                <AvatarFallback>{ws.name.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="truncate">{ws.name}</span>
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
        </div>
      </PopoverContent>
    </Popover>
  );
}
