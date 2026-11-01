import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const w07 = JSON.parse(read('workers/W07-subscription-commerce/wrangler.jsonc'));
const w10 = JSON.parse(read('workers/W10-async/wrangler.jsonc'));
const w07Entry = read('workers/W07-subscription-commerce/src/index.ts');
const w10Entry = read('workers/W10-async/src/index.ts');
const workflowRuntime = read('workers/W10-async/src/membership-renewal-workflow-runtime.ts');

test('renewal scheduling runs only through the existing W10 durable Workflow', () => {
  assert.equal(w07.name, 'luckread-w07');
  assert.equal(w07.main, 'src/index.ts');
  assert.equal(w07.triggers?.crons, undefined, 'W07 must not own a direct Cron trigger');
  assert.equal(w07.queues, undefined, 'W07 must not bind a new or unrelated Queue');
  assert.equal(w07.vars?.MEMBERSHIP_RENEWAL_ENABLED, 'false', 'W07 activation must default off');
  assert.doesNotMatch(w07Entry, /scheduled\\s*\\(controller:\\s*ScheduledController/, 'W07 must not expose a scheduled handler');
  assert.match(w07Entry, /internal\\/renewals\\/w10\\/scheduled-batch/);
  assert.match(w07Entry, /requireTransport\\(request, 'W10'\\)/);
  assert.match(w07Entry, /MEMBERSHIP_RENEWAL_ENABLED !== 'true'/);
  assert.match(w07Entry, /runRenewalScheduledBatch\\(env/);

  assert.equal(w10.name, 'luckread-w10', 'reuse the already-provisioned W10 Worker');
  assert.equal(w10.queues, undefined, 'the Workflow path must not create or reuse a Queue');
  assert.equal(w10.vars?.MEMBERSHIP_RENEWAL_ENABLED, 'false', 'W10 activation must default off');
  assert.equal(w10.services?.some((binding) =>
    binding.binding === 'W07_COMMERCE' && binding.service === 'luckread-w07'), true);
  assert.equal(w10.workflows?.length, 1);
  assert.equal(w10.workflows?.[0]?.class_name, 'MembershipRenewalWorkflow');
  assert.deepEqual(w10.workflows?.[0]?.schedules, ['* * * * *']);
  assert.match(w10Entry, /MembershipRenewalWorkflow/);
  assert.match(workflowRuntime, /backoff: 'exponential'/);
  assert.match(workflowRuntime, /limit: 3/);
});

test('W07 internal renewal entrypoint remains non-public and sandbox/demo-only', () => {
  assert.equal(w07.workers_dev, false);
  assert.match(w07Entry, /HYPERSWITCH_ENVIRONMENT/);
  assert.match(w07Entry, /isDemoPricingEnabled\\(env.COMMERCE_PRICING_MODE, env.HYPERSWITCH_ENVIRONMENT\\)/);
  assert.match(w07Entry, /taxjar-sandbox/);
  assert.match(w07Entry, /synthetic/);
  assert.match(workflowRuntime, /https:\\/\\/luckread-w07\\.internal\\/internal\\/renewals\\/w10\\/scheduled-batch/);
});

test('no direct-W07 Cron deployment workflow is allowed', () => {
  assert.equal(
    existsSync('.github/workflows/w07-subscription-cron-only-deploy.yml'),
    false,
    'renewal schedule belongs to W10 Workflows, never a direct-W07 Cron deployment',
  );
});
