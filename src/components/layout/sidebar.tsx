'use client';

import Link from 'next/link';
import {
  MessageSquare,
  Users,
  Settings,
  BarChart2,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  User as UserIcon,
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
import { signOut } from '@/auth';

interface SidebarProps {
  user: User;
  activeView: 'customer' | 'internal';
  setActiveView: (view: 'customer' | 'internal') => void;
}

const mainNavItems = [
  { id: 'customer', icon: MessageSquare, label: 'Conversas' },
  { id: 'internal', icon: Users, label: 'Equipe' },
];

const otherNavItems = [
    { href: '#', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '#', icon: BarChart2, label: 'Relatórios' },
    { href: '#', icon: Settings, label: 'Configurações' },
];

function SignOut() {
    return (
      <form
        action={async () => {
          'use server';
          await signOut();
        }}
        className="w-full"
      >
        <button type="submit" className="w-full">
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sair</span>
          </DropdownMenuItem>
        </button>
      </form>
    );
  }

export function Sidebar({ user, activeView, setActiveView }: SidebarProps) {
  return (
    <aside className="flex h-full flex-col items-center justify-between border-r bg-card p-2">
      <div className="flex flex-col items-center gap-4">
        <Link href="/" className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LifeBuoy className="h-6 w-6" />
          <span className="sr-only">ConnectISP</span>
        </Link>
        <nav className="flex flex-col items-center gap-2">
          <TooltipProvider>
            {mainNavItems.map((item) => (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveView(item.id as 'customer' | 'internal')}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors
                      ${
                        activeView === item.id
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      }`}
                  >
                    <item.icon className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{item.label}</p>
                </TooltipContent>
              </Tooltip>
            ))}
            <hr className="my-2 w-full border-t border-border" />
            {otherNavItems.map((item) => (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
            <DropdownMenuItem>
              <UserIcon className="mr-2 h-4 w-4" />
              <span>Perfil</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                <span>Configurações</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <SignOut />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
