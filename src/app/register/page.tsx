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
import { SignInPage } from '@/components/ui/sign-in-flow-1';

export default function RegisterPage() {
    const { t } = useI18n();
    const [registerState, registerAction, isRegisterPending] = useActionState(register, {
        success: false,
        message: null,
        user: null,
        requiresEmailConfirmation: false,
    });
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectTo = searchParams.get('next');
    const redirectPath = redirectTo?.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/inbox';
    const referralCode = normalizeReferralCode(searchParams.get('ref'));

    useEffect(() => {
        if (registerState.success && !registerState.requiresEmailConfirmation) {
            router.push(redirectPath);
        }
    }, [registerState.success, registerState.requiresEmailConfirmation, router, redirectPath]);

    useEffect(() => {
        if (!referralCode) {
            return;
        }

        document.cookie = `${REFERRAL_COOKIE_NAME}=${referralCode}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    }, [referralCode]);

    return (
        <SignInPage className="dark">
            <div className="relative z-10 grid min-h-screen w-full grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="relative flex min-h-screen flex-col items-center justify-center bg-transparent p-6 backdrop-blur-sm md:p-12 lg:min-h-0 lg:border-r lg:border-white/10">
                    <div className="mx-auto w-full max-w-sm py-2">
                        <div className="mb-8 flex items-center justify-between">
                            <Link href="/" className="transition-transform hover:scale-[1.02]">
                                <BrandMark labelClassName="text-white" />
                            </Link>
                            <Link
                                href="/"
                                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Voltar
                            </Link>
                        </div>

                        <div className="mb-8 text-left">
                            <h1 className="mb-3 text-3xl font-semibold leading-tight tracking-tight text-white md:text-[2rem]">
                                {t('Crie sua conta')}
                            </h1>
                            <p className="max-w-[28rem] text-sm leading-7 text-white/50">
                                {t('Comece a automatizar suas conversas hoje mesmo.')}
                            </p>
                        </div>

                        {registerState.message && (
                            <div className={`mb-6 animate-in rounded-2xl border p-4 text-sm font-medium fade-in slide-in-from-top-2 ${
                                registerState.success
                                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                    : 'border-red-500/20 bg-red-500/10 text-red-400'
                            }`}>
                                {registerState.message}
                            </div>
                        )}

                        {!registerState.requiresEmailConfirmation && (
                        <div className="[&_input]:bg-white/5 [&_input]:border-white/10 [&_input]:text-white [&_label]:text-white/70 [&_button[type=submit]]:bg-white [&_button[type=submit]]:text-black [&_button[type=submit]]:hover:bg-white/90 [&_button.bg-slate-950]:bg-white [&_button.bg-slate-950]:text-black [&_button.bg-slate-950]:hover:bg-white/90 [&_button[variant=outline]]:border-white/10 [&_button[variant=outline]]:bg-white/5 [&_button[variant=outline]]:text-white [&_.text-slate-500]:text-white/50 [&_.text-slate-950]:text-white [&_.bg-slate-200]:bg-white/10 [&_.border-slate-200]:border-white/10 [&_input[type=checkbox]]:border-white/20">
                            <RegisterForm
                                onRegister={registerAction}
                                pending={isRegisterPending}
                                referralCode={referralCode}
                                redirectTo={redirectTo}
                            />
                        </div>
                        )}

                        <p className="mt-8 text-sm text-white/50">
                            {t('Já tem uma conta?')} {' '}
                            <Link href={redirectTo ? `/login?next=${encodeURIComponent(redirectTo)}` : '/login'} className="font-semibold text-white transition-colors hover:text-[#20E401] hover:underline hover:underline-offset-4">
                                {t('Entre agora')}
                            </Link>
                        </p>
                    </div>
                </div>

                <RegisterShowcase />
            </div>
        </SignInPage>
    );
}
