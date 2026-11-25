import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('account switch rollback reconciles push registration for the restored account', () => {
  const source = readFileSync(new URL('../store/auth-store.ts', import.meta.url), 'utf8');
  const rollback = source.slice(source.indexOf('    } catch (cause) {'), source.indexOf('  removeAccount: async'));
  expect(source).toContain('syncPushEndpointForAuthenticatedUser');
  expect(rollback).toContain('syncPushEndpointForAuthenticatedUser(previousAccountId)');
  expect(rollback).toContain('if (generation !== authLifecycleGeneration) throw cause;');
});
