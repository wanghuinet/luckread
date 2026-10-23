import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('unified W05 social closure adapters', () => {
  it('routes article, post and video social state through one W05 content target', () => {
    const route = read('src/app/api/v1/contents/[contentId]/social/route.ts')
    expect(route).toContain('/internal/social/contents/')
    expect(route).toContain('/summary')
    expect(route).toContain('/tokens')
  })

  it('keeps notifications and notification preferences behind W05', () => {
    const notifications = read('src/app/api/v1/notifications/route.ts')
    const readRoute = read('src/app/api/v1/notifications/[notificationId]/read/route.ts')
    const readAllRoute = read('src/app/api/v1/notifications/read-all/route.ts')
    const preferences = read('src/app/api/v1/notification-preferences/route.ts')
    for (const source of [notifications, readRoute, readAllRoute, preferences]) {
      expect(source).toContain('callW05Social')
    }
  })

  it('keeps report authority on the governance path rather than duplicating reports in W05', () => {
    const reports = read('src/app/api/v1/reports/route.ts')
    expect(reports).toContain('callW06Moderation')
    expect(reports).toContain('W06ModerationClientError')
    expect(reports).not.toContain('/internal/social/reports')
  })


  it('loads topic SSR data through the contracted W01 public API while W01 owns the W05 binding', () => {
    const page = read('src/app/(twitter-clone)/topics/[topicName]/page.tsx')
    const route = read('src/app/api/v1/topics/[topicName]/route.ts')
    const openapi = read('../../contracts/openapi/v1/openapi.yaml')
    const apiInventory = JSON.parse(read('../../contracts/api/api-inventory.v1.json')) as { domains: Record<string, { endpoint_groups: string[] }> }
    const alignment = JSON.parse(read('../../contracts/alignment/api-inventory.v1.json')) as { records: Array<{ operationId: string; method: string; path: string; status: string }> }
    const operationPolicy = JSON.parse(read('../../contracts/openapi/v1/operation-policy.json')) as { operations: Array<{ operationId: string; auth: { mode: string } }> }

    expect(page).toContain("PUBLIC_API_ORIGIN + '/v1/topics/'")
    expect(page).toContain('fetchJson<{ data?: TopicPageData }>(request)')
    expect(page).toContain('nextCursor')
    expect(page).toContain('<TwitterCloneSecondaryPageLayout locale={locale} title={title} active="explore">')
    expect(page).toContain("PUBLIC_WEB_ORIGIN + '/topics/' + encodeURIComponent(topic.topic.name)")
    expect(page).not.toContain('callW05SocialPublic')
    expect(page).not.toContain('w05-social-client')
    expect(page).not.toContain('cachedPublicGet')
    expect(page).not.toContain('/internal/social/topics/')
    expect(route).toContain('callW05SocialPublic')
    expect(route).toContain('/internal/social/topics/')

    expect(openapi).toContain('  /topics/{topicName}:')
    expect(openapi).toContain('operationId: getTopicsTopicName')
    expect(openapi).toContain('Maximum number of visible published content items returned. Defaults to 20.')
    expect(openapi).toContain("contentType: { type: string, enum: [article, post, video] }")
    expect(openapi).toContain("nextCursor: { type: [string, 'null'], maxLength: 2048 }")
    expect(apiInventory.domains.search_discovery.endpoint_groups).toContain('GET /v1/topics/{topicName}')
    expect(alignment.records.some((record) => record.operationId === 'getTopicsTopicName' && record.method === 'GET' && record.path === '/v1/topics/{topicName}')).toBe(true)
    expect(alignment.records.find((record) => record.operationId === 'getTopicsTopicName')?.status).toBe('DISCOVERED')
    expect(operationPolicy.operations.find((operation) => operation.operationId === 'getTopicsTopicName')?.auth.mode).toBe('public')
  })

  it('exposes real recent-topic discovery and a shared-shell trends page', () => {
    const route = read('src/app/api/v1/discovery/topics/route.ts')
    const page = read('src/app/(twitter-clone)/trends/page.tsx')
    const shell = read('src/app/(twitter-clone)/TwitterCloneSecondaryPageLayout.tsx')
    const runtime = read('../../workers/W05-social/src/social-closure-runtime.ts')
    const worker = read('../../workers/W05-social/src/index.ts')

    expect(route).toContain('/internal/social/discovery/topics')
    expect(route).toContain('enforcePublicReadRateLimit')
    expect(page).toContain("PUBLIC_API_ORIGIN + '/v1/discovery/topics?'")
    expect(page).toContain('fetchJson<{ data?: DiscoveryTopicPageData }>(request)')
    expect(page).not.toContain('/internal/social/discovery/topics')
    expect(page).toContain('contentCount')
    expect(page).toContain('nextCursor')
    expect(page).toContain('active="trends"')
    expect(shell).toContain("{ key: 'trends', href: '/trends', icon: 'trending' }")
    expect(worker).toContain("url.pathname === '/internal/social/discovery/topics'")
    expect(runtime).toContain('listDiscoveryTopics')
    const discoveryRuntime = runtime.slice(runtime.indexOf('export async function listDiscoveryTopics'), runtime.indexOf('export async function enqueueNotification'))
    expect(discoveryRuntime).toContain('fetchPublishedContentSocialContexts')
    expect(discoveryRuntime).toContain("t.status = 'ACTIVE'")
    expect(discoveryRuntime).not.toMatch(/(?:FROM|JOIN)\s+contents\b/i)
  })

  it('contracts all public poll endpoints across inventory, OpenAPI, operation policy and alignment', () => {
    const openapi = read('../../contracts/openapi/v1/openapi.yaml')
    const inventory = JSON.parse(read('../../contracts/api/api-inventory.v1.json')) as {
      domains: Record<string, { endpoint_groups: string[] }>
    }
    const alignment = JSON.parse(read('../../contracts/alignment/api-inventory.v1.json')) as {
      records: Array<{ operationId: string; method: string; path: string; status: string }>
    }
    const policy = JSON.parse(read('../../contracts/openapi/v1/operation-policy.json')) as {
      operations: Array<{ operationId: string; auth: { mode: string }; idempotencyRequired: boolean; 'x-luckread-contract-status'?: string }>
    }
    const endpoints = [
      { method: 'GET', path: '/v1/contents/{contentId}/poll', operationId: 'getContentsContentIdPoll', idempotency: false },
      { method: 'POST', path: '/v1/contents/{contentId}/poll', operationId: 'postContentsContentIdPoll', idempotency: true },
      { method: 'DELETE', path: '/v1/contents/{contentId}/poll', operationId: 'deleteContentsContentIdPoll', idempotency: true },
      { method: 'POST', path: '/v1/contents/{contentId}/poll/votes', operationId: 'postContentsContentIdPollVotes', idempotency: true },
    ]

    for (const endpoint of endpoints) {
      expect(inventory.domains.interaction.endpoint_groups).toContain(endpoint.method + ' ' + endpoint.path)
      expect(openapi).toContain('operationId: ' + endpoint.operationId)
      expect(alignment.records.filter(record =>
        record.method === endpoint.method && record.path === endpoint.path && record.operationId === endpoint.operationId
      )).toHaveLength(1)
      const policies = policy.operations.filter(operation => operation.operationId === endpoint.operationId)
      expect(policies).toHaveLength(1)
      expect(policies[0]?.idempotencyRequired).toBe(endpoint.idempotency)
      expect(policies[0]?.['x-luckread-contract-status']).toBe('DISCOVERY_DRAFT')
    }

    expect(openapi).toContain('ContentPollOption:')
    expect(openapi).toContain('ContentPoll:')
    expect(openapi).toContain("enum: [24, 72, 168]")
    expect(openapi).toContain("#/components/parameters/IdempotencyKeyRequired")
  })

  it('wires poll draft setup, published voting, live results and X-style cards to W05 authority', () => {
    const pollRoute = read('src/app/api/v1/contents/[contentId]/poll/route.ts')
    const voteRoute = read('src/app/api/v1/contents/[contentId]/poll/votes/route.ts')
    const composer = read('src/app/(frontend)/publish/PublishComposer.tsx')
    const pollCard = read('src/app/(frontend)/components/reuse/SocialPoll.tsx')
    const postCard = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    const worker = read('../../workers/W05-social/src/index.ts')
    const runtime = read('../../workers/W05-social/src/poll-runtime.ts')
    const migration = read('../../workers/W05-social/migrations/20261017_014_social_polls_v1.sql')

    expect(pollRoute).toContain('/internal/social/contents/')
    expect(pollRoute).toContain('resolveCookieSocialPrincipal')
    expect(pollRoute).toContain('enforcePublicReadRateLimit')
    expect(voteRoute).toContain('/poll/votes')
    expect(voteRoute).toContain('Idempotency-Key')
    expect(composer).toContain('syncDraftPoll(savedDraft.id)')
    expect(composer).toContain('投票时长')
    expect(composer).toContain('发布后不能修改选项')
    expect(pollCard).toContain('/poll/votes')
    expect(pollCard).toContain('viewerOptionId')
    expect(postCard).toContain('<SocialPoll contentId={contentId} locale={locale} />')
    expect(worker).toContain('pollVoteMatch')
    expect(worker).toContain('castContentPollVote')
    expect(runtime).toContain("content.state !== 'PUBLISHED'")
    expect(migration).toContain('UNIQUE (poll_id, user_id)')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS social_polls')
    expect(migration).toContain('UNIQUE (poll_id, user_id)')
  })

  it('preserves containing-content IDs for reply, comment-like, and comment-mention notifications', () => {
    const worker = read('../../workers/W05-social/src/index.ts')
    const runtime = read('../../workers/W05-social/src/social-closure-runtime.ts')
    const notifications = read('src/app/(twitter-clone)/notifications/page.tsx')

    expect(worker).toContain("payload: { contentId: commentContentId }")
    expect(worker).toContain('SELECT content_id FROM social_comments WHERE id = ? LIMIT 1')
    expect(runtime).toContain('...(relatedContentId ? { contentId: relatedContentId } : {})')
    expect(notifications).toContain("item.targetType === 'comment'")
    expect(notifications).toContain('item.payload?.contentId')
  })

  it('supports persisted topics and mentions in W05', () => {
    const runtime = read('../../workers/W05-social/src/social-closure-runtime.ts')
    const migration = read('../../workers/W05-social/migrations/20261008_011_social_closure_v1.sql')
    expect(runtime).toContain('social_topics')
    expect(runtime).toContain('social_mentions')
    expect(runtime).toContain('social_notifications')
    expect(migration).toContain("target_type IN ('content','comment')")
    expect(migration).toContain('social_topics')
    expect(migration).toContain('social_mentions')
    expect(migration).toContain('social_notifications')
  })
})
