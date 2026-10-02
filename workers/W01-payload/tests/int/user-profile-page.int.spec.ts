import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('user profile page', () => {
  it('uses the canonical versioned self-profile API and optimistic concurrency', () => {
    const page = read('src/app/(frontend)/me/profile/page.tsx')
    expect(page).toContain("fetch('/api/v1/users/me'")
    expect(page).toContain("method: 'PATCH'")
    expect(page).toContain("'If-Match': etag")
    expect(page).toContain("response.status === 412")
    expect(page).toContain("router.replace('/login?returnTo='")
    expect(page).toContain('username')
    expect(page).toContain('displayName')
    expect(page).toContain('个人简介')
    expect(page).toContain('保存资料')
    expect(page).toContain("href=\"/admin/creator-center\"")
  })
})
