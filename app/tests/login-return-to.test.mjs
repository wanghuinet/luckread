import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const loginPath = new URL('../app/login.tsx', import.meta.url);
const rootPath = new URL('../app/_layout.tsx', import.meta.url);

test('login restores a validated internal return destination after authentication', async () => {
  const source = await readFile(loginPath, 'utf8');
  assert.match(source, /returnTo\?: string \| string\[\]/);
  assert.match(source, /requestedReturnTo\.startsWith\('\/'\)/);
  assert.match(source, /!requestedReturnTo\.startsWith\('\/\/'\)/);
  assert.match(source, /!requestedReturnTo\.includes\('\\\\'\)/);
  assert.match(source, /router\.replace\(\(isAddingAccount \? '\/' : safeReturnTo\)/);
});

test('root auth redirect does not override a valid login return destination', async () => {
  const source = await readFile(rootPath, 'utf8');
  assert.match(source, /returnTo\?: string \| string\[\]/);
  assert.match(source, /!hasSafeReturnTo/);
});
