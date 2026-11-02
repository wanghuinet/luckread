import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('content state adapters', () => {
  it('enforces If-Match and Idempotency-Key at the public v1 boundary', () => {
    const route = read('src/app/api/v1/contents/[contentId]/state/route.ts')
    expect(route).toContain('requireStatePreconditions')
    expect(route).toContain("request.headers.get('Idempotency-Key')?.trim() ?? ''")
    expect(route).toContain("request.headers.get('If-Match')?.trim() ?? ''")
    expect(route).toContain('idempotencyKey.length > 256')
    expect(route).toContain('ifMatch.length > 256')
    expect(route).toContain("ifMatch === '*'")
    expect(route).toContain("'PRECONDITION_REQUIRED'")
    expect(route).toContain("'PRECONDITION_FAILED'")
    expect(route).toContain("method: 'POST'")
    expect(route).toContain('callW03Content')
    expect(route).toContain('verifiedCreatorId: binding.verifiedCreatorId')
  })

  it('enforces the same preconditions on the Creator Center state route', () => {
    const route = read('src/app/(payload)/api/creator/contents/[contentId]/state/route.ts')
    expect(route).toContain('requireStatePreconditions')
    expect(route).toContain("request.headers.get('Idempotency-Key')?.trim() ?? ''")
    expect(route).toContain("request.headers.get('If-Match')?.trim() ?? ''")
    expect(route).toContain('idempotencyKey.length > 256')
    expect(route).toContain('ifMatch.length > 256')
    expect(route).toContain("ifMatch === '*'")
    expect(route).toContain("'PRECONDITION_REQUIRED'")
    expect(route).toContain("'PRECONDITION_FAILED'")
    expect(route).toContain('callW03Content')
    expect(route).toContain('verifiedCreatorId: binding.verifiedCreatorId')
  })
})

describe('creator content lifecycle cache adapters', () => {
  it('invalidates public content views after Creator Center state transitions', () => {
    const route = read('src/app/(payload)/api/creator/contents/[contentId]/state/route.ts')
    expect(route).toContain("invalidatePublicContentComments(contentId)")
    expect(route).toContain("invalidatePublicContentVisibility(contentId)")
    expect(route).toContain("invalidatePublicContentRelationships(contentId)")
    expect(route).toContain("invalidatePublicContentDetail(request, contentId)")
    expect(route).toContain("invalidatePublicContentList(request)")
    expect(route).toContain("if (response.ok)")
    expect(route).toContain("method: 'POST'")
  })

  it('invalidates public content views after Creator Center deletion of published content', () => {
    const route = read('src/app/(payload)/api/creator/contents/[contentId]/route.ts')
    expect(route).toContain("export async function DELETE")
    expect(route).toContain("method: 'DELETE'")
    expect(route).toContain("invalidatePublicContentComments(contentId)")
    expect(route).toContain("invalidatePublicContentVisibility(contentId)")
    expect(route).toContain("invalidatePublicContentRelationships(contentId)")
    expect(route).toContain("invalidatePublicContentDetail(request, contentId)")
    expect(route).toContain("invalidatePublicContentList(request)")
    expect(route).toContain("if (response.ok)")
  })
})

describe('public content-list cache invalidation scope', () => {
  it('keeps the global public list cache during draft creation and draft-only edits', () => {
    const createRoute = read('src/app/api/v1/contents/route.ts')
    const createMutation = createRoute.slice(createRoute.indexOf('export async function POST'))
    const contentRoute = read('src/app/api/v1/contents/[contentId]/route.ts')
    const patchStart = contentRoute.indexOf('export async function PATCH')
    const deleteStart = contentRoute.indexOf('export async function DELETE')
    const patchMutation = contentRoute.slice(patchStart, deleteStart)
    const runtime = readFileSync(
      resolve(process.cwd(), '../W03-content/src/content-runtime.ts'),
      'utf8',
    )

    expect(runtime).toContain("state: 'DRAFT'")
    expect(runtime).toContain("const EDITABLE_STATES = new Set<ContentState>(['DRAFT', 'REJECTED', 'RESTORED'])")
    expect(createMutation).not.toContain('invalidatePublicContentList')
    expect(patchMutation).toContain('invalidatePublicContentDetail(request, contentId)')
    expect(patchMutation).toContain("if (updatedState === 'PUBLISHED') await invalidatePublicContentList(request)")
    expect(patchMutation).toContain('Drafts are not part of anonymous public lists')
  })
})

describe('scheduled publication cache window', () => {
  it('pins scheduled publish wiring and the public content-list TTL', () => {
    const publicListRoute = read('src/app/api/v1/contents/route.ts')
    const listHandler = publicListRoute.slice(
      publicListRoute.indexOf('export async function GET'),
      publicListRoute.indexOf('export async function POST'),
    )
    const cache = read('src/lib/public-response-cache.ts')
    const w03Index = readFileSync(
      resolve(process.cwd(), '../W03-content/src/index.ts'),
      'utf8',
    )
    const w03Runtime = readFileSync(
      resolve(process.cwd(), '../W03-content/src/content-runtime.ts'),
      'utf8',
    )
    const scheduledHandler = w03Index.slice(w03Index.indexOf('async scheduled('))

    expect(scheduledHandler).toContain("controller.cron !== '* * * * *'")
    expect(scheduledHandler).toContain('publishDueScheduledContent(env.D1_02')
    expect(w03Runtime).toContain("SET state = 'PUBLISHED', scheduled_at = NULL")
    expect(listHandler).toContain("'content-list'")
    expect(listHandler).toContain("      30,\n    )")
    expect(cache).toContain('Cache-Control')
    expect(cache).toContain('s-maxage=${effectiveTtl}')
    expect(cache).toContain('Math.max(1, Math.floor(ttlSeconds))')
  })
})

describe('1.1 content lifecycle closeout', () => {
  it('wires the complete creator lifecycle from draft creation through review and public delivery', () => {
    const publisher = read('src/app/(frontend)/publish/PublishComposer.tsx')
    const creatorCreate = read('src/app/(payload)/api/creator/contents/route.ts')
    const creatorState = read('src/app/(payload)/api/creator/contents/[contentId]/state/route.ts')
    const publicState = read('src/app/api/v1/contents/[contentId]/state/route.ts')
    const boundPreflight = read('src/content/bind-post-publish-preflight.ts')
    const creatorList = read('src/app/(payload)/v1beta/CreatorContentList.tsx')
    const publicDetail = read('src/app/(twitter-clone)/content/[contentId]/page.tsx')
    const publicRoutes = read('src/app/(frontend)/content/PublicContentRoutes.tsx')
    const publicDetailClient = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    const w03Client = read('src/content/w03-content-client.ts')
    const w03Runtime = readFileSync(
      resolve(process.cwd(), '../W03-content/src/content-runtime.ts'),
      'utf8',
    )

    expect(publisher).toContain("contentBasePath = '/api/v1/contents'")
    expect(publisher).toContain("contentBasePath + '/' + encodeURIComponent(savedDraft.id) + '/state'")
    expect(publisher).toContain("to: type === 'post' ? 'PUBLISHED' : 'PENDING_REVIEW'")
    expect(publisher).toContain('preflight: input')
    expect(publisher).toContain("'If-Match': savedDraft.etag")
    expect(publisher).toContain("'Idempotency-Key': crypto.randomUUID()")
    expect(publisher).toContain("window.dispatchEvent(new Event(CONTENT_MUTATED_EVENT))")

    expect(creatorCreate).toContain("pathname: '/internal/content/contents'")
    expect(creatorCreate).toContain("method: 'POST'")
    expect(creatorCreate).toContain('resolveCookieContentPrincipal')

    expect(creatorState).toContain("/internal/content/contents/")
    expect(creatorState).toContain("/state")
    expect(creatorState).toContain("requireStatePreconditions")
    expect(creatorState).toContain("bindPreflightToStoredPost")
    expect(creatorState).toContain("invalidatePublicContentDetail(request, contentId)")
    expect(creatorState).toContain("invalidatePublicContentList(request)")

    expect(publicState).toContain("resolveContentPrincipal")
    expect(publicState).toContain("/internal/content/contents/")
    expect(publicState).toContain("/state")
    expect(publicState).toContain("invalidatePublicContentDetail(request, contentId)")
    expect(publicState).toContain("bindPreflightToStoredPost")
    expect(boundPreflight).toContain("resolvePublicArticleBodyUrl")
    expect(boundPreflight).toContain("readBoundedUtf8")
    expect(boundPreflight).toContain("body: canonicalBody")
    expect(boundPreflight).toContain("redirect: 'manual'")
    expect(boundPreflight).toContain("content.state !== 'DRAFT'")
    expect(publicState).toContain("invalidatePublicContentList(request)")

    expect(creatorList).toContain("async function requestTransition(itemId: string")
    expect(creatorList).toContain("'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED' | 'RESTORED' | 'DRAFT' | 'SCHEDULED'")
    expect(creatorList).toContain("requestTransition(item.id, to, item.version)")
    expect(creatorList).toContain("schedulePublication(item)")
    expect(creatorList).toContain("item.scheduledAt")
    expect(creatorList).toContain("item.state === 'REJECTED'")
    expect(creatorList).toContain("onClick={() => void moveToDraftForEdit(item)}")
    expect(creatorList).toContain("item.state === 'DRAFT'")
    expect(creatorList).toContain("window.addEventListener('luckread:content-mutated'")

    expect(publicDetail).toContain('renderLegacyContentRoute(contentId)')
    expect(publicDetail).toContain('generateLegacyContentMetadata(contentId)')
    expect(publicRoutes).toContain("new Request(PUBLIC_API_ORIGIN + '/v1/contents/'")
    expect(publicRoutes).toContain("new Request(PUBLIC_API_ORIGIN + '/v1/users/'")
    expect(publicRoutes).toContain("content.state !== 'PUBLISHED'")
    expect(publicRoutes).toContain('permanentRedirect(canonicalPath(author, content))')
    expect(publicDetailClient).toContain("apiFetch(resolved.bodyRef")
    expect(publicDetailClient).toContain("<ArticleStructuredRenderer document={structuredArticle} mentions={socialMentions} />")

    expect(w03Client).toContain("X-LuckRead-Principal-User-Id")
    expect(w03Client).toContain("X-LuckRead-Principal-Layer")
    expect(w03Client).toContain("Idempotency-Key")
    expect(w03Client).toContain("If-Match")

    expect(w03Runtime).toContain("state: 'DRAFT'")
    expect(w03Runtime).toContain("from === 'DRAFT' && to === 'PENDING_REVIEW'")
    expect(w03Runtime).toContain("from === 'APPROVED' && to === 'PUBLISHED'")
    expect(w03Runtime).toContain("from === 'APPROVED' && to === 'SCHEDULED'")
    expect(w03Runtime).toContain("publishDueScheduledContent")
    expect(w03Runtime).toContain("scheduled_at")
    expect(w03Runtime).toContain("from === 'PUBLISHED' && (to === 'UNPUBLISHED' || to === 'ARCHIVED')")
    expect(w03Runtime).toContain("from === 'UNPUBLISHED' && (to === 'PUBLISHED' || to === 'DRAFT')")
    expect(w03Runtime).toContain("from === 'DELETED' && to === 'RESTORED'")
    expect(w03Runtime).toContain("if (!EDITABLE_STATES.has(content.state))")
  })

  it('keeps anonymous public delivery closed to non-published lifecycle states', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), '../W03-content/src/content-runtime.ts'),
      'utf8',
    )
    const detailPage = read('src/app/(twitter-clone)/content/[contentId]/page.tsx')
    const publicRoutes = read('src/app/(frontend)/content/PublicContentRoutes.tsx')
    const detailClient = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')

    expect(runtime).toContain(
      "WHERE (id = ? OR slug = ?)\n        AND (state = 'PUBLISHED' OR owner_user_id = ?)",
    )
    expect(detailPage).toContain('renderLegacyContentRoute(contentId)')
    expect(publicRoutes).toContain("if (!content || content.state !== 'PUBLISHED') notFound()")
    expect(detailClient).toContain("if (!response.ok || !data?.id || data.state !== 'PUBLISHED')")
  })

  it('locks the immutable content type after a draft exists', () => {
    const publisher = read('src/app/(frontend)/publish/PublishComposer.tsx')
    expect(publisher).toContain('disabled={busy || reviewLocked || Boolean(draft)}')
    expect(publisher).toContain('草稿创建后内容类型不可变更')
    expect(publisher).toContain('需要更换类型请新建内容')
  })

  it('keeps autosave and manual save on the same authoritative content mutation path', () => {
    const publisher = read('src/app/(frontend)/publish/PublishComposer.tsx')
    expect(publisher).toContain("method: isUpdate ? 'PATCH' : 'POST'")
    expect(publisher).toContain("const isUpdate = Boolean(currentDraft?.id && currentDraft.etag)")
    expect(publisher).toContain("rollbackBodyAssetId = uploadedBody.id")
    expect(publisher).toContain("if (rollbackBodyAssetId) await cleanupUploadedBodyAsset(rollbackBodyAssetId)")
    expect(publisher).toContain("rollbackBodyAssetId = null")
    expect(publisher).toContain("Idempotency-Key': crypto.randomUUID()")
  })
})
