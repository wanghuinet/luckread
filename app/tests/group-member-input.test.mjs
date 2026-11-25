import { expect, test } from 'bun:test';
import { parseGroupMemberIds } from '../lib/group-member-input.ts';

test('parses group member IDs separated by spaces, tabs, and newlines', () => {
  expect(parseGroupMemberIds('user-a user-b\\tuser-c\\nuser-d\\r\\nuser-e')).toEqual([
    'user-a',
    'user-b',
    'user-c',
    'user-d',
    'user-e',
  ]);
});

test('parses comma and semicolon separated IDs, including mixed separators', () => {
  expect(parseGroupMemberIds('user-a,user-b; user-c\\nuser-d;')).toEqual([
    'user-a',
    'user-b',
    'user-c',
    'user-d',
  ]);
});

test('ignores leading, trailing, and repeated separators without changing ID order', () => {
  expect(parseGroupMemberIds('  user-a,,; user-b  user-c ')).toEqual([
    'user-a',
    'user-b',
    'user-c',
  ]);
});

test('returns an empty list for blank input', () => {
  expect(parseGroupMemberIds('  ,;\\n\\t')).toEqual([]);
});
