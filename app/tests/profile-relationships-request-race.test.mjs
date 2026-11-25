import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/profile/relationships/[id].tsx', import.meta.url), 'utf8');

test('relationship page aborts and ignores stale requests when route changes or unmounts', () => {
  expect(screen).toContain('const requestId = ++requestIdRef.current');
  expect(screen).toContain('const isCurrent = () => requestId === requestIdRef.current && !controller.signal.aborted');
  expect(screen).toContain('cursor: nextCursor, signal: controller.signal');
  expect(screen).toContain('resolvePublicProfileById(relation.userId, controller.signal)');
  expect(screen).toContain('abortRef.current?.abort()');
  expect(screen).toContain('requestIdRef.current += 1');
});
