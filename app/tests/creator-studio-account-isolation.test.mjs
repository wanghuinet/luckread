import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../app/(drawer)/creator-studio.tsx', import.meta.url);

test('creator studio binds mutations to the active authenticated viewer', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /viewerRef\.current = viewerId/);
  assert.match(source, /useAuthStore\.getState\(\)\.status === 'authenticated'/);
  assert.match(source, /useAuthStore\.getState\(\)\.user\?\.id === owner/);
  const submit = source.slice(source.indexOf('const submitApplication'));
  const save = source.slice(source.indexOf('const savePlan'));
  const action = source.slice(source.indexOf('const planAction'));
  for (const [section, mutation] of [
    [submit, 'submitCreatorApplication('],
    [save, 'updateMyCreatorPlan('],
    [save, 'createMyCreatorPlan('],
    [action, 'publishMyCreatorPlan('],
    [action, 'changeMyCreatorPlanLifecycle('],
  ]) {
    const call = section.indexOf(mutation);
    assert.ok(call >= 0, mutation + ' must remain wired');
    const guard = section.lastIndexOf('isCurrentViewer(owner)', call);
    assert.ok(guard >= 0, mutation + ' must be protected by initiating account check');
  }
});

test('late creator mutation responses cannot update another account UI', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /if \(!isCurrentViewer\(owner\)\) return;/);
  assert.match(source, /finally \{ if \(isCurrentViewer\(owner\)\) setSaving\(false\); \}/);
  assert.match(source, /finally \{ if \(isCurrentViewer\(owner\)\) setBusyPlan\(null\); \}/);
});


test('creator studio binds every authenticated read and write to its initiating account', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /fetchMyCreatorApplication\(\{ expectedAccountId: owner \}\)/);
  assert.match(source, /fetchMyCreatorPlans\(\{ limit: 50, expectedAccountId: owner \}\)/);
  assert.match(source, /submitCreatorApplication\(creatorType, statement\.trim\(\), makeKey\('creator_apply'\), owner\)/);
  assert.match(source, /updateMyCreatorPlan\(editing\.planId, editing\.etag, terms, makeKey\('plan_update'\), owner\)/);
  assert.match(source, /createMyCreatorPlan\(terms, makeKey\('plan_create'\), owner\)/);
  assert.match(source, /publishMyCreatorPlan\(p\.planId, p\.etag, owner\)/);
  assert.match(source, /changeMyCreatorPlanLifecycle\(p\.planId, p\.etag, action, owner\)/);
});


test('creator studio hides prior account data and resets its editor when the viewer changes', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /const previousViewerIdRef = useRef<string \| null>\(viewerId\)/);
  assert.match(source, /setApplication\(null\);\s*setPlans\(\[\]\);\s*setLoadedViewerId\(null\)/);
  assert.match(source, /setEditing\(null\);\s*setCreatorType\('PERSONAL'\);\s*setStatement\(''\)/);
  assert.match(source, /const currentViewerDataReady = loadedViewerId === viewerId/);
  assert.match(source, /const visibleApplication = currentViewerDataReady \? application : null/);
  assert.match(source, /const visiblePlans = currentViewerDataReady \? plans : \[\]/);
  assert.doesNotMatch(source.slice(source.indexOf('const currentViewerDataReady')), /\{application\?\.status/);
});
