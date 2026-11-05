type InternalService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export type ScheduledPublishEnvironment = {
  W03_CONTENT: InternalService
  W08_CREATOR: InternalService
}

type DueCandidate = {
  contentId: string
  ownerUserId: string
  creatorId: string | null
  version: number
  scheduledAt: string
}

type ScheduledPublishAuthorization = {
  decision: 'ALLOW' | 'DENY'
  reasonCode?: string
  policyVersion?: string
  layer?: string
  action?: string
  resourceType?: string
  ownerUserId?: string
  creatorId?: string
}

type AuthorizedCandidate = DueCandidate & {
  creatorId: string
  authorization: ScheduledPublishAuthorization
}

type ScheduledPublishSummary = {
  scanned: number
  authorized: number
  denied: number
  authorizationFailures: number
  published: number
  rejected: number
}

const isIdentifier = (value: unknown, maxLength = 128): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maxLength &&
  /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)

const isDueCandidate = (value: unknown): value is DueCandidate => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    isIdentifier(item.contentId) &&
    isIdentifier(item.ownerUserId) &&
    (item.creatorId === null || isIdentifier(item.creatorId, 256)) &&
    Number.isSafeInteger(item.version) &&
    Number(item.version) >= 1 &&
    typeof item.scheduledAt === 'string' &&
    Number.isFinite(Date.parse(item.scheduledAt))
  )
}

const serviceHeaders = (correlationId: string): Headers => new Headers({
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': correlationId,
  'X-LuckRead-Rate-Key': 'scheduled-publish',
  accept: 'application/json',
})

const readJson = async (response: Response, service: string): Promise<unknown> => {
  if (!response.ok) throw new Error(service + '_HTTP_' + response.status)
  try {
    return await response.json()
  } catch {
    throw new Error(service + '_INVALID_JSON')
  }
}

const dataObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = (value as Record<string, unknown>).data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null
}

const isAllowedForCandidate = (
  value: unknown,
  candidate: DueCandidate,
): value is ScheduledPublishAuthorization => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const decision = value as Record<string, unknown>
  return (
    decision.decision === 'ALLOW' &&
    decision.policyVersion === 'casl-l0-l8-v1' &&
    (decision.layer === 'L3' || decision.layer === 'L4') &&
    decision.action === 'content.publish.own' &&
    decision.resourceType === 'Content' &&
    decision.ownerUserId === candidate.ownerUserId &&
    decision.creatorId === candidate.creatorId
  )
}

async function authorizeCandidate(
  env: ScheduledPublishEnvironment,
  candidate: DueCandidate,
  correlationId: string,
): Promise<{ authorized: AuthorizedCandidate | null; failed: boolean }> {
  // W08 owns the current Creator, account and role facts. A candidate without
  // a canonical creator identity cannot be authorized and is safely skipped.
  if (!candidate.creatorId) return { authorized: null, failed: false }

  const response = await env.W08_CREATOR.fetch(new Request(
    'https://luckread-w08-creator.internal/internal/authz/check-scheduled-publish',
    {
      method: 'POST',
      headers: new Headers([
        ...serviceHeaders(correlationId),
        ['content-type', 'application/json; charset=utf-8'],
      ]),
      body: JSON.stringify({ creatorId: candidate.creatorId }),
    },
  ))

  const payload = await readJson(response, 'W08_SCHEDULED_PUBLISH_AUTHZ')
  if (isAllowedForCandidate(payload, candidate)) {
    return {
      authorized: {
        ...candidate,
        creatorId: candidate.creatorId,
        authorization: payload,
      },
      failed: false,
    }
  }
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).decision === 'DENY'
  ) {
    return { authorized: null, failed: false }
  }
  return { authorized: null, failed: true }
}

/**
 * W01 orchestrates execution only. Due candidates and publication mutations
 * remain W03-owned; every candidate requires a fresh W08 decision before W03
 * executes the final owner/version/state/scheduled-time compare-and-set.
 */
export async function runAuthorizedScheduledPublish(
  env: ScheduledPublishEnvironment,
  scheduledTime: number,
): Promise<ScheduledPublishSummary> {
  const runId = 'scheduled-publish-' + crypto.randomUUID()
  const dueResponse = await env.W03_CONTENT.fetch(new Request(
    'https://luckread-w03.internal/internal/content/scheduled-due?limit=50',
    {
      method: 'GET',
      headers: serviceHeaders(runId + '-candidates'),
    },
  ))
  const duePayload = await readJson(dueResponse, 'W03_SCHEDULED_DUE')
  const dueData = dataObject(duePayload)
  if (!dueData || !Array.isArray(dueData.items) || dueData.items.length > 50) {
    throw new Error('W03_SCHEDULED_DUE_INVALID_RESPONSE')
  }

  const candidates: DueCandidate[] = []
  for (const value of dueData.items) {
    if (!isDueCandidate(value)) throw new Error('W03_SCHEDULED_DUE_INVALID_CANDIDATE')
    candidates.push(value)
  }

  const summary: ScheduledPublishSummary = {
    scanned: candidates.length,
    authorized: 0,
    denied: 0,
    authorizationFailures: 0,
    published: 0,
    rejected: 0,
  }
  if (candidates.length === 0) return summary

  const authorized: AuthorizedCandidate[] = []
  // Bound W08 fan-out to avoid opening 50 concurrent D1-01 authorization reads.
  const concurrency = 8
  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    const group = candidates.slice(offset, offset + concurrency)
    const results = await Promise.all(group.map((candidate, index) =>
      authorizeCandidate(env, candidate, runId + '-auth-' + (offset + index)),
    ))
    for (const result of results) {
      if (result.authorized) {
        authorized.push(result.authorized)
        summary.authorized++
      } else if (result.failed) {
        summary.authorizationFailures++
      } else {
        summary.denied++
      }
    }
  }

  if (authorized.length > 0) {
    const commitResponse = await env.W03_CONTENT.fetch(new Request(
      'https://luckread-w03.internal/internal/content/scheduled-publish/commit',
      {
        method: 'POST',
        headers: new Headers([
          ...serviceHeaders(runId + '-commit'),
          ['content-type', 'application/json; charset=utf-8'],
        ]),
        body: JSON.stringify({ items: authorized }),
      },
    ))
    const commitPayload = await readJson(commitResponse, 'W03_SCHEDULED_COMMIT')
    const commitData = dataObject(commitPayload)
    if (
      !commitData ||
      !Number.isSafeInteger(commitData.published) ||
      !Number.isSafeInteger(commitData.rejected)
    ) {
      throw new Error('W03_SCHEDULED_COMMIT_INVALID_RESPONSE')
    }
    summary.published = Number(commitData.published)
    summary.rejected = Number(commitData.rejected)
  }

  // A service failure is visible as a failed Cron invocation. Already-published
  // rows have left the due set; transiently failed rows will be reconsidered by
  // the next tick, while W03's CAS prevents duplicate publication.
  if (summary.authorizationFailures > 0) {
    throw new Error('W08_SCHEDULED_PUBLISH_AUTHZ_UNAVAILABLE:' + summary.authorizationFailures)
  }
  return summary
}
