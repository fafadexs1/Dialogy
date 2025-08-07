

'use client';

import Link from 'next/link';
import {
  MessageSquare,
  Users,
  Settings,
  BarChart2,
  LifeBuoy,
  LogOut,
  User as UserIcon,
  Slack,
  Puzzle,
  Bot,
  Building,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { User } from '@/lib/types';
import { signOutAction } from '@/actions/auth';
import { usePathname } from 'next/navigation';
import { WorkspaceSwitcher } from './workspace-switcher';
import { useState } from 'react';

interface SidebarProps {
  user: User;
}

const mainNavItems = [
  { href: '/', icon: MessageSquare, label: 'Central de Atendimento' },
  { href: '/crm', icon: Users, label: 'CRM 360º' },
  { href: '/team', icon: Slack, label: 'Equipes' },
  { href: '/autopilot', icon: Bot, label: 'Piloto Automático' },
  { href: '/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/integrations', icon: Puzzle, label: 'Integrações' },
];

function SignOut() {
    return (
      <form
        action={signOutAction}
        className="w-full"
      >
        <button type="submit" className="w-full text-left">
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sair</span>
          </DropdownMenuItem>
        </button>
      </form>
    );
  }

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(user.activeWorkspaceId);

  // This would in a real app be a server call or context update
  const handleWorkspaceChange = (workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    // In a real app, you'd likely redirect or reload data here.
    // For now, we'll just log it and the UI will update optimistically.
    window.location.reload();
  }

  return (
    <aside className="flex h-full w-auto flex-col justify-between border-r bg-card p-2">
      <div className="flex flex-col items-center gap-4">
        <Link href="/" className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LifeBuoy className="h-6 w-6" />
          <span className="sr-only">Dialogy</span>
        </Link>
        
        <WorkspaceSwitcher 
            user={user} 
            activeWorkspaceId={activeWorkspaceId}
            onWorkspaceChange={handleWorkspaceChange}
        />
        <Separator />

        <nav className="flex flex-col items-center gap-2">
          <TooltipProvider>
            {mainNavItems.map((item) => (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors
                      ${
                        pathname.startsWith(item.href) && (item.href !== '/' || pathname === '/')
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      }`}
                  >
                    <item.icon className="h-5 w-5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{item.label}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
        </nav>
      </div>
      <div className="flex flex-col items-center gap-2">
      <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button>
                <Avatar className="cursor-pointer">
                    <AvatarImage src={user.avatar} alt={user.name} data-ai-hint="person male" />
                    <AvatarFallback>{user.name?.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right">
            <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <Link href="/settings/profile">
                <DropdownMenuItem>
                    <UserIcon className="mr-2 h-4 w-4" />
                    <span>Perfil</span>
                </DropdownMenuItem>
            </Link>
             <Link href="/settings/workspace">
                <DropdownMenuItem>
                    <Building className="mr-2 h-4 w-4" />
                    <span>Configurações do Workspace</span>
                </DropdownMenuItem>
            </Link>
            <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                <span>Configurações da Conta</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <SignOut />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

function Separator() {
    return <div className="w-full h-px bg-border my-2" />
}
