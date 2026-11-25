import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenPath = new URL('../app/(drawer)/membership-plans.tsx', import.meta.url);

test('membership purchase is bound to the account that initiated it', async () => {
  const source = await readFile(screenPath, 'utf8');
  assert.match(source, /const purchaseViewerId = useAuthStore\.getState\(\)\.user\?\.id/);
  assert.match(source, /current\.status === 'authenticated' && current\.user\?\.id === purchaseViewerId/);
  assert.match(source, /if \(!isPurchaseViewerCurrent\(\)\) \{[\s\S]{0,180}账号已切换/);
});

test('account identity is rechecked before creating a payment intent and opening native payment', async () => {
  const source = await readFile(screenPath, 'utf8');
  const intent = source.indexOf('const intentResult = await createMembershipPaymentIntent');
  const intentGuard = source.lastIndexOf('if (!isPurchaseViewerCurrent())', intent);
  const present = source.indexOf('const result = await presentNativeMembershipPayment');
  const presentGuard = source.lastIndexOf('if (!isPurchaseViewerCurrent())', present);
  assert.ok(intentGuard >= 0 && intentGuard < intent, 'account must be checked before payment intent creation');
  assert.ok(presentGuard >= 0 && presentGuard < present, 'account must be checked before presenting payment');
});


test('order and payment-intent creation bind credentials to the initiating account', async () => {
  const screen = await readFile(screenPath, 'utf8');
  const apiPath = new URL('../app/lib/subscriptions-api.ts', import.meta.url);
  const api = await readFile(apiPath, 'utf8');
  assert.match(api, /createMembershipOrder\(planId: string, options: \{ expectedAccountId\?: string \} = \{\}\)/);
  assert.match(api, /expectedAccountId: options\.expectedAccountId/);
  assert.match(screen, /createMembershipOrder\(item\.planId, \{ expectedAccountId: purchaseViewerId \}\)/);
  assert.match(screen, /createMembershipPaymentIntent\(orderData\.orderId, \{ expectedAccountId: purchaseViewerId \}\)/);
  const order = screen.indexOf('const orderResult = await createMembershipOrder');
  assert.ok(screen.lastIndexOf('if (!isPurchaseViewerCurrent()) return;', order) >= 0,
    'account must be checked immediately before order creation');
});

test('stale purchase completion cannot overwrite the newly active account UI', async () => {
  const source = await readFile(screenPath, 'utf8');
  assert.match(source, /if \(isPurchaseViewerCurrent\(\)\) \{\s*setPurchaseMessage/);
  assert.match(source, /finally \{\s*if \(isPurchaseViewerCurrent\(\)\) setBusyPlanId\(null\);/);
  assert.match(source, /previousViewerIdRef\.current !== viewerId[\s\S]{0,180}setBusyPlanId\(null\)/);
});
