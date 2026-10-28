import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const wrangler = JSON.parse(read('workers/W07-subscription-commerce/wrangler.jsonc'));
const workerEntry = read('workers/W07-subscription-commerce/src/index.ts');
const deployWorkflow = read('.github/workflows/w07-subscription-cron-only-deploy.yml');

test('W07 declares the reviewed bounded five-minute Cron and scheduled handler', () => {
  assert.equal(wrangler.name, 'luckread-w07');
  assert.equal(wrangler.main, 'src/index.ts');
  assert.deepEqual(wrangler.triggers?.crons, ['*/5 * * * *']);
  assert.match(workerEntry, /scheduled\s*\(controller:\s*ScheduledController/);
  assert.match(workerEntry, /runRenewalScheduledBatch\(env\)/);
});

test('Cron-only deployment requires explicit approval and exact current main HEAD', () => {
  assert.match(deployWorkflow, /workflow_dispatch:/);
  assert.match(deployWorkflow, /inputs\.confirm\s*==\s*'DEPLOY_W07_CRON_ONLY'/);
  assert.match(deployWorkflow, /git rev-parse origin\/main/);
  assert.match(deployWorkflow, /SOURCE_SHA"\s*!=\s*"\$MAIN_SHA"/);
  assert.doesNotMatch(deployWorkflow, /git merge-base --is-ancestor/);
  assert.match(deployWorkflow, /npx --yes wrangler@4\.116\.0 deploy --config wrangler\.jsonc/);
});

test('Cron-only deployment cannot apply D1 migrations or execute remote SQL', () => {
  const executableWorkflow = deployWorkflow
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  assert.doesNotMatch(executableWorkflow, /wrangler(?:@[^\s]+)?\s+d1\s+migrations\s+apply\b/i);
  assert.doesNotMatch(executableWorkflow, /wrangler(?:@[^\s]+)?\s+d1\s+execute\b/i);
});

test('deployed Cron schedule is read back from Cloudflare and compared exactly', () => {
  assert.match(deployWorkflow, /\/workers\/scripts\/luckread-w07\/schedules/);
  assert.match(deployWorkflow, /body\.result\?\.schedules/);
  assert.match(deployWorkflow, /crons\[0\]\s*!==\s*'\*\/5 \* \* \* \*'/);
  assert.match(deployWorkflow, /Authorization:\s*`Bearer \$\{token\}`/);
});

test('Cron-only D1-04 preflight uses a checked, persisted inventory file', () => {
  const preflight = deployWorkflow.match(
    /- name: Verify D1-04 physical binding against Cloudflare([\s\S]*?)(?=\n      - name: Deploy W07 worker and Cron config only)/,
  )?.[1];

  assert.ok(preflight, 'D1-04 read-only preflight step must exist');
  assert.match(preflight, /run:\s*\|\s*\n\s+set -euo pipefail/);
  assert.match(preflight, /wrangler@4\.116\.0 d1 list --json --config wrangler\.jsonc > \/tmp\/w07-d1-list\.json/);
  assert.match(preflight, /node scripts\/verify-d1-04-binding\.mjs \/tmp\/w07-d1-list\.json/);
  assert.doesNotMatch(preflight, /<\(/, 'preflight must not contain a malformed process substitution');
});
