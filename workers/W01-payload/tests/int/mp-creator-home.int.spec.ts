import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('mp creator entry routing', () => {
  it('uses Better Auth as the creator session authority', () => {
    const page = read('src/app/(frontend)/page.tsx')
    const creator = read('src/app/(frontend)/creator-center/page.tsx')

    expect(page).toContain("const CREATOR_CENTER_HOSTS = new Set(['mp.luckread.com'])")
    expect(page).toContain('getBetterAuthSession')
    expect(page).not.toContain('readVerifiedPayloadTokenVersion')
    expect(page).not.toContain('validateSession')
    expect(creator).toContain('getBetterAuthSession')
    expect(creator).toContain("redirect('/login?returnTo=%2Fcreator-center')")
  })

  it('keeps creator studio outside the Payload Admin registration', () => {
    const config = read('src/payload.config.ts')
    const studio = read('src/app/(frontend)/creator-center/CreatorStudio.tsx')
    expect(config).not.toContain('CreatorCenterAction')
    expect(config).not.toContain('creatorCenter:')
    expect(studio).toContain("import CreatorContentList from '../../(payload)/v1beta/CreatorContentList'")
  })
})
