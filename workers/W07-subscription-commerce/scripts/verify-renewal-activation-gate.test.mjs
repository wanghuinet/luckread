import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const wrangler = JSON.parse(read('workers/W07-subscription-commerce/wrangler.jsonc'));
const workerEntry = read('workers/W07-subscription-commerce/src/index.ts');

test('W07 cannot execute renewal scheduling before an admitted asynchronous path exists', () => {
  assert.equal(wrangler.name, 'luckread-w07');
  assert.equal(wrangler.main, 'src/index.ts');
  assert.equal(wrangler.triggers?.crons, undefined, 'renewal Cron must stay disabled until execution contract admission');
  assert.equal(wrangler.queues, undefined, 'no renewal Queue binding has been admitted for W07');
  assert.doesNotMatch(workerEntry, /scheduled\\s*\\(controller:\\s*ScheduledController/, 'W07 must not expose a live scheduled handler');
  assert.doesNotMatch(workerEntry, /runRenewalScheduledBatch/, 'scheduler must not be reachable from the deployed Worker entrypoint');
});

test('Cron-only deployment workflow is absent while the renewal execution contract is unresolved', () => {
  assert.equal(
    existsSync('.github/workflows/w07-subscription-cron-only-deploy.yml'),
    false,
    'a standalone Cron deployment workflow must not activate the unadmitted direct-W07 scheduler',
  );
});
