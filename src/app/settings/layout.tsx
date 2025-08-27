
'use client';

import { Loader2, User, Building, Shield, PlusCircle, MessageSquareQuote } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import type { User as UserType } from '@/lib/types';

const settingsNavItems = [
    { href: '/settings/profile', label: 'Perfil', icon: User },
    { href: '/settings/workspace', label: 'Workspace', icon: Building },
    { href: '/settings/shortcuts', label: 'Atalhos', icon: MessageSquareQuote },
    { href: '/settings/security', label: 'Segurança', icon: Shield },
]

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [user, setUser] = useState<UserType | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
        const res = await fetch('/api/user');
        if (res.ok) {
            setUser(await res.json());
        }
    };
    fetchUser();
  }, []);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  // Clone children to pass the user prop down to them
  const childrenWithProps = React.Children.map(children, child => {
    if (React.isValidElement(child)) {
      // @ts-ignore
      return React.cloneElement(child, { user });
    }
    return child;
  });

  return (
    <div className="flex flex-col flex-1 h-full">
       <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background flex justify-between items-center">
          <div>
              <h1 className="text-2xl font-bold">Configurações</h1>
              <p className="text-muted-foreground">Gerencie suas preferências de perfil, workspace e conta.</p>
          </div>
          <Button asChild>
              <Link href="/settings/workspace/new">
                  <PlusCircle />
                  Criar Novo Workspace
              </Link>
          </Button>
      </header>
      <div className="flex-1 flex min-h-0 bg-muted/40">
          <aside className="w-full max-w-xs border-r bg-background flex flex-col p-4">
               <nav className="flex flex-col gap-2">
                  {settingsNavItems.map(item => (
                      <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                              pathname.startsWith(item.href)
                                  ? "bg-primary/10 text-primary"
                                  : "hover:bg-accent text-foreground"
                          )}
                      >
                          <item.icon className="h-5 w-5" />
                          <span>{item.label}</span>
                      </Link>
                  ))}
               </nav>
          </aside>
          <main className="flex-1 overflow-y-auto p-6">
               {childrenWithProps}
          </main>
      </div>
    </div>
  );
}
