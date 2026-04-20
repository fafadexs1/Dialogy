'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useActionState } from 'react';
import { register } from '@/actions/auth';
import { RegisterForm } from '@/components/auth/register-form';
import { RegisterShowcase } from '@/components/auth/register-showcase';
import { BrandMark } from '@/components/landing/BrandMark';
import { useI18n } from '@/i18n/i18n-provider';
import { REFERRAL_COOKIE_NAME, normalizeReferralCode } from '@/lib/referrals';

export default function RegisterPage() {
    const { t } = useI18n();
    const [registerState, registerAction, isRegisterPending] = useActionState(register, { success: false, message: null, user: null });
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectTo = searchParams.get('next');
    const referralCode = normalizeReferralCode(searchParams.get('ref'));

    useEffect(() => {
        if (registerState.success) {
            router.push(redirectTo || '/inbox');
        }
    }, [registerState.success, router, redirectTo]);

    useEffect(() => {
        if (!referralCode) {
            return;
        }

        document.cookie = `${REFERRAL_COOKIE_NAME}=${referralCode}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    }, [referralCode]);

    return (
        <div className="relative min-h-screen w-full bg-[#f4f1e8] font-body text-slate-900 selection:bg-brand-green/20 selection:text-slate-950">
            <div className="pointer-events-none fixed inset-0 z-0">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(25,245,178,0.12),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(58,169,255,0.08),transparent_30%),linear-gradient(180deg,#ffffff_0%,#f4f1e8_68%,#ece7db_100%)]" />
                <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.035)_1px,transparent_1px)] bg-[size:36px_36px] opacity-20" />
                <div className="absolute left-[10%] top-[18%] h-[20rem] w-[20rem] rounded-full bg-emerald-200/25 blur-[80px] md:h-56 md:w-56 md:blur-[110px]" />
                <div className="absolute bottom-[12%] right-[12%] h-[25rem] w-[25rem] rounded-full bg-sky-200/20 blur-[100px] md:h-64 md:w-64 md:blur-[120px]" />
            </div>

            <div className="relative z-10 grid min-h-screen w-full grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="relative flex min-h-screen flex-col items-center justify-center bg-white/60 p-6 backdrop-blur-2xl md:p-12 lg:min-h-0 lg:border-r lg:border-black/5">
                    <div className="mx-auto w-full max-w-sm py-2">
                        <div className="mb-8 flex items-center justify-between">
                            <Link href="/" className="transition-transform hover:scale-[1.02]">
                                <BrandMark />
                            </Link>
                            <Link
                                href="/"
                                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-950"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Voltar
                            </Link>
                        </div>

                        <div className="mb-8 text-left">
                            <h1 className="mb-3 text-3xl font-semibold leading-tight tracking-tight text-slate-950 md:text-[2rem]">
                                {t('Crie sua conta')}
                            </h1>
                            <p className="max-w-[28rem] text-sm leading-7 text-slate-500">
                                {t('Comece a automatizar suas conversas hoje mesmo.')}
                            </p>
                        </div>

                        {registerState.message && (
                            <div className="mb-6 animate-in rounded-2xl border border-red-200 bg-red-50/80 p-4 text-sm font-medium text-red-700 fade-in slide-in-from-top-2">
                                {registerState.message}
                            </div>
                        )}

                        <RegisterForm
                            onRegister={registerAction}
                            pending={isRegisterPending}
                            referralCode={referralCode}
                        />

                        <p className="mt-8 text-sm text-slate-500">
                            {t('Já tem uma conta?')} {' '}
                            <Link href="/login" className="font-semibold text-slate-950 transition-colors hover:text-[#20E401] hover:underline hover:underline-offset-4">
                                {t('Entre agora')}
                            </Link>
                        </p>
                    </div>
                </div>

                <RegisterShowcase />
            </div>
        </div>
    );
}
