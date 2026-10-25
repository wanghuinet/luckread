import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const workflowPaths = [
  '.github/workflows/auth-mfa-rollout-preflight.yml',
  '.github/workflows/w02-deploy.yml',
  '.github/workflows/w01-payload-app-deploy.yml',
  '.github/workflows/w01-w02-binding-deploy.yml',
  '.github/workflows/w02-role-assignment-migration.yml',
  '.github/workflows/w06-deploy.yml',
]
const protectedMutationWorkflowPaths = [
  '.github/workflows/w02-deploy.yml',
  '.github/workflows/w01-payload-app-deploy.yml',
  '.github/workflows/w01-w02-binding-deploy.yml',
  '.github/workflows/w02-role-assignment-migration.yml',
  '.github/workflows/w06-deploy.yml',
]
const verifier = readFileSync('scripts/verify-auth-007-rollout-admission.mjs', 'utf8')

describe('AUTH-007 protected-ref admission contract', () => {
  it('passes GitHub protected-ref status into every rollout and migration workflow', () => {
    for (const path of workflowPaths) {
      const workflow = readFileSync(path, 'utf8')
      assert.match(
        workflow,
        /GITHUB_REF_PROTECTED:\s*\$\{\{\s*github\.ref_protected\s*\}\}/,
        path + ' must pass github.ref_protected to the admission verifier',
      )
    }
  })

  it('fails closed when the protected-ref value is missing or false', () => {
    assert.match(verifier, /const refProtected = process\.env\.GITHUB_REF_PROTECTED \?\? ''/)
    assert.match(verifier, /refProtected !== 'true'/)
  })

  it('includes every rollout call site in the verifier source checks', () => {
    for (const path of workflowPaths) assert.ok(verifier.includes(path), path + ' is not registered')
    assert.match(verifier, /allRolloutWorkflowCallSitesRequireProtectedMain:\s*protectedRefCallSitesConfigured/)
    assert.match(verifier, /allMutationWorkflowJobsRequireProtectedMain:\s*protectedMutationWorkflowJobsConfigured/)
  })

  it('blocks every production deployment/migration job before Environment approval on an unprotected ref', () => {
    for (const path of protectedMutationWorkflowPaths) {
      const workflow = readFileSync(path, 'utf8')
      assert.match(
        workflow,
        /^\s+if:\s*\$\{\{[^\n]*github\.ref_protected\s*==\s*true[^\n]*\}\}$/m,
        path + ' must require protected main in the job-level condition',
      )
    }
  })

  it('gates W06 deployment with AUTH-007 environment admission before Wrangler deploy', () => {
    const workflow = readFileSync('.github/workflows/w06-deploy.yml', 'utf8')
    assert.match(workflow, /environment:\s*auth-mfa-rollout/)
    assert.match(workflow, /GITHUB_REF_PROTECTED:\s*\$\{\{\s*github\.ref_protected\s*\}\}/)
    const admission = workflow.indexOf('run: node scripts/verify-auth-007-rollout-admission.mjs')
    const deploy = workflow.indexOf('run: npx --yes wrangler@4.116.0 deploy --config wrangler.jsonc')
    assert.ok(admission >= 0 && deploy > admission, 'AUTH-007 admission must run before W06 deployment')
  })
 
  it('accepts exactly the two named mutual approvers with least-privilege role checks', () => {
    assert.match(verifier, /const expectedReviewerLogins = \['wanghuinet', 'luckread'\]/)
    assert.match(verifier, /reviewers\.length === expectedReviewerLogins\.length/)
    assert.match(verifier, /new Set\(reviewerLogins\)\.size === expectedReviewerLogins\.length/)
    assert.match(verifier, /wanghuinetReviewer\?\.reviewer\?\.id === expectedReviewerId/)
    assert.match(verifier, /githubGet\('\/users\/luckread', token\)/)
    assert.match(verifier, /luckreadReviewer\?\.reviewer\?\.id !== luckreadProfile\.id/)
    assert.match(verifier, /for \(const reviewerLogin of expectedReviewerLogins\)/)
    assert.match(verifier, /reviewerLogin === 'wanghuinet'/)
    assert.match(verifier, /reviewerRole !== 'admin' && reviewerRole !== 'maintain'/)
    assert.match(verifier, /hasRepositoryReadAccess/)
    assert.match(verifier, /roleName === 'maintain'/)
  })

  it('identifies the failing GitHub API endpoint in read-only preflight diagnostics', () => {
    assert.match(verifier, /rollout configuration endpoint ' \+ apiPath \+ ' failed \(HTTP '/)
  })

})
