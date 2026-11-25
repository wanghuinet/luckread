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
  const present = source.indexOf('presentNativeMembershipPayment');
  const presentGuard = source.lastIndexOf('if (!isPurchaseViewerCurrent())', present);
  assert.ok(intentGuard >= 0 && intentGuard < intent, 'account must be checked before payment intent creation');
  assert.ok(presentGuard >= 0 && presentGuard < present, 'account must be checked before presenting payment');
});
