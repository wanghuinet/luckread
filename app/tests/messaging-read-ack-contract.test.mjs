import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('read receipt API rejects non-success HTTP responses so retry logic can run', () => {
  const source = readFileSync(new URL('../lib/messaging-api.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function markConversationRead');
  const end = source.indexOf('\n}\n', start);
  const implementation = source.slice(start, end);
  expect(implementation).toContain('if (!result.response.ok)');
  expect(implementation).toContain('throw new Error');
});
