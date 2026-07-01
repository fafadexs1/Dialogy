export function getLoginErrorMessage(errorCode?: string, errorMessage?: string): string {
  const normalized = `${errorCode || ''} ${errorMessage || ''}`.toLowerCase();
  if (normalized.includes('email_not_confirmed') || normalized.includes('email not confirmed')) {
    return 'Confirme seu e-mail antes de entrar. Verifique também a pasta de spam.';
  }
  return 'E-mail ou senha incorretos.';
}
