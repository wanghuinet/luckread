import { expect, test } from 'bun:test';
import { findActiveComposerToken, replaceActiveComposerToken } from '../lib/publish-composer-tokens.ts';

test('finds an unfinished mention or topic at the caret, including Unicode text', () => {
  expect(findActiveComposerToken('Hello @ali', 11)).toMatchObject({ kind: 'mention', prefix: '@', query: 'ali', start: 6, end: 11 });
  expect(findActiveComposerToken('话题 #读书', 6)).toMatchObject({ kind: 'topic', prefix: '#', query: '读书', start: 3, end: 6 });
  expect(findActiveComposerToken('email@host.com', 14)).toBeNull();
  expect(findActiveComposerToken('A #topic already-complete', 25)).toBeNull();
});

test('replaces only the active token and returns the next caret position', () => {
  const token = findActiveComposerToken('before @ali after', 11);
  expect(token).not.toBeNull();
  const replaced = replaceActiveComposerToken('before @ali after', token!, 'alice');
  expect(replaced.text).toBe('before @alice  after');
  expect(replaced.selection).toEqual({ start: 14, end: 14 });
});

test('rejects invalid replacement values', () => {
  const token = findActiveComposerToken('#topic', 6)!;
  expect(() => replaceActiveComposerToken('#topic', token, 'two words')).toThrow('A single token value is required.');
});
