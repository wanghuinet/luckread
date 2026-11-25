import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../app/(drawer)/creator-studio.tsx', import.meta.url);

test('creator studio binds mutations to the active authenticated viewer', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /viewerRef\.current = viewerId/);
  assert.match(source, /useAuthStore\.getState\(\)\.status === 'authenticated'/);
  assert.match(source, /useAuthStore\.getState\(\)\.user\?\.id === owner/);
  for (const mutation of ['submitCreatorApplication(', 'updateMyCreatorPlan(', 'createMyCreatorPlan(', 'publishMyCreatorPlan(', 'changeMyCreatorPlanLifecycle(']) {
    const call = source.indexOf(mutation);
    assert.ok(call >= 0, mutation + ' must remain wired');
    const guard = source.lastIndexOf('isCurrentViewer(owner)', call);
    assert.ok(guard >= 0, mutation + ' must be protected by initiating account check');
  }
});

test('late creator mutation responses cannot update another account UI', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /if \(!isCurrentViewer\(owner\)\) return;/);
  assert.match(source, /finally \{ if \(isCurrentViewer\(owner\)\) setSaving\(false\); \}/);
  assert.match(source, /finally \{ if \(isCurrentViewer\(owner\)\) setBusyPlan\(null\); \}/);
});
