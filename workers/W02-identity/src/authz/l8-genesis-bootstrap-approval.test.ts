import { describe, expect, it } from 'vitest'
import { verifyTargetBoundDualApproval } from './l8-genesis-bootstrap-approval.js'

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

function githubFetcher(input: {
  now: Date
  jwk: JsonWebKey
  reviews?: Array<Record<string, unknown>>
  permissions?: Record<string, string>
  files?: Array<Record<string, unknown>>
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
  const reviews = input.reviews ?? [
    { state: 'APPROVED', submitted_at: new Date(nowMs - 4 * 60_000).toISOString(), commit_id: headSha, user: { login: 'maintainer-a', type: 'User' } },
    { state: 'APPROVED', submitted_at: new Date(nowMs - 3 * 60_000).toISOString(), commit_id: headSha, user: { login: 'maintainer-b', type: 'User' } },
  ]
  const permissions = input.permissions ?? { 'maintainer-a': 'maintain', 'maintainer-b': 'write' }

  const fetcher: typeof fetch = async (requestUrl, init) => {
    const url = new URL(String(requestUrl))
    if (url.href === 'https://token.actions.githubusercontent.com/.well-known/jwks') {
      return Response.json({ keys: [input.jwk] })
    }
    if (url.pathname === '/repos/wanghuinet/luckread/pulls/77') return Response.json(pull)
    if (url.pathname === '/repos/wanghuinet/luckread/pulls/77/files') {
      return Response.json(input.files ?? [{ filename: 'docs/change-control/l8-genesis-bootstrap-request.json' }])
    }
    if (url.pathname === '/repos/wanghuinet/luckread/contents/docs/change-control/l8-genesis-bootstrap-request.json') {
      return Response.json({ encoding: 'base64', content: btoa(JSON.stringify(request)) })
    }
    if (url.pathname === '/repos/wanghuinet/luckread/pulls/77/reviews') return Response.json(reviews)
    const permissionMatch = url.pathname.match(/^\/repos\/wanghuinet\/luckread\/collaborators\/([^/]+)\/permission$/)
    if (permissionMatch) {
      const login = decodeURIComponent(permissionMatch[1]).toLowerCase()
      return permissions[login]
        ? Response.json({ permission: permissions[login] })
        : new Response('{}', { status: 404 })
    }
    return new Response('unexpected test URL', { status: 500 })
  }

  return { fetcher, pull, request, headSha, mergeSha }
}

describe('W02 L8 target-bound dual-approval verifier', () => {
  it('accepts a merged target-bound request with two distinct authorized approvals on the exact head SHA', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({ now, jwk: signed.jwk })
    const result = await verifyTargetBoundDualApproval({
      oidcToken: signed.token,
      githubToken: 'ghs_' + 'x'.repeat(40),
      requestPrNumber: 77,
      now,
      fetcher: github.fetcher,
    })

    expect(result).toMatchObject({
      request: { targetUserId: 'existing-user-123', roleId: 'super_admin', operation: 'INITIAL_L8_BOOTSTRAP' },
      requestPrNumber: 77,
      requestHeadSha: github.headSha,
      requestMergeSha: github.mergeSha,
      approvedReviewers: ['maintainer-a', 'maintainer-b'],
      workflowRunId: '12345678',
    })
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
    await expect(verifyTargetBoundDualApproval({
      oidcToken: signed.token,
      githubToken: 'ghs_' + 'x'.repeat(40),
      requestPrNumber: 77,
      now,
      fetcher: github.fetcher,
    })).rejects.toMatchObject({ code: 'REQUEST_PR_SCOPE_INVALID' })
  })

  it('rejects duplicate or missing second maintainer approval', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({
      now,
      jwk: signed.jwk,
      reviews: [
        { state: 'APPROVED', submitted_at: new Date(now.getTime() - 4 * 60_000).toISOString(), commit_id: 'a'.repeat(40), user: { login: 'maintainer-a' } },
        { state: 'APPROVED', submitted_at: new Date(now.getTime() - 3 * 60_000).toISOString(), commit_id: 'z'.repeat(40), user: { login: 'maintainer-b' } },
      ],
    })
    await expect(verifyTargetBoundDualApproval({
      oidcToken: signed.token,
      githubToken: 'ghs_' + 'x'.repeat(40),
      requestPrNumber: 77,
      now,
      fetcher: github.fetcher,
    })).rejects.toMatchObject({ code: 'DUAL_APPROVAL_REQUIRED' })
  })

  it('rejects a reviewer without repository write authority', async () => {
    const now = new Date('2026-10-24T12:00:00.000Z')
    const signed = await issueTestOidcToken(now)
    const github = githubFetcher({ now, jwk: signed.jwk, permissions: { 'maintainer-a': 'maintain', 'maintainer-b': 'read' } })
    await expect(verifyTargetBoundDualApproval({
      oidcToken: signed.token,
      githubToken: 'ghs_' + 'x'.repeat(40),
      requestPrNumber: 77,
      now,
      fetcher: github.fetcher,
    })).rejects.toMatchObject({ code: 'DUAL_APPROVAL_REQUIRED' })
  })

  it('rejects a malformed workflow token before consulting GitHub approval evidence', async () => {
    const fetcher: typeof fetch = async () => { throw new Error('GitHub should not be contacted') }
    await expect(verifyTargetBoundDualApproval({
      oidcToken: 'not.a.valid.jwt',
      githubToken: 'ghs_' + 'x'.repeat(40),
      requestPrNumber: 77,
      now: new Date('2026-10-24T12:00:00.000Z'),
      fetcher,
    })).rejects.toMatchObject({ code: 'OIDC_INVALID' })
  })
})
