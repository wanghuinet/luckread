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
