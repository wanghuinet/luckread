import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const workflow = readFileSync('.github/workflows/l8-genesis-bootstrap.yml', 'utf8')
const readinessSource = readFileSync('scripts/verify-admin-account-bootstrap-readiness.mjs', 'utf8')
const admissionStart = workflow.indexOf('  protected-main-admission:')
const bootstrapStart = workflow.indexOf('  bootstrap:')
const admissionJob = admissionStart >= 0 && bootstrapStart > admissionStart
  ? workflow.slice(admissionStart, bootstrapStart)
  : ''

describe('L8 genesis protected-main gate', () => {
  it('fails visibly before the Environment approval and production readiness/API calls when main is not protected', () => {
    const readinessIndex = workflow.indexOf('run: node scripts/verify-admin-account-bootstrap-readiness.mjs')
    const executorIndex = workflow.indexOf('run: node scripts/execute-l8-genesis-bootstrap.mjs')
    const environmentIndex = workflow.indexOf('environment: l8-genesis-bootstrap')

    assert.ok(admissionStart >= 0, 'standalone protected-main admission job must exist')
    assert.ok(bootstrapStart > admissionStart, 'bootstrap must be declared after admission')
    assert.ok(admissionJob.includes('DISPATCH_REF: ${{ github.ref }}'), 'preflight must inspect the actual dispatch ref')
    assert.ok(admissionJob.includes('REF_PROTECTED: ${{ github.ref_protected }}'), 'preflight must inspect GitHub protected-ref evidence')
    assert.ok(admissionJob.includes('if [[ "$DISPATCH_REF" != "refs/heads/main" ]]'), 'preflight must reject non-main dispatch')
    assert.ok(admissionJob.includes('if [[ "$REF_PROTECTED" != "true" ]]'), 'preflight must fail when main is not protected')
    assert.ok(!admissionJob.includes('environment:'), 'preflight must not request any protected Environment approval')
    assert.ok(workflow.slice(bootstrapStart).includes('needs: protected-main-admission'), 'bootstrap must depend on successful admission')
    assert.ok(workflow.includes("if: github.ref == 'refs/heads/main' && github.ref_protected == true"), 'bootstrap job must retain its protected-main condition')
    assert.ok(environmentIndex > bootstrapStart, 'L8 Environment approval must only belong to the guarded bootstrap job')
    assert.ok(readinessIndex > environmentIndex, 'readiness gate must run only after protected Environment approval')
    assert.ok(executorIndex > readinessIndex, 'bootstrap executor must run after the readiness gate')
    assert.ok(readinessSource.includes("genesisWorkflow.indexOf('  protected-main-admission:')"), 'readiness gate must validate the standalone protected-main preflight job')
    assert.ok(readinessSource.includes('REF_PROTECTED'), 'readiness gate must inspect GitHub protected-ref evidence')
    assert.ok(!readinessSource.includes('Fail closed when GitHub main is not protected'), 'readiness gate must not depend on the removed legacy guard step')
  })
})
