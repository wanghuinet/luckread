import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('creator audience integration', () => {
  it('mounts the live follower/following summary inside Creator Center', () => {
    const center = read('src/app/(payload)/admin/CreatorCenter.tsx')
    const summary = read('src/app/(payload)/admin/CreatorAudienceSummary.tsx')

    expect(center).toContain("import CreatorAudienceSummary from './CreatorAudienceSummary'")
    expect(center).toContain('<CreatorAudienceSummary userId={String(serverUser.id)} />')
    expect(summary).toContain('/api/v1/users/')
    expect(summary).toContain('/followers?limit=1')
    expect(summary).toContain('/following?limit=1')
    expect(summary).toContain('credentials: \'include\'')
    expect(summary).toContain('totalCount')
    expect(summary).toContain('W05 Social')
  })

  it('keeps audience reads independent from Payload storage', () => {
    const summary = read('src/app/(payload)/admin/CreatorAudienceSummary.tsx')

    expect(summary).not.toContain('getPayload(')
    expect(summary).not.toContain('social_follow_relationships')
    expect(summary).toContain('cache: \'no-store\'')
  })
})
