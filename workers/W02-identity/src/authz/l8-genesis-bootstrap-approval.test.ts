import { describe, expect, it } from 'vitest'
import { verifyTargetBoundSingleApproval } from './l8-genesis-bootstrap-approval.js'

const encodeBase64Url = (value: string | Uint8Array): string => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const base64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function issueTestOidcToken(now: Date) {
  const keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey) as JsonWebKey & { kid?: string; use?: string; alg?: string }
  jwk.kid = 'test-key'
  jwk.use = 'sig'
  jwk.alg = 'RS256'
  const seconds = Math.floor(now.getTime() / 1000)
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }))
  const payload = encodeBase64Url(JSON.stringify({
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'luckread-w02-l8-bootstrap',
    iat: seconds - 5,
    nbf: seconds - 5,
    exp: seconds + 240,
    repository: 'wanghuinet/luckread',
    repository_owner: 'wanghuinet',
    ref: 'refs/heads/main',
    ref_type: 'branch',
    event_name: 'workflow_dispatch',
    workflow_ref: 'wanghuinet/luckread/.github/workflows/l8-genesis-bootstrap.yml@refs/heads/main',
    environment: 'l8-genesis-bootstrap',
    ref_protected: 'true',
    run_id: '12345678',
  }))
  const unsigned = header + '.' + payload
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keys.privateKey,
    new TextEncoder().encode(unsigned),
  )
  return { token: unsigned + '.' + encodeBase64Url(new Uint8Array(signature)), jwk }
}

type EnvironmentPayload = Record<string, unknown>

function githubFetcher(input: {
  now: Date
  jwk: JsonWebKey
  permissions?: { permission?: string; role_name?: string }
  files?: Array<Record<string, unknown>>
  environment?: EnvironmentPayload
  requestOverrides?: Record<string, unknown>
}) {
  const nowMs = input.now.getTime()
  const headSha = 'a'.repeat(40)
  const mergeSha = 'b'.repeat(40)
  const request = {
    version: 1,
    operation: 'INITIAL_L8_BOOTSTRAP',
    targetUserId: 'existing-user-123',
    roleId: 'super_admin',
    scopeType: 'global',
    scopeId: null,
    reason: 'First L8 grant under approved change-control request',
    nonce: 'c'.repeat(64),
    createdAt: new Date(nowMs - 10 * 60_000).toISOString(),
    expiresAt: new Date(nowMs + 60 * 60_000).toISOString(),
    ...(input.requestOverrides ?? {}),
  }
  const pull = {
    number: 77,
    state: 'closed',
    merged_at: new Date(nowMs - 60_000).toISOString(),
    merge_commit_sha: mergeSha,
    created_at: new Date(nowMs - 9 * 60_000).toISOString(),
    base: { ref: 'main', repo: { full_name: 'wanghuinet/luckread' } },
    head: { sha: headSha },
    user: { login: 'request-author' },
  }
  const environment = input.environment ?? {
    name: 'l8-genesis-bootstrap',
    protection_rules: [{
      type: 'required_reviewers',
      prevent_self_review: false,
      reviewers: [{
        type: 'User',
        reviewer: { id: 190754094, login: 'wanghuinet' },
      }],
    }],
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
  }
  const permissions = input.permissions ?? { permission: 'admin' }

  const fetcher: typeof fetch = async (requestUrl) => {
    const url = new URL(String(requestUrl))
    if (url.href === 'https://token.actions.githubusercontent.com/.well-known/jwks') {
      return Response.json({ keys: [input.jwk] })
    }
    if (url.pathname === '/repos/wanghuinet/luckread/environments/l8-genesis-bootstrap') {
      return Response.json(environment)
    }
    if (url.pathname === '/repos/wanghuinet/luckread/collaborators/wanghuinet/permission') {
      return permissions.permission || permissions.role_name
        ? Response.json(permissions)
        : new Response('{}', { status: 404 })
    }
    if (url.pathname === '/repos/wanghuinet/luckread/pulls/77') return Response.json(pull)
    if (url.pathname === '/repos/wanghuinet/luckread/pulls/77/files') {
      return Response.json(input.files ?? [{ filename: 'docs/change-control/l8-genesis-bootstrap-request.json' }])
    }
    if (url.pathname === '/repos/wanghuinet/luckread/contents/docs/change-control/l8-genesis-bootstrap-request.json') {
      return Response.json({ encoding: 'base64', content: btoa(JSON.stringify(request)) })
    }
    return new Response('unexpected test URL', { status: 500 })
  }

  return { fetcher, pull, request, headSha, mergeSha }
}

const callVerifier = (token: string, fetcher: typeof fetch, now: Date) =>
  verifyTargetBoundSingleApproval({
    oidcToken: token,
    githubToken: 'ghs_' + 'x'.repeat(40),
    requestPrNumber: 77,
    now,
    fetcher,
  })

describe('W02 L8 target-bound single environment approval verifier', () => {
  it('accepts one configured human admin approval on a protected GitHub environment', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({ now, jwk: signed.jwk })
    const result = await callVerifier(signed.token, github.fetcher, now)

    expect(result).toMatchObject({
      request: { targetUserId: 'existing-user-123', roleId: 'super_admin', operation: 'INITIAL_L8_BOOTSTRAP' },
      requestPrNumber: 77,
      requestHeadSha: github.headSha,
      requestMergeSha: github.mergeSha,
      approvedReviewers: ['wanghuinet'],
      reviewerPermissions: { wanghuinet: 'admin' },
      workflowRunId: '12345678',
    })
  })

  it('fails closed when the GitHub environment does not require a human approval', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({
      now,
      jwk: signed.jwk,
      environment: {
        name: 'l8-genesis-bootstrap',
        protection_rules: [],
        deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
      },
    })
    await expect(callVerifier(signed.token, github.fetcher, now))
      .rejects.toMatchObject({ code: 'SINGLE_APPROVAL_ENVIRONMENT_NOT_CONFIGURED' })
  })

  it('rejects a different administrator as the genesis approver when the repository owner is the sole configured maintainer', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({
      now,
      jwk: signed.jwk,
      environment: {
        name: 'l8-genesis-bootstrap',
        protection_rules: [{
          type: 'required_reviewers',
          prevent_self_review: false,
          reviewers: [{ type: 'User', reviewer: { id: 987654321, login: 'another-admin' } }],
        }],
        deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
      },
    })
    await expect(callVerifier(signed.token, github.fetcher, now))
      .rejects.toMatchObject({ code: 'SINGLE_APPROVAL_ENVIRONMENT_NOT_CONFIGURED' })
  })

  it('rejects an environment with multiple required reviewers because the initial path is single-approver by design', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({
      now,
      jwk: signed.jwk,
      environment: {
        name: 'l8-genesis-bootstrap',
        protection_rules: [{
          type: 'required_reviewers',
          prevent_self_review: false,
          reviewers: [
            { type: 'User', reviewer: { id: 190754094, login: 'wanghuinet' } },
            { type: 'User', reviewer: { id: 987654321, login: 'another-user' } },
          ],
        }],
        deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
      },
    })
    await expect(callVerifier(signed.token, github.fetcher, now))
      .rejects.toMatchObject({ code: 'SINGLE_APPROVAL_ENVIRONMENT_NOT_CONFIGURED' })
  })

  it('rejects an environment reviewer without admin or maintain permission', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({ now, jwk: signed.jwk, permissions: { permission: 'read' } })
    await expect(callVerifier(signed.token, github.fetcher, now))
      .rejects.toMatchObject({ code: 'SINGLE_APPROVAL_ENVIRONMENT_NOT_CONFIGURED' })
  })

  it('accepts a repository maintainer using GitHub role_name even though legacy permission is write', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({ now, jwk: signed.jwk, permissions: { permission: 'write', role_name: 'maintain' } })
    const result = await callVerifier(signed.token, github.fetcher, now)
    expect(result.reviewerPermissions).toEqual({ wanghuinet: 'maintain' })
  })


  it('rejects unprotected deployment branches even when a reviewer is configured', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({
      now,
      jwk: signed.jwk,
      environment: {
        name: 'l8-genesis-bootstrap',
        protection_rules: [{
          type: 'required_reviewers',
          prevent_self_review: false,
          reviewers: [{ type: 'User', reviewer: { id: 190754094, login: 'wanghuinet' } }],
        }],
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      },
    })
    await expect(callVerifier(signed.token, github.fetcher, now))
      .rejects.toMatchObject({ code: 'SINGLE_APPROVAL_ENVIRONMENT_NOT_CONFIGURED' })
  })

  it('rejects request PRs that bundle unrelated code changes with the bootstrap request', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({
      now,
      jwk: signed.jwk,
      files: [
        { filename: 'docs/change-control/l8-genesis-bootstrap-request.json' },
        { filename: 'workers/W02-identity/src/index.ts' },
      ],
    })
    await expect(callVerifier(signed.token, github.fetcher, now))
      .rejects.toMatchObject({ code: 'REQUEST_PR_SCOPE_INVALID' })
  })

  it('rejects malformed workflow tokens before consulting GitHub approval evidence', async () => {
    const fetcher: typeof fetch = async () => { throw new Error('GitHub should not be contacted') }
    await expect(callVerifier('not.a.valid.jwt', fetcher, new Date('2026-10-24T12:00:00.000Z')))
      .rejects.toMatchObject({ code: 'OIDC_INVALID' })
  })

  it('rejects requests with invalid expiry', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({
      now,
      jwk: signed.jwk,
      requestOverrides: { expiresAt: new Date(now.getTime() - 1).toISOString() },
    })
    await expect(callVerifier(signed.token, github.fetcher, now))
      .rejects.toMatchObject({ code: 'REQUEST_EXPIRED_OR_INVALID' })
  })
})
