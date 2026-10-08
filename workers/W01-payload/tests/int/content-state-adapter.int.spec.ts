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

describe('1.1 content lifecycle closeout', () => {
  it('wires the complete creator lifecycle from draft creation through review and public delivery', () => {
    const publisher = read('src/app/(frontend)/publish/PublishComposer.tsx')
    const creatorCreate = read('src/app/(payload)/api/creator/contents/route.ts')
    const creatorState = read('src/app/(payload)/api/creator/contents/[contentId]/state/route.ts')
    const publicState = read('src/app/api/v1/contents/[contentId]/state/route.ts')
    const creatorList = read('src/app/(payload)/v1beta/CreatorContentList.tsx')
    const publicDetail = read('src/app/(frontend)/content/[contentId]/page.tsx')
    const publicDetailClient = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    const w03Client = read('src/content/w03-content-client.ts')
    const w03Runtime = readFileSync(
      resolve(process.cwd(), '../W03-content/src/content-runtime.ts'),
      'utf8',
    )

    expect(publisher).toContain("contentBasePath = '/api/v1/contents'")
    expect(publisher).toContain("contentBasePath + '/' + encodeURIComponent(savedDraft.id) + '/state'")
    expect(publisher).toContain("JSON.stringify({ to: 'PENDING_REVIEW', preflight: input })")
    expect(publisher).toContain("'If-Match': savedDraft.etag")
    expect(publisher).toContain("'Idempotency-Key': crypto.randomUUID()")
    expect(publisher).toContain("window.dispatchEvent(new Event(CONTENT_MUTATED_EVENT))")

    expect(creatorCreate).toContain("pathname: '/internal/content/contents'")
    expect(creatorCreate).toContain("method: 'POST'")
    expect(creatorCreate).toContain('resolveCookieContentPrincipal')

    expect(creatorState).toContain("/internal/content/contents/")
    expect(creatorState).toContain("/state")
    expect(creatorState).toContain("requireStatePreconditions")
    expect(creatorState).toContain("invalidatePublicContentDetail(request, contentId)")
    expect(creatorState).toContain("invalidatePublicContentList(request)")

    expect(publicState).toContain("resolveContentPrincipal")
    expect(publicState).toContain("/internal/content/contents/")
    expect(publicState).toContain("/state")
    expect(publicState).toContain("invalidatePublicContentDetail(request, contentId)")
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

    expect(publicDetail).toContain("state !== 'PUBLISHED'")
    expect(publicDetail).toContain("cachedPublicGet")
    expect(publicDetail).toContain("permanentRedirect('/content/' + encodeURIComponent(content.slug))")
    expect(publicDetailClient).toContain("fetch(resolved.bodyRef")
    expect(publicDetailClient).toContain("<ArticleStructuredRenderer document={structuredArticle} />")

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
    const detailPage = read('src/app/(frontend)/content/[contentId]/page.tsx')
    const detailClient = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')

    expect(runtime).toContain(
      "WHERE (id = ? OR slug = ?)\n        AND (state = 'PUBLISHED' OR owner_user_id = ?)",
    )
    expect(detailPage).toContain("if (!content || content.state !== 'PUBLISHED')")
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
    expect(publisher).toContain("const isUpdate = Boolean(draft?.id && draft.etag)")
    expect(publisher).toContain("rollbackBodyAssetId = uploadedBody.id")
    expect(publisher).toContain("if (rollbackBodyAssetId) await cleanupUploadedBodyAsset(rollbackBodyAssetId)")
    expect(publisher).toContain("rollbackBodyAssetId = null")
    expect(publisher).toContain("Idempotency-Key': crypto.randomUUID()")
  })
})
