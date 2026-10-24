const REPOSITORY = 'wanghuinet/luckread'
const WORKFLOW_REF = 'wanghuinet/luckread/.github/workflows/l8-genesis-bootstrap.yml@refs/heads/main'
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
const OIDC_AUDIENCE = 'luckread-w02-l8-bootstrap'
export const L8_BOOTSTRAP_REQUEST_PATH = 'docs/change-control/l8-genesis-bootstrap-request.json'
const MAX_REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1000
const CLOCK_SKEW_SECONDS = 60

export class L8BootstrapApprovalError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export type L8GenesisRequest = {
  version: 1
  operation: 'INITIAL_L8_BOOTSTRAP'
  targetUserId: string
  roleId: 'super_admin'
  scopeType: 'global'
  scopeId: null
  reason: string
  nonce: string
  createdAt: string
  expiresAt: string
}

export type VerifiedL8BootstrapApproval = {
  request: L8GenesisRequest
  requestPrNumber: number
  requestHeadSha: string
  requestMergeSha: string
  approvedReviewers: string[]
  reviewerPermissions: Record<string, string>
  workflowRunId: string
}

type GitHubPull = {
  number: number
  state: string
  merged_at: string | null
  merge_commit_sha: string | null
  created_at: string
  base?: { ref?: string; repo?: { full_name?: string } }
  head?: { sha?: string }
  user?: { login?: string }
}

type GitHubReview = {
  id?: number
  state?: string
  submitted_at?: string | null
  commit_id?: string | null
  user?: { login?: string; type?: string }
}

const parseJson = <T>(value: string): T => {
  try { return JSON.parse(value) as T } catch {
    throw new L8BootstrapApprovalError('INVALID_EVIDENCE', 'approval evidence is not valid JSON')
  }
}

const decodeBase64Url = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(normalized)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const decodeBase64UrlJson = <T>(value: string): T => {
  const bytes = decodeBase64Url(value)
  return parseJson<T>(new TextDecoder().decode(bytes))
}

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function verifyGitHubOidcToken(token: string, nowSeconds: number, fetcher: typeof fetch): Promise<{ runId: string }> {
  const pieces = token.split('.')
  if (pieces.length !== 3) throw new L8BootstrapApprovalError('OIDC_INVALID', 'GitHub workflow identity token is malformed')

  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(pieces[0])
  const claims = decodeBase64UrlJson<Record<string, unknown>>(pieces[1])
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new L8BootstrapApprovalError('OIDC_INVALID', 'GitHub workflow identity token algorithm is not accepted')
  }

  const issuedAt = Number(claims.iat)
  const expiresAt = Number(claims.exp)
  const notBefore = Number(claims.nbf)
  if (
    claims.iss !== OIDC_ISSUER ||
    claims.aud !== OIDC_AUDIENCE ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(notBefore) ||
    issuedAt > nowSeconds + CLOCK_SKEW_SECONDS ||
    notBefore > nowSeconds + CLOCK_SKEW_SECONDS ||
    expiresAt <= nowSeconds - CLOCK_SKEW_SECONDS ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > 10 * 60
  ) {
    throw new L8BootstrapApprovalError('OIDC_INVALID', 'GitHub workflow identity token claims are not accepted')
  }

  if (
    claims.repository !== REPOSITORY ||
    claims.repository_owner !== 'wanghuinet' ||
    claims.ref !== 'refs/heads/main' ||
    claims.ref_type !== 'branch' ||
    claims.event_name !== 'workflow_dispatch' ||
    claims.workflow_ref !== WORKFLOW_REF ||
    claims.environment !== 'l8-genesis-bootstrap' ||
    claims.ref_protected !== 'true' ||
    typeof claims.run_id !== 'string' ||
    !/^\d+$/.test(claims.run_id)
  ) {
    throw new L8BootstrapApprovalError('OIDC_FORBIDDEN', 'request did not originate from the protected L8 bootstrap workflow on main')
  }

  const jwksResponse = await fetcher(OIDC_ISSUER + '/.well-known/jwks', {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!jwksResponse.ok) throw new L8BootstrapApprovalError('OIDC_UNAVAILABLE', 'GitHub identity key service is unavailable')
  const jwks = await jwksResponse.json() as { keys?: JsonWebKey[] }
  const jwk = (jwks.keys ?? []).find((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid)
  if (!jwk) throw new L8BootstrapApprovalError('OIDC_INVALID', 'GitHub identity signing key is not recognized')

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const signatureBytes = decodeBase64Url(pieces[2])
  const signatureBuffer = new ArrayBuffer(signatureBytes.byteLength)
  new Uint8Array(signatureBuffer).set(signatureBytes)
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signatureBuffer,
    new TextEncoder().encode(pieces[0] + '.' + pieces[1]),
  )
  if (!valid) throw new L8BootstrapApprovalError('OIDC_INVALID', 'GitHub workflow identity signature is invalid')

  return { runId: claims.run_id }
}

const githubRequest = async <T>(
  path: string,
  token: string,
  fetcher: typeof fetch,
): Promise<T> => {
  const response = await fetcher('https://api.github.com' + path, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'LuckRead-L8-Genesis-Bootstrap',
    },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new L8BootstrapApprovalError(
      response.status === 403 || response.status === 429 ? 'GITHUB_RATE_LIMITED' : 'GITHUB_EVIDENCE_UNAVAILABLE',
      'GitHub approval evidence could not be verified',
    )
  }
  return await response.json() as T
}

const validRequest = (
  request: L8GenesisRequest,
  pull: GitHubPull,
  nowMs: number,
): boolean => {
  const created = Date.parse(request.createdAt)
  const expires = Date.parse(request.expiresAt)
  const pullCreated = Date.parse(pull.created_at)
  const merged = Date.parse(String(pull.merged_at))
  return request.version === 1 &&
    request.operation === 'INITIAL_L8_BOOTSTRAP' &&
    typeof request.targetUserId === 'string' &&
    /^[A-Za-z0-9_-]{8,128}$/.test(request.targetUserId) &&
    request.roleId === 'super_admin' &&
    request.scopeType === 'global' &&
    request.scopeId === null &&
    typeof request.reason === 'string' &&
    request.reason.trim().length >= 10 &&
    request.reason.length <= 512 &&
    typeof request.nonce === 'string' &&
    /^[a-f0-9]{64}$/i.test(request.nonce) &&
    Number.isFinite(created) &&
    Number.isFinite(expires) &&
    Number.isFinite(pullCreated) &&
    Number.isFinite(merged) &&
    created <= pullCreated + 5 * 60 * 1000 &&
    created <= nowMs &&
    expires > nowMs &&
    expires > merged &&
    expires - created <= MAX_REQUEST_LIFETIME_MS
}

export async function verifyTargetBoundDualApproval(input: {
  oidcToken: string
  githubToken: string
  requestPrNumber: number
  now?: Date
  fetcher?: typeof fetch
}): Promise<VerifiedL8BootstrapApproval> {
  const now = input.now ?? new Date()
  const fetcher = input.fetcher ?? fetch
  if (
    !Number.isSafeInteger(input.requestPrNumber) ||
    input.requestPrNumber < 1 ||
    input.requestPrNumber > 2_147_483_647 ||
    typeof input.githubToken !== 'string' ||
    input.githubToken.length < 20 ||
    input.githubToken.length > 4096
  ) {
    throw new L8BootstrapApprovalError('VALIDATION_FAILED', 'invalid bootstrap evidence request')
  }

  const workflow = await verifyGitHubOidcToken(input.oidcToken, Math.floor(now.getTime() / 1000), fetcher)
  const requestPath = '/repos/' + REPOSITORY + '/pulls/' + input.requestPrNumber
  const pull = await githubRequest<GitHubPull>(requestPath, input.githubToken, fetcher)
  const headSha = pull.head?.sha
  const mergeSha = pull.merge_commit_sha
  const author = pull.user?.login?.toLowerCase()
  if (
    pull.number !== input.requestPrNumber ||
    pull.state !== 'closed' ||
    !pull.merged_at ||
    !mergeSha ||
    !headSha ||
    pull.base?.ref !== 'main' ||
    pull.base?.repo?.full_name?.toLowerCase() !== REPOSITORY ||
    !author
  ) {
    throw new L8BootstrapApprovalError('PR_NOT_MERGED', 'bootstrap request PR must be merged into this repository main branch')
  }

  const files = await githubRequest<Array<{ filename?: string }>>(
    requestPath + '/files?per_page=100',
    input.githubToken,
    fetcher,
  )
  if (!files.some((file) => file.filename === L8_BOOTSTRAP_REQUEST_PATH)) {
    throw new L8BootstrapApprovalError('REQUEST_FILE_MISSING', 'approved PR did not change the bootstrap request file')
  }

  const content = await githubRequest<{ content?: string; encoding?: string }>(
    '/repos/' + REPOSITORY + '/contents/' + L8_BOOTSTRAP_REQUEST_PATH + '?ref=' + encodeURIComponent(mergeSha),
    input.githubToken,
    fetcher,
  )
  if (content.encoding !== 'base64' || typeof content.content !== 'string') {
    throw new L8BootstrapApprovalError('REQUEST_FILE_INVALID', 'bootstrap request file could not be read from the merge commit')
  }
  const decoded = new TextDecoder().decode(decodeBase64Url(
    btoa(String.fromCharCode(...Uint8Array.from(atob(content.content.replace(/\s/g, '')), (character) => character.charCodeAt(0)))),
  ))
  const request = parseJson<L8GenesisRequest>(decoded)
  if (!validRequest(request, pull, now.getTime())) {
    throw new L8BootstrapApprovalError('REQUEST_EXPIRED_OR_INVALID', 'bootstrap request is expired or violates the genesis request contract')
  }

  const reviews = await githubRequest<GitHubReview[]>(
    requestPath + '/reviews?per_page=100',
    input.githubToken,
    fetcher,
  )
  const latestReviewByLogin = new Map<string, GitHubReview>()
  for (const review of reviews) {
    const login = review.user?.login?.toLowerCase()
    if (!login || review.user?.type !== 'User' || login.endsWith('[bot]') || review.commit_id !== headSha || !review.submitted_at) continue
    const previous = latestReviewByLogin.get(login)
    if (!previous || String(review.submitted_at) > String(previous.submitted_at)) {
      latestReviewByLogin.set(login, review)
    }
  }

  const eligible: Array<{ login: string; permission: string }> = []
  for (const [login, review] of latestReviewByLogin) {
    if (review.state !== 'APPROVED' || login === author) continue
    const permissionPayload = await githubRequest<{ permission?: string }>(
      '/repos/' + REPOSITORY + '/collaborators/' + encodeURIComponent(login) + '/permission',
      input.githubToken,
      fetcher,
    )
    const permission = String(permissionPayload.permission ?? '').toLowerCase()
    if (['admin', 'maintain', 'write'].includes(permission)) eligible.push({ login, permission })
  }

  if (new Set(eligible.map((entry) => entry.login)).size < 2) {
    throw new L8BootstrapApprovalError('DUAL_APPROVAL_REQUIRED', 'two distinct authorized maintainers must approve the exact latest PR head')
  }

  const selected = eligible.sort((a, b) => a.login.localeCompare(b.login))
  const nonceHash = await sha256Hex(request.nonce)
  if (!nonceHash) throw new L8BootstrapApprovalError('INVALID_EVIDENCE', 'bootstrap nonce hash could not be computed')

  return {
    request,
    requestPrNumber: input.requestPrNumber,
    requestHeadSha: headSha,
    requestMergeSha: mergeSha,
    approvedReviewers: selected.map((entry) => entry.login),
    reviewerPermissions: Object.fromEntries(selected.map((entry) => [entry.login, entry.permission])),
    workflowRunId: workflow.runId,
  }
}
