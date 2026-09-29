import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('Creator Center admin extension', () => {
  it('registers as a separate Payload Admin root view without replacing native views', () => {
    const config = read('src/payload.config.ts')

    expect(config).toContain('creatorCenter: {')
    expect(config).toContain("Component: '/app/(payload)/admin/CreatorCenter#CreatorCenter'")
    expect(config).toContain("path: '/creator-center'")
    expect(config).toContain("actions: ['/app/(payload)/admin/CreatorCenterAction#CreatorCenterAction']")
  })

  it('uses the native Payload admin request principal instead of a second login/session system', () => {
    const view = read('src/app/(payload)/admin/CreatorCenter.tsx')

    expect(view).toContain('AdminViewServerProps')
    expect(view).toContain('initPageResult.req.user')
    expect(view).not.toContain('sessionStorage')
    expect(view).not.toContain('accessToken')
    expect(view).not.toContain('refreshToken')
  })

  it('embeds the existing publisher with a scoped W03 content bridge', () => {
    const view = read('src/app/(payload)/admin/CreatorCenter.tsx')
    const publisher = read('src/app/(frontend)/publish/PublishComposer.tsx')
    const contentClient = read('src/content/w03-content-client.ts')
    const createRoute = read('src/app/(payload)/api/creator/contents/route.ts')
    const stateRoute = read('src/app/(payload)/api/creator/contents/[contentId]/state/route.ts')

    expect(view).toContain('<PublishComposer contentBasePath="/api/creator/contents" />')
    expect(publisher).toContain("contentBasePath = '/api/v1/contents'")
    expect(publisher).toContain("credentials: 'include'")
    expect(contentClient).toContain('resolveCookieContentPrincipal')
    expect(createRoute).toContain('resolveCookieContentPrincipal')
    expect(createRoute).toContain("pathname: '/internal/content/contents'")
    expect(stateRoute).toContain('resolveCookieContentPrincipal')
    expect(stateRoute).toContain('/internal/content/contents/')
  })

  it('keeps frontend and Admin on the same Payload cookie session lifecycle', () => {
    const login = read('src/app/auth/login/route.ts')
    const logout = read('src/app/auth/logout/route.ts')

    expect(login).toContain("'set-cookie': [")
    expect(login).toContain('payload-token=')
    expect(login).toContain('HttpOnly')
    expect(login).toContain('SameSite=Lax')
    expect(logout).toContain("set-cookie': 'payload-token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'")
  })

  it('keeps the existing native admin import map entries', () => {
    const importMap = read('src/app/(payload)/admin/importMap.js')

    expect(importMap).toContain('@payloadcms/storage-r2/client')
    expect(importMap).toContain('/app/(payload)/admin/CreatorCenter#CreatorCenter')
    expect(importMap).toContain('/app/(payload)/admin/CreatorCenterAction#CreatorCenterAction')
  })
})
