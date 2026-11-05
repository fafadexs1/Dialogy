import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form';
import { createClient } from '@/lib/supabase/server';
import { getServerI18n } from '@/i18n/server';
import { AuthShell } from '@/components/auth/auth-shell';

interface LoginPageProps {
  searchParams: Promise<{
    registered?: string;
    error?: string;
    activation_error?: string;
    next?: string;
  }>;
}

function safeNextPath(value: string | null | undefined): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/inbox';
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const { t } = await getServerI18n();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const resolvedSearchParams = await searchParams;
  const nextPath = safeNextPath(resolvedSearchParams?.next);

  if (user && !resolvedSearchParams?.error) {
    redirect(nextPath);
  }

  const isRegistered = resolvedSearchParams?.registered === 'true';
  const activationError = resolvedSearchParams?.activation_error === 'invalid_or_expired';

  return (
    <AuthShell mode="login" alternateHref={resolvedSearchParams?.next ? `/register?next=${encodeURIComponent(nextPath)}` : '/register'}>
      {isRegistered && (
        <div role="status" className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">
          {t('Conta criada com sucesso! Faça login para continuar.')}
        </div>
      )}
      {activationError && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
          {t('Link de ativação inválido ou expirado. Solicite um novo cadastro ou tente entrar novamente.')}
        </div>
      )}
      <LoginForm redirectTo={resolvedSearchParams?.next} />
    </AuthShell>
  );
}
