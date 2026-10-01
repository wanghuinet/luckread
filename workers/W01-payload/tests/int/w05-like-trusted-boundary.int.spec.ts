import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('W01 W05 Like trusted boundary', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/content/w05-social-client.ts'),
    'utf8',
  )

  it('resolves actor account state from W02 before Like mutation', () => {
    expect(source).toContain('export async function callW05Like(')
    expect(source).toContain('resolveActorAccountState({')
    expect(source).toContain("body: JSON.stringify({ userId: input.actorUserId })")
    expect(source).toContain("https://luckread-w05.internal/internal/social/likes")
    expect(source).toContain("actorAccountState,")
  })

  it('does not accept actor account state from the caller input', () => {
    const start = source.indexOf('export type TrustedLikeRequest')
    const end = source.indexOf('export async function callW05Like(')
    const requestType = source.slice(start, end)
    expect(requestType).not.toContain('actorAccountState')
  })
})
