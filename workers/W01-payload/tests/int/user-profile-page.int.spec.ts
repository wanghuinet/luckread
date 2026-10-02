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
    expect(page).toContain('href="/me/password"')
  })


  it('loads the viewer profile and hides self-follow on the public profile', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    expect(page).toContain("fetch('/api/v1/users/me'")
    expect(page).toContain('setViewerUserId(typeof viewerData?.id === \'string\' ? viewerData.id : null)')
    expect(page).toContain('viewerUserId === profile.id')
    expect(page).toContain('这是你的主页')
  })

  it('uses the existing authenticated logout API and returns to the public homepage', () => {
    const page = read('src/app/(frontend)/me/profile/page.tsx')

    expect(page).toContain("fetch('/api/v1/auth/logout'")
    expect(page).toContain("method: 'POST'")
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("response.status !== 401")
    expect(page).toContain("window.location.assign('/')")
    expect(page).toContain('退出登录')
  })

  it('uploads avatars through the existing authenticated media API and waits for profile save', () => {
    const page = read('src/app/(frontend)/me/profile/page.tsx')

    expect(page).toContain("fetch('/api/v1/media'")
    expect(page).toContain("method: 'POST'")
    expect(page).toContain("form.append('file', file)")
    expect(page).toContain("form.append('alt', file.name)")
    expect(page).toContain("headers: { 'Idempotency-Key': 'media-upload:' + crypto.randomUUID() }")
    expect(page).toContain("setProfile((current) => current ? { ...current, avatar: url } : current)")
    expect(page).toContain('上传后仍需点击“保存资料”。')
  })

})

describe('password change page', () => {
  it('uses the versioned password-change API and existing session lifecycle', () => {
    const page = read('src/app/(frontend)/me/password/page.tsx')
    expect(page).toContain("fetch('/api/v1/auth/password/change'")
    expect(page).toContain("method: 'POST'")
    expect(page).toContain("'Idempotency-Key'")
    expect(page).toContain('crypto.randomUUID()')
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain('currentPassword')
    expect(page).toContain('newPassword')
    expect(page).toContain('confirmPassword')
    expect(page).toContain('MIN_PASSWORD_LENGTH = 15')
    expect(page).toContain('MAX_PASSWORD_LENGTH = 128')
    expect(page).toContain("response.status === 401")
    expect(page).toContain("const returnTo = window.location.pathname + window.location.search + window.location.hash")
    expect(page).toContain("router.replace('/login?returnTo=' + encodeURIComponent(returnTo))")
    expect(page).toContain("router.replace('/login?returnTo='")
  })
})
