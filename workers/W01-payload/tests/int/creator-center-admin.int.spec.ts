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
    const updateRoute = read('src/app/(payload)/api/creator/contents/[contentId]/route.ts')
    const stateRoute = read('src/app/(payload)/api/creator/contents/[contentId]/state/route.ts')
    const preflightRoute = read('src/app/(payload)/api/creator/contents/[contentId]/preflight/route.ts')

    expect(view).toContain('<PublishComposer contentBasePath="/api/creator/contents" />')
    expect(publisher).toContain("contentBasePath = '/api/v1/contents'")
    expect(publisher).toContain('const [draft, setDraft]')
    expect(publisher).toContain('const [savedBody, setSavedBody]')
    expect(publisher).toContain('const isUpdate = Boolean(draft?.id && draft.etag)')
    expect(publisher).toContain("method: isUpdate ? 'PATCH' : 'POST'")
    expect(publisher).toContain("'If-Match': draft!.etag")
    expect(publisher).toContain('async function discardDraft()')
    expect(publisher).toContain("method: 'DELETE'")
    expect(publisher).toContain("'If-Match': draft.etag")
    expect(publisher).toContain('useEffect')
    expect(publisher).toContain("searchParams.get('draft')")
    expect(publisher).toContain("method: 'GET'")
    expect(publisher).toContain('window.history.replaceState')
    expect(publisher).toContain('async function copyDraftLink()')
    expect(publisher).toContain('navigator.clipboard.writeText')
    expect(publisher).toContain("'复制恢复链接'")
    expect(publisher).toContain('const stateLabel = draft?.state')
    expect(publisher).toContain("const reviewLocked = draft?.state === 'PENDING_REVIEW'")
    expect(publisher).toContain('function startNewContent()')
    expect(publisher).toContain("setDraft(null)")
    expect(publisher).toContain('新建内容')

    expect(publisher).toContain('disabled={busy || reviewLocked}')

    expect(publisher).toContain('当前状态')
    expect(publisher).toContain('版本 {draft.version}')

    expect(publisher).toContain('const [preview, setPreview]')
    expect(publisher).toContain('aria-label="发布预览"')
    expect(publisher).toContain("const CONTENT_MUTATED_EVENT = 'luckread:content-mutated'")
    expect(publisher).toContain('window.dispatchEvent(new Event(CONTENT_MUTATED_EVENT))')
    expect(publisher).toContain("type === 'video' && assets.length === 0")


    expect(updateRoute).toContain('export async function GET')
    expect(updateRoute).toContain("method: 'GET'")
    expect(publisher).toContain("credentials: 'include'")
    expect(contentClient).toContain('resolveCookieContentPrincipal')
    expect(createRoute).toContain('resolveCookieContentPrincipal')
    expect(createRoute).toContain("pathname: '/internal/content/contents'")
    expect(updateRoute).toContain('export async function DELETE')
    expect(updateRoute).toContain('export async function PATCH')
    expect(updateRoute).toContain('resolveCookieContentPrincipal')
    expect(updateRoute).toContain("method: 'PATCH'")
    expect(updateRoute).toContain('/internal/content/contents/')
    expect(stateRoute).toContain('resolveCookieContentPrincipal')
    expect(stateRoute).toContain('/internal/content/contents/')
    expect(publisher).toContain('发布前自检')
    expect(publisher).toContain('AI 使用方式（请据实选择）')
    expect(publisher).toContain('整篇 AI 生成（禁止直接发布）')
    expect(publisher).toContain('humanContribution')
    expect(preflightRoute).toContain('resolveCookieContentPrincipal')
    expect(preflightRoute).toContain('/internal/content/contents/')
    expect(preflightRoute).toContain('/preflight')
    expect(preflightRoute).toContain('/preflight')
  })

  it('exposes the creator-owned content management read slice', () => {
    const view = read('src/app/(payload)/admin/CreatorCenter.tsx')
    const list = read('src/app/(payload)/admin/CreatorContentList.tsx')
    const route = read('src/app/(payload)/api/creator/contents/route.ts')
    const client = read('src/content/w03-content-client.ts')

    expect(view).toContain("import CreatorContentList from './CreatorContentList'")
    expect(view).toContain('<CreatorContentList />')
    expect(list).toContain("/api/creator/contents?")
    expect(list).toContain("['DRAFT', 'REJECTED'].includes(item.state)")
    expect(list).toContain("item.state === 'PUBLISHED'")
    expect(list).toContain("async function transition(item: Item, to: 'PUBLISHED' | 'UNPUBLISHED')")
    expect(list).toContain("/api/creator/contents/")
    expect(list).toContain("/state")
    expect(list).toContain("method: 'POST'")
    expect(list).toContain("Idempotency-Key")
    expect(list).toContain("crypto.randomUUID()")
    expect(list).toContain("['UNPUBLISHED', '已下线']")
    expect(list).toContain("'下线'")
    expect(list).toContain("'重新发布'")
    expect(list).toContain("window.addEventListener('luckread:content-mutated'")
    expect(list).toContain("window.removeEventListener('luckread:content-mutated'")
    expect(list).toContain("href={\`/content/\${encodeURIComponent(item.id)}\`}")
    expect(list).toContain('加载更多')
    expect(route).toContain('export async function GET')
    expect(route).toContain('/internal/content/creator-contents')
    expect(client).toContain('X-LuckRead-Principal-User-Id')
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
