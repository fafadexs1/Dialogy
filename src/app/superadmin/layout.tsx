
import React, { ReactNode } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import ErrorBoundary from '@/components/layout/error-boundary';
import { Sidebar } from './sidebar';
import { ThemeProvider } from '@/providers/theme-provider';
import { Toaster } from '@/components/ui/toaster';

async function checkSuperAdmin(userId: string) {
    if (!userId) return false;
    try {
        const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
        if (result.rowCount === 0) {
            return false;
        }
        return result.rows[0].is_superadmin;
    } catch (error) {
        console.error("[CHECK_SUPERADMIN_ERROR]", error);
        return false;
    }
}

export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        redirect('/');
    }

    return (
        <>
            <ErrorBoundary>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="dark"
                    storageKey={`dialogy-theme-${user.id}`}
                    enableSystem
                    disableTransitionOnChange
                >
                    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
                        <Sidebar />
                        <div className="flex min-w-0 flex-col">
                            <nav aria-label="Superadmin" className="flex gap-4 overflow-x-auto border-b bg-card px-4 py-3 text-sm md:hidden">
                                <Link className="whitespace-nowrap" href="/superadmin">Visão geral</Link>
                                <Link className="whitespace-nowrap" href="/superadmin/plans">Planos</Link>
                                <Link className="whitespace-nowrap" href="/superadmin/billing">Cobranças</Link>
                                <Link className="whitespace-nowrap" href="/superadmin/billing/settings">ASAAS</Link>
                                <Link className="whitespace-nowrap" href="/inbox">Voltar ao app</Link>
                            </nav>
                            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                                {children}
                            </main>
                        </div>
                    </div>
                </ThemeProvider>
            </ErrorBoundary>
            <Toaster />
        </>
    );
}
