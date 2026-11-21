import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('mp creator entry routing', () => {
  it('uses the creator studio on the mp host for authenticated visitors without redirecting guests', () => {
    const page = read('src/app/(twitter-clone)/page.tsx')
    const creator = read('src/app/(twitter-clone)/CreatorDomainHome.tsx')

    expect(page).toContain("if (host === 'mp.luckread.com') return <CreatorDomainHome />")
    expect(page).toContain("PUBLIC_API_ORIGIN + '/v1/auth/principal'")
    expect(page).toContain('fetchJson<AuthPrincipalResponse>(request)')
    expect(page).not.toContain('getBetterAuthPrincipal')
    expect(page).not.toContain('w02-session-client')
    expect(page).toContain('if (principal?.active)')
    expect(creator).toContain("PUBLIC_API_ORIGIN + '/v1/auth/principal'")
    expect(creator).toContain('fetchJson<AuthPrincipalResponse>(request)')
    expect(creator).toContain("['cookie', 'authorization', 'cf-connecting-ip', 'accept-language', 'x-luckread-session-token']")
    expect(creator).not.toContain('getBetterAuthPrincipal')
    expect(creator).not.toContain('w02-session-client')
    expect(creator).not.toContain('enforcePublicReadRateLimit')
    expect(creator).toContain('return <CreatorStudio displayName={displayName} userId={principal.userId} locale={locale} />')
    expect(creator).toContain('<CreatorLanguageToggle locale={locale} />')
    expect(creator).toContain('href="/login?returnTo=%2F"')
    expect(creator).not.toContain('await payload.auth(')
    expect(creator).not.toContain('readVerifiedPayloadTokenVersion(request)')
    expect(creator).not.toContain('validateSession(')
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
