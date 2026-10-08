import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('creator audience integration', () => {
  it('mounts the live follower/following summary inside Creator Center', () => {
    const center = read('src/app/(frontend)/creator-center/CreatorStudio.tsx')
    const summary = read('src/app/(payload)/v1beta/CreatorAudienceSummary.tsx')

    expect(center).toContain("import CreatorAudienceSummary from '../../(payload)/v1beta/CreatorAudienceSummary'")
    expect(center).toContain('<CreatorAudienceSummary userId={String(userId)} loginPath={adminMode ? \'/admin/login\' : \'/login\'} />')
    expect(center).toContain("{ label: '粉丝与关注', href: '#audience'")
    expect(center).not.toContain("{ label: '粉丝与订阅', href: '#future-audience'")
    expect(summary).toContain('/api/v1/users/')
    expect(summary).toContain("const otherDirection: Direction = direction === 'followers' ? 'following' : 'followers'")
    expect(summary).toContain("'/' + otherDirection + '?limit=1'")
    expect(summary).not.toContain('Promise.all([\n      fetchCount(')
    expect(summary).toContain("limit: String(PAGE_SIZE)")
    expect(summary).toContain('nextCursor')
    expect(summary).toContain('加载更多')
    expect(summary).toContain('用户 ID')
    expect(summary).toContain("href={'/users/' + encodeURIComponent(item.userId)}")
    expect(summary).toContain('查看主页')
    expect(summary).toContain('href="/me/followers"')
    expect(summary).toContain('查看我的粉丝')
    expect(summary).toContain('href="/me/following"')
    expect(summary).toContain('查看我的关注')
    expect(summary).toContain('credentials: \'include\'')
  })

  it('keeps audience reads on the canonical Social API', () => {
    const summary = read('src/app/(payload)/v1beta/CreatorAudienceSummary.tsx')

    expect(summary).not.toContain('getPayload(')
    expect(summary).not.toContain('social_follow_relationships')
    expect(summary).toContain('cache: \'no-store\'')
    expect(summary).toContain('W05 Social')
  })

  it('covers responsive audience styling and accessible relationship tabs', () => {
    const styles = read('src/app/(payload)/v1beta/creator-center.module.css')
    const summary = read('src/app/(payload)/v1beta/CreatorAudienceSummary.tsx')

    expect(styles).toContain('.audiencePanel')
    expect(styles).toContain('.audienceRow')
    expect(styles).toContain('@media (max-width:640px)')
    expect(summary).toContain('role="tablist"')
    expect(summary).toContain('role="tab"')
    expect(summary).toContain('aria-selected={direction ===')
    expect(summary).toContain('aria-busy={currentListLoading || listBusy}')
  })
})
