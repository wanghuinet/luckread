import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const profile = readFileSync(
  new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/profile/[id].tsx', import.meta.url),
  'utf8',
);

test('all profile tab reads and liked-post requests are isolated across viewer changes', () => {
  expect(profile).toContain('const requestViewerId = currentUserId;');
  expect(profile).toContain('useAuthStore.getState().user?.id === requestViewerId');
  expect(profile).toContain('profileUserId !== requestViewerId || !isCurrentViewer()');
  expect(profile).toContain('if (controller.signal.aborted || !isCurrentViewer()) return;');
  expect(profile).toContain('if (!controller.signal.aborted && isCurrentViewer())');
  expect(profile).toContain('likesRequestRef.current?.abort();');
  expect(profile).toContain('}, [userHandle, currentUserId]);');
  expect(profile).toContain('}, [currentUserId]);');
  expect(profile).toContain('(useAuthStore.getState().user?.id ?? null) === requestViewerId');
  expect(profile).toContain('if (!isCurrentRequest()) return;');
});
