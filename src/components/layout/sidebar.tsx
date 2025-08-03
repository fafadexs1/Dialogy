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

interface SidebarProps {
  user: User;
}

const mainNavItems = [
  { href: '/', icon: MessageSquare, label: 'Central de Atendimento' },
  { href: '/crm', icon: Users, label: 'CRM 360º' },
  { href: '/team', icon: Slack, label: 'Equipe' },
  { href: '/analytics', icon: BarChart2, label: 'Analytics' },
];

function SignOut() {
    return (
      <form
        action={signOutAction}
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

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full flex-col items-center justify-between border-r bg-card p-2">
      <div className="flex flex-col items-center gap-4">
        <Link href="/" className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LifeBuoy className="h-6 w-6" />
          <span className="sr-only">Dialogy</span>
        </Link>
        <nav className="flex flex-col items-center gap-2">
          <TooltipProvider>
            {mainNavItems.map((item) => (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors
                      ${
                        pathname === item.href
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
