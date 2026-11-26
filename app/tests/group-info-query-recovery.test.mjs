import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../app/(drawer)/(tabs)/(messages)/messages/group-info.tsx', import.meta.url), 'utf8');

test('shows a recoverable error state when group members cannot be loaded', () => {
  expect(screen).toContain('members.isError');
  expect(screen).toContain('无法加载群聊成员');
  expect(screen).toContain('重试加载群聊成员');
  expect(screen).toContain('void members.refetch()');
});

test('lets group owners retry failed following and candidate profile queries', () => {
  expect(screen).toContain('following.isError || candidates.isError');
  expect(screen).toContain('重试加载关注列表');
  expect(screen).toContain('void following.refetch()');
  expect(screen).toContain('void candidates.refetch()');
});


test('group membership destructive operations propagate HTTP failures to UI mutations', () => {
  const api = readFileSync(new URL('../lib/messaging-api.ts', import.meta.url), 'utf8');
  for (const name of ['removeGroupMember', 'transferGroupOwnership', 'leaveGroupConversation']) {
    const start = api.indexOf('export async function ' + name);
    const end = api.indexOf('\n}', start);
    const implementation = api.slice(start, end);
    expect(implementation).toContain('if (!result.response.ok)');
    expect(implementation).toContain('throw new Error');
  }
});
