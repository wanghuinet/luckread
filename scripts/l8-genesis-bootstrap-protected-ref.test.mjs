import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const workflow = readFileSync('.github/workflows/l8-genesis-bootstrap.yml', 'utf8')

describe('L8 genesis protected-main gate', () => {
  it('fails before readiness/API calls when GitHub does not report main protected', () => {
    const guardIndex = workflow.indexOf('name: Fail closed when GitHub main is not protected')
    const readinessIndex = workflow.indexOf('run: node scripts/verify-admin-account-bootstrap-readiness.mjs')
    const executorIndex = workflow.indexOf('run: node scripts/execute-l8-genesis-bootstrap.mjs')

    assert.ok(guardIndex >= 0, 'protected-main guard step must exist')
    assert.ok(workflow.includes("if: github.ref == 'refs/heads/main' && github.ref_protected == true"), 'job must be skipped before Environment approval if main is not protected')
    assert.ok(workflow.includes('if: ${{ github.ref_protected != true }}'), 'missing/falsy protected-ref guard condition must fail')
    assert.ok(readinessIndex > guardIndex, 'readiness gate must run after the protected-main guard')
    assert.ok(executorIndex > guardIndex, 'bootstrap executor must run after the protected-main guard')
  })
})
