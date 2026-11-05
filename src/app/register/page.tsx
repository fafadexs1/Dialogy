'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { register } from '@/actions/auth';
import { RegisterForm } from '@/components/auth/register-form';
import { REFERRAL_COOKIE_NAME, normalizeReferralCode } from '@/lib/referrals';
import { AuthShell } from '@/components/auth/auth-shell';

export default function RegisterPage() {
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
        <AuthShell mode="register" alternateHref={redirectTo ? `/login?next=${encodeURIComponent(redirectPath)}` : '/login'}>
            {registerState.message && (
                <div role={registerState.success ? 'status' : 'alert'} className={`mb-6 rounded-xl border p-4 text-sm leading-6 ${
                    registerState.success
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-red-200 bg-red-50 text-red-700'
                }`}>
                    {registerState.message}
                </div>
            )}
            {!registerState.requiresEmailConfirmation && (
                <RegisterForm
                    onRegister={registerAction}
                    pending={isRegisterPending}
                    referralCode={referralCode}
                    redirectTo={redirectTo}
                />
            )}
        </AuthShell>
    );
}
