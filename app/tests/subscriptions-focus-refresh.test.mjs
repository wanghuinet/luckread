import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../app/(drawer)/subscriptions.tsx', import.meta.url), 'utf8');

test('refreshes authoritative subscriptions and saved payment methods whenever the screen regains focus', () => {
  expect(screen).toContain("import { useFocusEffect, useRouter } from 'expo-router';");
  const focusStart = screen.indexOf('useFocusEffect(useCallback(() =>');
  const focusEnd = screen.indexOf('}, [authStatus, loadPage, loadPaymentMethods, viewerId]));', focusStart);
  expect(focusStart).toBeGreaterThanOrEqual(0);
  expect(focusEnd).toBeGreaterThan(focusStart);
  const focusEffect = screen.slice(focusStart, focusEnd);
  expect(focusEffect).toContain('void loadPage(1, false);');
  expect(focusEffect).toContain('void loadPaymentMethods();');
  expect(focusEffect).toContain('requestRef.current?.abort();');
  expect(focusEffect).toContain('paymentMethodRequestRef.current?.abort();');
});
