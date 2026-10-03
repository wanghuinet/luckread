import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('mp.luckread.cn creator home routing', () => {
  it('routes only the mp hostname to the existing authenticated creator center', () => {
    const page = read('src/app/(frontend)/page.tsx')
    const creator = read('src/app/(frontend)/creator-center/page.tsx')

    expect(page).toContain("import { headers } from 'next/headers'")
    expect(page).toContain("import { redirect } from 'next/navigation'")
    expect(page).toContain("const requestHeaders = await headers()")
    expect(page).toContain("const host = (requestHeaders.get('host') || '').split(':')[0].toLowerCase()")
    expect(page).toContain("if (host === 'mp.luckread.cn')")
    expect(page).toContain("redirect('/creator-center')")
    expect(creator).toContain("const request = new Request('https://mp.luckread.cn/creator-center'")
    expect(creator).toContain('readVerifiedPayloadTokenVersion(request)')
    expect(creator).toContain('validateSession({')
    expect(creator).toContain('<CreatorStudio displayName={displayName} userId={String(user.id)} />')
    expect(page).toContain("export const dynamic = 'force-dynamic'")
  })

  it('keeps the public site separate and sends creator CTAs to the mp domain', () => {
    const page = read('src/app/(frontend)/page.tsx')
    const creatorCenter = read('src/app/(payload)/admin/CreatorCenter.tsx')

    expect(page).toContain("const CREATOR_CENTER_URL = 'https://mp.luckread.cn/'")
    expect(page).toContain('href={CREATOR_CENTER_URL}')
    expect(page).toContain('LuckRead 是面向新一代创作者与读者的内容平台')
    expect(creatorCenter).toContain('href="https://luckread.cn/"')
    expect(creator).not.toContain('/admin/login')
    expect(creator).not.toContain('AdminViewServerProps')
  })
})
