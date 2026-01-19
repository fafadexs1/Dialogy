'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { User } from '@/lib/types';
import { useInboxStore } from '@/hooks/use-inbox-store';

import { Crown } from 'lucide-react';
import { PLANS, PlanType } from '@/lib/plans-types';

// Custom event to signal workspace change
export const WORKSPACE_CHANGED_EVENT = 'dialogy:workspace-changed';

interface WorkspaceSwitcherProps {
  className?: string;
  user: User;
}

export function WorkspaceSwitcher({ className, user }: WorkspaceSwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  const currentWorkspace =
    user.workspaces?.find(ws => ws.id === user.activeWorkspaceId) || user.workspaces?.[0];

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (!currentWorkspace) {
    return (
      <Button asChild variant="ghost" className={cn('h-8 w-8 2xl:h-10 2xl:w-10 p-0', className)}>
        <Link href="/settings/workspace/new">+</Link>
      </Button>
    );
  }

  const handleSwitch = async (workspaceId: string) => {
    setOpen(false);
    const { switchWorkspaceAction } = await import('@/actions/workspace');
    await switchWorkspaceAction(workspaceId);

    // Reset inbox store to clear old workspace data
    useInboxStore.getState().reset();

    // Dispatch custom event for PresenceProvider to refetch user data
    window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED_EVENT, {
      detail: { workspaceId }
    }));

    // Smart refresh - updates server components without full page reload
    router.refresh();
  };

  return (
    <div className={cn('relative', className)} ref={panelRef}>
      <Button
        variant="ghost"
        className="h-8 w-8 2xl:h-10 2xl:w-10 p-0 rounded-lg 2xl:rounded-xl bg-sidebar-accent border border-sidebar-border hover:border-sidebar-border/80 transition-all"
        onClick={() => setOpen((o) => !o)}
        aria-label="Selecionar workspace"
      >
        <div className="relative">
          <Avatar className="h-6 w-6 2xl:h-8 2xl:w-8 border border-sidebar-border rounded-md">
            <AvatarImage src={currentWorkspace.avatar} alt={currentWorkspace.name} className="object-cover" />
            <AvatarFallback className="rounded-md">{currentWorkspace.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-sidebar rounded-full" />
        </div>
      </Button>

      {open && (
        <div className="absolute left-14 top-0 z-50 w-72 rounded-xl border border-sidebar-border bg-sidebar shadow-2xl p-2 space-y-2 mt-4">
          <div className="px-2 py-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Workspaces</p>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {user.workspaces?.map((ws) => {
              const isActive = user.activeWorkspaceId === ws.id;
              const plan = PLANS[(ws.plan as PlanType) || 'starter'];

              return (
                <button
                  key={ws.id}
                  onClick={() => handleSwitch(ws.id)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-lg px-3 py-3 transition-all text-left relative group',
                    isActive ? 'bg-primary/10 border border-primary/20 text-sidebar-foreground' : 'hover:bg-sidebar-accent text-sidebar-foreground/80 border border-transparent'
                  )}
                >
                  <div className="relative">
                    <Avatar className="h-10 w-10 border border-sidebar-border rounded-md">
                      <AvatarImage src={ws.avatar} alt={ws.name} className="object-cover" />
                      <AvatarFallback className="bg-muted text-sidebar-foreground rounded-md">{ws.name.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    {ws.isOwner && (
                      <div className="absolute -top-1 -right-1 bg-sidebar rounded-full p-0.5 border border-sidebar-border shadow-sm">
                        <Crown className="h-3 w-3 text-orange-500 fill-orange-500" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate leading-tight">{ws.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground bg-sidebar-accent px-1.5 py-0.5 rounded-md">
                        {plan?.label || ws.plan || 'Starter'}
                      </span>
                      <p className="text-[11px] text-muted-foreground">{isActive ? 'Ativo' : 'Selecionar'}</p>
                    </div>
                  </div>

                  {isActive && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" />}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2 pt-2 border-t border-sidebar-border mt-1">
            <Button asChild variant="ghost" className="flex-1 h-9 text-xs uppercase tracking-wider font-medium text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent">
              <Link href="/settings/workspace/new">Criar</Link>
            </Button>
            <Button asChild variant="ghost" className="flex-1 h-9 text-xs uppercase tracking-wider font-medium text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent">
              <Link href="/settings/workspace">Gerenciar</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
