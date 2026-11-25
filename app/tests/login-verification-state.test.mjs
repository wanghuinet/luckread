import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const loginScreen = readFileSync(new URL('../app/login.tsx', import.meta.url), 'utf8');

test('only the explicit EMAIL_NOT_VERIFIED code exposes the resend-verification recovery action', () => {
  expect(loginScreen).toContain("cause.code === 'EMAIL_NOT_VERIFIED'");
  expect(loginScreen).not.toContain("cause.status === 403");
});
