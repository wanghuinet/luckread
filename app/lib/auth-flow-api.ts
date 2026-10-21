import { apiRequest, createIdempotencyKey } from './api-client';
import { AUTH_REGISTRATION_POLICY_VERSION } from './auth-registration-policy';

export type AuthFlowApiError = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  requestId?: string;
};

export type RegistrationResponse = {
  userId: string;
  accountState: 'PENDING_VERIFICATION';
  requestId?: string;
};

export type RegistrationInput = {
  email: string;
  username: string;
  password: string;
  idempotencyKey?: string;
};

export function normalizeAuthEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidAuthEmail(value: string): boolean {
  const email = normalizeAuthEmail(value);
  return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidAuthUsername(value: string): boolean {
  return /^[A-Za-z0-9]{6,32}$/.test(value.trim());
}

export function isValidAuthPassword(value: string): boolean {
  return value.length >= 15 && value.length <= 128;
}

/** Uses the existing W01 registration contract and the canonical consent policy. */
export function registerWithEmail(input: RegistrationInput) {
  const idempotencyKey = input.idempotencyKey?.trim() || createIdempotencyKey();
  return apiRequest<RegistrationResponse | AuthFlowApiError>('/auth/register', {
    method: 'POST',
    auth: false,
    idempotencyKey,
    body: JSON.stringify({
      identityType: 'email',
      identity: normalizeAuthEmail(input.email),
      credential: input.password,
      username: input.username.trim(),
      consent: {
        purpose: 'ACCOUNT_REGISTRATION',
        policyVersion: AUTH_REGISTRATION_POLICY_VERSION,
      },
    }),
  });
}

/** Public, rate-limited W01 entry for requesting or resending an email verification message. */
export function requestEmailVerification(identity: string) {
  return apiRequest<null | AuthFlowApiError>('/auth/verification/send', {
    method: 'POST',
    auth: false,
    idempotencyKey: false,
    body: JSON.stringify({ identity: normalizeAuthEmail(identity) }),
  });
}

/** Public W01 recovery request. Its success message must not disclose account existence. */
export function requestPasswordRecovery(identifier: string) {
  return apiRequest<null | AuthFlowApiError>('/auth/password/reset/request', {
    method: 'POST',
    auth: false,
    idempotencyKey: false,
    body: JSON.stringify({ identifier: normalizeAuthEmail(identifier) }),
  });
}

export function readAuthApiErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('error' in value)) return undefined;
  const error = (value as AuthFlowApiError).error;
  return typeof error?.code === 'string' ? error.code.toUpperCase() : undefined;
}

export function readAuthApiErrorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object' || !('error' in value)) return fallback;
  const message = (value as AuthFlowApiError).error?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
