import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { moveComposerAsset } from '../lib/publish-composer-assets.ts';

const composer = readFileSync(new URL('../app/publish.tsx', import.meta.url), 'utf8');

test('moves one attachment earlier without mutating the original order', () => {
  const original = ['photo-a', 'video-b', 'photo-c'];
  expect(moveComposerAsset(original, 1, -1)).toEqual(['video-b', 'photo-a', 'photo-c']);
  expect(original).toEqual(['photo-a', 'video-b', 'photo-c']);
});

test('moves one attachment later while preserving every other attachment', () => {
  expect(moveComposerAsset(['photo-a', 'video-b', 'photo-c'], 1, 1))
    .toEqual(['photo-a', 'photo-c', 'video-b']);
});

test('keeps first and last attachments in bounds and ignores invalid indexes', () => {
  const original = ['photo-a', 'video-b', 'photo-c'];
  expect(moveComposerAsset(original, 0, -1)).toEqual(original);
  expect(moveComposerAsset(original, 2, 1)).toEqual(original);
  expect(moveComposerAsset(original, -1, 1)).toEqual(original);
  expect(moveComposerAsset(original, 3, -1)).toEqual(original);
  expect(moveComposerAsset(original, 1.5, 1)).toEqual(original);
});

test('native media tiles expose accessible earlier/later controls alongside drag sorting', () => {
  expect(composer).toContain('accessibilityLabel="Move attachment earlier"');
  expect(composer).toContain('accessibilityLabel="Move attachment later"');
  expect(composer).toContain('onPress={() => moveAsset(asset.localId, -1)}');
  expect(composer).toContain('onPress={() => moveAsset(asset.localId, 1)}');
  expect(composer).toContain('index === 0');
  expect(composer).toContain('index === assets.length - 1');
  expect(composer).toContain('<Sortable.Grid');
  expect(composer).toContain('onDragEnd={({ data }) => setAssets(data)}');
  expect(composer).toContain('const mediaRefs = Array.from(new Set(assets.map((asset) => asset.serverUrl)))');
});
