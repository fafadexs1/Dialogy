import { describe, expect, it } from 'vitest';
import { getLoginErrorMessage } from '@/lib/auth/login-errors';

describe('getLoginErrorMessage', () => {
  it('shows a clear incorrect-password message without revealing account existence', () => {
    expect(getLoginErrorMessage('invalid_credentials', 'Invalid login credentials'))
      .toBe('E-mail ou senha incorretos.');
  });

  it('tells an unconfirmed user to activate the account', () => {
    expect(getLoginErrorMessage('email_not_confirmed', 'Email not confirmed'))
      .toContain('Confirme seu e-mail');
  });
});
