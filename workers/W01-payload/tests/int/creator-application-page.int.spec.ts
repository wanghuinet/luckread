import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workerRoot = existsSync(resolve(process.cwd(), 'src/app/(frontend)/creator-application/page.tsx'))
  ? process.cwd()
  : resolve(process.cwd(), 'workers/W01-payload')
const read = (path: string) => readFileSync(resolve(workerRoot, path), 'utf8')

describe('creator qualification application page', () => {
  it('uses W02 authenticated principal and redirects expired sessions to login', () => {
    const page = read('src/app/(frontend)/creator-application/page.tsx')
    expect(page).toContain('getBetterAuthPrincipal')
    expect(page).toContain('W02AuthClientError')
    expect(page).toContain("redirect('/login?returnTo=%2Fcreator-application')")
    expect(page).toContain("layer={principal.layer ?? 'L1'}")
  })

  it('reads and submits the applicant-owned application through W01 API', () => {
    const client = read('src/app/(frontend)/creator-application/CreatorApplicationClient.tsx')
    expect(client.match(/fetchJson<ApiPayload>\('\/api\/v1\/creator-applications'/g)?.length).toBe(2)
    expect(client).toContain("method: 'POST'")
    expect(client).toContain("'Idempotency-Key': requestKey.current.key")
    expect(client).toContain("credentials: 'include'")
    expect(client).toContain("cache: 'no-store'")
    expect(client).toContain("window.location.assign('/login?returnTo=%2Fcreator-application')")
  })

  it('presents pending, approved, rejected, retry and grant-pending states without claiming premature access', () => {
    const client = read('src/app/(frontend)/creator-application/CreatorApplicationClient.tsx')
    expect(client).toContain("'PENDING' ? '等待审核'")
    expect(client).toContain("'REJECTED' ? '申请未通过'")
    expect(client).toContain("'GRANTED' ? '已通过 · 权限已生效'")
    expect(client).toContain('W02 权限授予尚未确认')
    expect(client).toContain('重新提交申请')
    expect(client).toContain('刷新状态')
    expect(client).toContain('联系平台审核员重新确认授权')
  })

  it('gates creator operations at L3 and exposes the qualification entry from profile', () => {
    const studio = read('src/app/(frontend)/creator-center/page.tsx')
    const profile = read('src/app/(frontend)/me/profile/page.tsx')
    expect(studio).toContain("if (principal.layer !== 'L3') redirect('/creator-application')")
    expect(profile).toContain('href="/creator-application"')
  })

  it('uses responsive mobile and desktop layout styles', () => {
    const css = read('src/app/(frontend)/creator-application/creator-application.module.css')
    expect(css).toContain('@media (max-width: 640px)')
    expect(css).toContain('@media (max-width: 380px)')
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(css).toContain('grid-template-columns: 1fr')
  })
  it('preserves the canonical cookie or Bearer credential across the W01-to-W08 binding', () => {
    const client = read('src/auth/w08-creator-client.ts')
    expect(client).toContain('const headers = new Headers(request.headers)')
    expect(client).toContain("headers.delete('host')")
    expect(client).toContain("headers.delete('content-length')")
    expect(client).not.toContain("headers.delete('authorization')")
    expect(client).toContain("new Request('https://luckread-w08-creator.internal' + path")
    expect(client).toContain('headers,')
  })

  it('restricts creator review to L7/L8 and uses authoritative review APIs', () => {
    const page = read('src/app/(frontend)/creator-review/page.tsx')
    const client = read('src/app/(frontend)/creator-review/CreatorReviewClient.tsx')
    expect(page).toContain("principal.layer !== 'L7' && principal.layer !== 'L8'")
    expect(client).toContain("'/api/v1/admin/creator-applications?limit=50'")
    expect(client).toContain("'/api/v1/admin/creator-applications'")
    expect(client).toContain("'If-Match'")
    expect(client).toContain("'Idempotency-Key'")
    expect(client).toContain('通过并授予 L3')
    expect(client).toContain('重试授权')
    expect(client).toContain("onClick={() => void decide(application, 'APPROVED')}")
    expect(client).not.toContain('document.getElementById')
  })

})
