import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workflow = await readFile(new URL('../../.github/workflows/authz-l1-l2-live-e2e.yml', import.meta.url), 'utf8')

test('stale authz live E2E production D1 workflow remains disabled', () => {
  assert.ok(workflow.includes('if: ${{ false }}'), 'legacy D1 production job must be hard-disabled')
  assert.match(workflow, /Safety hold: legacy harness queries production Cloudflare D1/, 'safety rationale must remain explicit')
  assert.match(workflow, /wrangler d1 execute/, 'legacy D1 target must remain detectable')
})
