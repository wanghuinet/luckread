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

  it('keeps the existing native admin import map entries', () => {
    const importMap = read('src/app/(payload)/admin/importMap.js')

    expect(importMap).toContain('@payloadcms/storage-r2/client')
    expect(importMap).toContain('/app/(payload)/admin/CreatorCenter#CreatorCenter')
    expect(importMap).toContain('/app/(payload)/admin/CreatorCenterAction#CreatorCenterAction')
  })
})
