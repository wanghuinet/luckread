import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const drawer = readFileSync(new URL('../app/(drawer)/_layout.tsx', import.meta.url), 'utf8');
const rootLayout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const login = readFileSync(new URL('../app/login.tsx', import.meta.url), 'utf8');

test('drawer lists saved accounts and exposes separate switch and remove actions', () => {
  expect(drawer).toContain("state) => state.accounts");
  expect(drawer).toContain("state) => state.switchAccount");
  expect(drawer).toContain("state) => state.removeAccount");
  expect(drawer).toContain('accounts.map((account, index) =>');
  expect(drawer).toContain('handleSwitchAccount(account.id)');
  expect(drawer).toContain('handleRemoveAccount(account.id)');
  expect(drawer).toContain("accessibilityLabel={'从设备移除 ' + account.email}");
  expect(drawer).toContain('退出当前账号');
  expect(drawer).toContain('MAX_STORED_ACCOUNTS');
  expect(drawer).not.toContain('SessionToken');
});

test('removing the active account switches to a remaining saved account before deletion', () => {
  const removeHandler = drawer.slice(
    drawer.indexOf('const handleRemoveAccount'),
    drawer.indexOf('const displayName'),
  );
  expect(removeHandler).toContain('const nextAccount = isActiveAccount');
  expect(removeHandler).toContain('await switchAccount(nextAccount.id)');
  expect(removeHandler).toContain('await removeAccount(accountId)');
});

test('adding another account opens a login mode that is not redirected away', () => {
  expect(drawer).toContain("'/login?addAccount=1'");
  expect(rootLayout).toContain('useGlobalSearchParams<{ addAccount?: string; returnTo?: string | string[] }>()');
  expect(rootLayout).toContain("segments[0] === 'login' && searchParams.addAccount === '1'");
  expect(rootLayout).toContain('!isAddingAccount');
  expect(login).toContain("params.addAccount === '1'");
  expect(login).toContain('登录其他账号');
  expect(login).toContain('添加并切换到此账号');
});
