import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const login = read('../app/login.tsx');
const forgotPassword = read('../app/forgot-password.tsx');
const verifyEmail = read('../app/verify-email.tsx');

test('login clears stale authentication feedback when the email or password changes', () => {
  expect(login).toContain("setNeedsVerification(false);");
  expect(login).toContain("setVerificationMessage('');\n          setErrorMessage('');");
  expect(login).toContain("setPassword(value);\n          setErrorMessage('');");
});

test('forgot-password clears old success and error feedback when the email changes', () => {
  expect(forgotPassword).toContain("setEmail(value);\n          setMessage('');\n          setErrorMessage('');");
});

test('verify-email clears old success and error feedback when the email changes', () => {
  expect(verifyEmail).toContain("setEmail(value);\n          setMessage('');\n          setErrorMessage('');");
});
