'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { register } from '@/actions/auth';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { RegisterForm } from '@/components/auth/register-form';
import { RegisterShowcase } from '@/components/auth/register-showcase';
import { useActionState } from 'react';
import { useI18n } from '@/i18n/i18n-provider';
import { StarsBackground } from '@/components/landing/ui/StarsBackground';
import { ShootingStars } from '@/components/landing/ui/ShootingStars';
import Particles from '@/components/landing/ui/Particles';

export default function RegisterPage() {
    const { t } = useI18n();
    const [registerState, registerAction, isRegisterPending] = useActionState(register, { success: false, message: null, user: null });
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectTo = searchParams.get('next');

    useEffect(() => {
        if (registerState.success) {
            router.push(redirectTo || '/inbox');
        }
    }, [registerState.success, router, redirectTo]);

    return (
        <div className="h-screen bg-[#050507] text-gray-100 font-body selection:bg-brand-green/30 selection:text-white relative overflow-hidden flex items-center justify-center p-4 md:p-6">
            {/* Background Effects */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <StarsBackground />
                <ShootingStars />
                <Particles
                    className="absolute inset-0"
                    quantity={80}
                    ease={80}
                    color="#20E401"
                    refresh
                />
            </div>

            {/* Main Container - Split Screen */}
            <div className="w-full max-w-4xl max-h-[80vh] grid grid-cols-1 lg:grid-cols-2 bg-[#0B0B10]/40 backdrop-blur-2xl border border-white/10 rounded-[2rem] shadow-2xl relative z-10 overflow-hidden">

                {/* Left Side: Register Form */}
                <div className="flex flex-col items-center justify-center p-6 md:p-8 lg:p-10 relative overflow-y-auto">
                    <div className="w-full max-w-sm">
                        <div className="text-center mb-6">
                            <Link href="/" className="inline-flex items-center gap-2 mb-4 group transition-transform hover:scale-105">
                                <img src="/logo.png" alt="Dialogy" className="h-7 md:h-8 w-auto object-contain" />
                            </Link>

                            {/* Decorative icon box */}
                            <div className="flex justify-center mb-4">
                                <div className="w-12 h-12 rounded-xl bg-[#20E401]/10 border border-[#20E401]/20 flex items-center justify-center shadow-[0_0_30px_rgba(32,228,1,0.1)]">
                                    <div className="w-6 h-6 text-[#20E401]">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
                                    </div>
                                </div>
                            </div>

                            <h1 className="text-2xl md:text-3xl font-bold mb-2 tracking-tight text-white leading-tight">
                                {t("Crie sua conta")}
                            </h1>
                            <p className="text-gray-400 text-xs md:text-sm leading-relaxed">
                                {t("Comece a automatizar suas conversas hoje mesmo.")}
                            </p>
                        </div>

                        {registerState.message && (
                            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center font-medium animate-in fade-in slide-in-from-top-2">
                                {registerState.message}
                            </div>
                        )}

                        <RegisterForm onRegister={registerAction} pending={isRegisterPending} />

                        <p className="text-center mt-6 text-xs text-gray-500">
                            {t("Já tem uma conta?")} {' '}
                            <Link href="/login" className="text-[#20E401] hover:text-white font-semibold transition-colors decoration-[#20E401]/30 underline-offset-4 hover:underline">
                                {t("Entre agora")}
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Right Side: Showcase */}
                <RegisterShowcase />
            </div>
        </div>
    );
}
