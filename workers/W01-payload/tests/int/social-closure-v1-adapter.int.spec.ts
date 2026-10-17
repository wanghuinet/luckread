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


  it('exposes a public topic page backed by W05 topic data', () => {
    const page = read('src/app/(twitter-clone)/topics/[topicName]/page.tsx')
    expect(page).toContain('callW05SocialPublic')
    expect(page).toContain('/internal/social/topics/')
    expect(page).toContain('nextCursor')
    expect(page).toContain('<TwitterCloneSecondaryPageLayout locale={locale} title={title} active="explore">')
    expect(page).toContain("'/topics/' + encodeURIComponent(topic.topic.name)")
  })

  it('exposes real recent-topic discovery and a shared-shell trends page', () => {
    const route = read('src/app/api/v1/discovery/topics/route.ts')
    const page = read('src/app/(twitter-clone)/trends/page.tsx')
    const shell = read('src/app/(twitter-clone)/TwitterCloneSecondaryPageLayout.tsx')
    const runtime = read('../../workers/W05-social/src/social-closure-runtime.ts')
    const worker = read('../../workers/W05-social/src/index.ts')

    expect(route).toContain('/internal/social/discovery/topics')
    expect(route).toContain('enforcePublicReadRateLimit')
    expect(page).toContain('/internal/social/discovery/topics?')
    expect(page).toContain('contentCount')
    expect(page).toContain('nextCursor')
    expect(page).toContain('active="trends"')
    expect(shell).toContain("{ key: 'trends', href: '/trends', icon: 'trending' }")
    expect(worker).toContain("url.pathname === '/internal/social/discovery/topics'")
    expect(runtime).toContain('listDiscoveryTopics')
    expect(runtime).toContain("julianday(c.updated_at) >= julianday('now', '-7 days')")
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
    expect(worker).toContain('/poll/votes')
    expect(worker).toContain('castContentPollVote')
    expect(runtime).toContain('UNIQUE (poll_id, user_id)')
    expect(runtime).toContain("c.state !== 'PUBLISHED'")
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS social_polls')
    expect(migration).toContain('UNIQUE (poll_id, user_id)')
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
