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

test('login ignores responses from an earlier email or password revision', () => {
  expect(login).toContain('const inputRevision = useRef(0);');
  expect(login).toContain('const requestRevision = inputRevision.current;');
  expect(login).toContain('if (inputRevision.current !== requestRevision) return;');
  expect(login).toContain('if (inputRevision.current === requestRevision) router.replace');
});

test('email recovery screens ignore responses for an email that has since changed', () => {
  for (const source of [forgotPassword, verifyEmail]) {
    expect(source).toContain('const emailRevision = useRef(0);');
    expect(source).toContain('const requestRevision = emailRevision.current;');
    expect(source).toContain('if (emailRevision.current !== requestRevision) return;');
  }
});

test('login inputs are locked while authentication can mutate the active session', () => {
  expect(login).toContain('value={email}\n        editable={!submitting}');
  expect(login).toContain('value={password}\n        editable={!submitting}');
});

test('recovery and verification inputs are locked while their requests are pending', () => {
  expect(forgotPassword).toContain('value={email}\n        editable={!submitting}');
  expect(verifyEmail).toContain('value={email}\n        editable={!submitting}');
});
