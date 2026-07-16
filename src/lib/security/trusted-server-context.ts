import 'server-only';

const TRUSTED_SERVER_CALL = Symbol('dialogy.trusted-server-call');

export type TrustedActorContext = {
  readonly token: typeof TRUSTED_SERVER_CALL;
  readonly user: { id: string; name: string; email?: string | null };
  readonly isSystemAgent: boolean;
};

export type TrustedUserContext = {
  readonly token: typeof TRUSTED_SERVER_CALL;
  readonly userId: string;
};

export function createTrustedActorContext(input: {
  user: TrustedActorContext['user'];
  isSystemAgent?: boolean;
}): TrustedActorContext {
  return { token: TRUSTED_SERVER_CALL, user: input.user, isSystemAgent: Boolean(input.isSystemAgent) };
}

export function createTrustedUserContext(userId: string): TrustedUserContext {
  return { token: TRUSTED_SERVER_CALL, userId };
}

export function isTrustedActorContext(value: unknown): value is TrustedActorContext {
  return Boolean(value && typeof value === 'object' && (value as TrustedActorContext).token === TRUSTED_SERVER_CALL);
}

export function isTrustedUserContext(value: unknown): value is TrustedUserContext {
  return Boolean(value && typeof value === 'object' && (value as TrustedUserContext).token === TRUSTED_SERVER_CALL);
}
