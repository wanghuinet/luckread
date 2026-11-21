import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const calls = [];
let apiResult = {
  response: new Response(null, { status: 202 }),
  data: null,
  error: null,
};

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return apiResult;
  },
  createIdempotencyKey: () => 'generated-registration-key',
}));

const {
  isValidAuthEmail,
  isValidAuthPassword,
  isValidAuthUsername,
  normalizeAuthEmail,
  readAuthApiErrorCode,
  readAuthApiErrorMessage,
  registerWithEmail,
  requestEmailVerification,
  requestPasswordRecovery,
} = await import('../lib/auth-flow-api.ts');

const { AUTH_REGISTRATION_POLICY_VERSION } = await import('../lib/auth-registration-policy.ts');

beforeEach(() => {
  calls.length = 0;
  apiResult = {
    response: new Response(null, { status: 202 }),
    data: null,
    error: null,
  };
});

test('normalizes and validates email, username and password against W01 registration rules', () => {
  expect(normalizeAuthEmail('  Reader@Example.COM  ')).toBe('reader@example.com');
  expect(isValidAuthEmail('reader@example.com')).toBe(true);
  expect(isValidAuthEmail('reader@invalid')).toBe(false);
  expect(isValidAuthEmail('  ')).toBe(false);
  expect(isValidAuthUsername('Reader123')).toBe(true);
  expect(isValidAuthUsername('ab_123')).toBe(false);
  expect(isValidAuthUsername('abc')).toBe(false);
  expect(isValidAuthPassword('a'.repeat(15))).toBe(true);
  expect(isValidAuthPassword('short')).toBe(false);
  expect(isValidAuthPassword('a'.repeat(129))).toBe(false);
});

test('registers by email with the canonical consent policy and a stable idempotency key', async () => {
  apiResult = {
    response: new Response(JSON.stringify({ userId: 'user-123', accountState: 'PENDING_VERIFICATION' }), {
      status: 201,
    }),
    data: { userId: 'user-123', accountState: 'PENDING_VERIFICATION' },
    error: null,
  };

  await registerWithEmail({
    email: ' Reader@Example.COM ',
    username: 'Reader123',
    password: 'correct horse battery staple long',
    idempotencyKey: 'registration-retry-key',
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/auth/register');
  expect(calls[0].options.method).toBe('POST');
  expect(calls[0].options.auth).toBe(false);
  expect(calls[0].options.idempotencyKey).toBe('registration-retry-key');
  expect(JSON.parse(calls[0].options.body)).toEqual({
    identityType: 'email',
    identity: 'reader@example.com',
    credential: 'correct horse battery staple long',
    username: 'Reader123',
    consent: {
      purpose: 'ACCOUNT_REGISTRATION',
      policyVersion: AUTH_REGISTRATION_POLICY_VERSION,
    },
  });
});

test('creates an idempotency key when callers do not provide a retry key', async () => {
  await registerWithEmail({
    email: 'reader@example.com',
    username: 'Reader123',
    password: 'a long unique password phrase',
  });
  expect(calls[0].options.idempotencyKey).toBe('generated-registration-key');
});

test('requests email verification through the public rate-limited endpoint without session auth', async () => {
  await requestEmailVerification(' Reader@Example.COM ');

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/auth/verification/send');
  expect(calls[0].options.method).toBe('POST');
  expect(calls[0].options.auth).toBe(false);
  expect(calls[0].options.idempotencyKey).toBe(false);
  expect(JSON.parse(calls[0].options.body)).toEqual({ identity: 'reader@example.com' });
});

test('requests password recovery without disclosing whether an account exists', async () => {
  await requestPasswordRecovery(' Reader@Example.COM ');

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/auth/password/reset/request');
  expect(calls[0].options.auth).toBe(false);
  expect(calls[0].options.idempotencyKey).toBe(false);
  expect(JSON.parse(calls[0].options.body)).toEqual({ identifier: 'reader@example.com' });
});

test('native registration policy stays synchronized with the canonical production policy', () => {
  const canonical = JSON.parse(
    readFileSync(new URL('../../artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json', import.meta.url), 'utf8'),
  );

  expect(canonical.status).toBe('APPROVED');
  expect(AUTH_REGISTRATION_POLICY_VERSION).toBe(canonical.policyVersion);
});

test('extracts structured auth API errors without depending on transport internals', () => {
  const payload = { error: { code: 'EMAIL_NOT_VERIFIED', message: '该邮箱尚未验证。' } };
  expect(readAuthApiErrorCode(payload)).toBe('EMAIL_NOT_VERIFIED');
  expect(readAuthApiErrorMessage(payload, 'fallback')).toBe('该邮箱尚未验证。');
  expect(readAuthApiErrorCode({ error: {} })).toBeUndefined();
  expect(readAuthApiErrorMessage(null, 'fallback')).toBe('fallback');
});
