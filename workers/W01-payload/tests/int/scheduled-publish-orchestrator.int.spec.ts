import { describe, expect, it, vi } from 'vitest'
import { runAuthorizedScheduledPublish } from '../../src/lib/scheduled-publish-orchestrator.js'

type Service = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

const toRequest = (input: RequestInfo | URL, init?: RequestInit): Request =>
  input instanceof Request ? input : new Request(input, init)

function candidate(
  contentId: string,
  ownerUserId: string,
  creatorId: string,
): Record<string, unknown> {
  return {
    contentId,
    ownerUserId,
    creatorId,
    version: 4,
    scheduledAt: '2026-11-05T00:00:00.000Z',
  }
}

function allowed(ownerUserId: string, creatorId: string) {
  return {
    decision: 'ALLOW',
    policyVersion: 'casl-l0-l8-v1',
    layer: 'L3',
    action: 'content.publish.own',
    resourceType: 'Content',
    ownerUserId,
    creatorId,
  }
}

describe('W01 authorized scheduled publish orchestrator', () => {
  it('rechecks every due Creator through W08 and submits only ALLOW decisions to W03', async () => {
    const dueItems = [
      candidate('content_due_allow', 'owner_allow', 'creator_allow'),
      candidate('content_due_deny', 'owner_deny', 'creator_deny'),
    ]
    let commitBody: Record<string, unknown> | null = null
    const w03Calls: Request[] = []
    const w08Calls: Request[] = []

    const w03: Service = {
      fetch: vi.fn(async (input, init) => {
        const request = toRequest(input, init)
        w03Calls.push(request)
        if (new URL(request.url).pathname.endsWith('/scheduled-due')) {
          return Response.json({ data: { items: dueItems }, requestId: 'req_due' })
        }
        if (new URL(request.url).pathname.endsWith('/scheduled-publish/commit')) {
          commitBody = await request.json() as Record<string, unknown>
          return Response.json({
            data: { scanned: 1, authorized: 1, published: 1, rejected: 0 },
            requestId: 'req_commit',
          })
        }
        return new Response(null, { status: 404 })
      }),
    }

    const w08: Service = {
      fetch: vi.fn(async (input, init) => {
        const request = toRequest(input, init)
        w08Calls.push(request)
        const body = await request.json() as { creatorId?: unknown }
        expect(Object.keys(body)).toEqual(['creatorId'])
        if (body.creatorId === 'creator_allow') {
          return Response.json(allowed('owner_allow', 'creator_allow'))
        }
        return Response.json({ decision: 'DENY', reasonCode: 'CREATOR_NOT_ACTIVE' })
      }),
    }

    const summary = await runAuthorizedScheduledPublish({
      W03_CONTENT: w03,
      W08_CREATOR: w08,
    })

    expect(summary).toEqual({
      scanned: 2,
      authorized: 1,
      denied: 1,
      authorizationFailures: 0,
      published: 1,
      rejected: 0,
    })
    expect(w03Calls.map((request) => new URL(request.url).pathname)).toEqual([
      '/internal/content/scheduled-due',
      '/internal/content/scheduled-publish/commit',
    ])
    expect(w08Calls).toHaveLength(2)
    for (const request of [...w03Calls, ...w08Calls]) {
      expect(request.headers.get('X-LuckRead-Caller')).toBe('W01')
      expect(request.headers.get('X-LuckRead-Transport-Version')).toBe('1.0')
      expect(request.headers.get('X-LuckRead-Rate-Key')).toBe('scheduled-publish')
      expect(request.headers.has('Authorization')).toBe(false)
      expect(request.headers.has('Cookie')).toBe(false)
    }
    expect(commitBody).toMatchObject({
      items: [{
        contentId: 'content_due_allow',
        ownerUserId: 'owner_allow',
        creatorId: 'creator_allow',
        authorization: allowed('owner_allow', 'creator_allow'),
      }],
    })
  })

  it('fails closed when W08 returns an ALLOW for a different owner or Creator', async () => {
    const w03Calls: string[] = []
    const w03: Service = {
      fetch: async (input, init) => {
        const request = toRequest(input, init)
        const path = new URL(request.url).pathname
        w03Calls.push(path)
        if (path.endsWith('/scheduled-due')) {
          return Response.json({
            data: { items: [candidate('content_owner_mismatch', 'owner_real', 'creator_real')] },
          })
        }
        throw new Error('W03 must not receive a commit after mismatched W08 evidence')
      },
    }
    const w08: Service = {
      fetch: async () => Response.json(allowed('forged_owner', 'creator_real')),
    }

    await expect(runAuthorizedScheduledPublish({
      W03_CONTENT: w03,
      W08_CREATOR: w08,
    })).rejects.toThrow('W08_SCHEDULED_PUBLISH_AUTHZ_UNAVAILABLE:1')

    expect(w03Calls).toEqual(['/internal/content/scheduled-due'])
  })

  it('does not call W08 or W03 commit when there are no due candidates', async () => {
    let dueReads = 0
    const w03: Service = {
      fetch: async (input, init) => {
        dueReads++
        return Response.json({ data: { items: [] } })
      },
    }
    const w08: Service = { fetch: vi.fn(async () => {
      throw new Error('W08 must not be called for an empty due set')
    }) }

    await expect(runAuthorizedScheduledPublish({
      W03_CONTENT: w03,
      W08_CREATOR: w08,
    })).resolves.toEqual({
      scanned: 0,
      authorized: 0,
      denied: 0,
      authorizationFailures: 0,
      published: 0,
      rejected: 0,
    })
    expect(dueReads).toBe(1)
    expect(w08.fetch).not.toHaveBeenCalled()
  })

  it('surfaces a W08 outage instead of allowing publication', async () => {
    const w03: Service = {
      fetch: async () => Response.json({
        data: { items: [candidate('content_w08_outage', 'owner_1', 'creator_1')] },
      }),
    }
    const w08: Service = {
      fetch: async () => new Response('unavailable', { status: 503 }),
    }

    await expect(runAuthorizedScheduledPublish({
      W03_CONTENT: w03,
      W08_CREATOR: w08,
    })).rejects.toThrow('W08_SCHEDULED_PUBLISH_AUTHZ_HTTP_503')
  })
})
