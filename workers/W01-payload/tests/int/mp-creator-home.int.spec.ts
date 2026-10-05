import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('mp creator entry routing', () => {
  it('uses the creator studio as the authenticated mp homepage without redirecting unauthenticated visitors', () => {
    const page = read('src/app/(frontend)/page.tsx')
    const creator = read('src/app/(frontend)/creator-center/page.tsx')

    expect(page).toContain("const CREATOR_CENTER_URL = 'https://mp.luckread.com/'")
    expect(page).toContain("const CREATOR_CENTER_HOSTS = new Set(['mp.luckread.com'])")
    expect(page).toContain('if (CREATOR_CENTER_HOSTS.has(host))')
    expect(page).toContain("from '@/auth/w02-user-profile-client'")
    expect(page).toContain("const profileResponse = await callW02UserProfile(")
    expect(page).toContain("'/internal/account/profile'")
    expect(page).toContain("'GET'")
    expect(page).toContain("better-auth.session_token")
    expect(page).toContain('await enforcePublicReadRateLimit(request)')
    expect(page).not.toContain("from 'payload'")
    expect(page).not.toContain("@payload-config")
    expect(page).not.toContain('payload.auth(')
    expect(page).not.toContain('readVerifiedPayloadTokenVersion')
    expect(page).not.toContain('validateSession(')
    expect(page).toContain('<CreatorStudio displayName={displayName} userId={userId} locale={locale} />')
    expect(page).toContain('className="mp-entry-shell"')
    expect(page).not.toContain("redirect('/creator-center')")
    expect(page).not.toContain("if (host === 'mp.luckread.com') {\n    redirect('/creator-center')")
    expect(creator).toContain("new Request('https://mp.luckread.com/creator-center'")
    expect(creator).toContain("from '@/auth/w02-user-profile-client'")
    expect(creator).toContain("callW02UserProfile(request, '/internal/account/profile', 'GET')")
    expect(creator).not.toContain("from 'payload'")
    expect(creator).not.toContain('@payload-config')
    expect(creator).not.toContain('payload.auth(')
    expect(creator).not.toContain('readVerifiedPayloadTokenVersion')
    expect(creator).not.toContain('validateSession(')
    expect(creator).toContain("redirect('/login?returnTo=%2Fcreator-center')")
  })

  it('keeps creator studio outside the Payload Admin registration', () => {
    const config = read('src/payload.config.ts')
    const studio = read('src/app/(frontend)/creator-center/CreatorStudio.tsx')

    expect(config).not.toContain('CreatorCenterAction')
    expect(config).not.toContain('creatorCenter:')
    expect(studio).toContain("import CreatorContentList from '../../(payload)/v1beta/CreatorContentList'")
    expect(studio).toContain("import CreatorCenterAssistant from '../../(payload)/v1beta/CreatorCenterAssistant'")
    expect(studio).toContain("import CreatorAudienceSummary from '../../(payload)/v1beta/CreatorAudienceSummary'")
    expect(studio).toContain("import CreatorAssetLibrary from '../../(payload)/v1beta/CreatorAssetLibrary'")
    expect(studio).toContain("import CreatorModerationQueue from '../../(payload)/v1beta/CreatorModerationQueue'")
  })
})
