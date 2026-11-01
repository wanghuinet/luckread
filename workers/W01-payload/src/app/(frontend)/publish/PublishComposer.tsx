'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { computeAutoSaveDelay } from '../../../lib/content-autosave.js'
import { apiFetch, fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import { articleDocumentFromBody, plainTextFromArticleDocument, mediaRefsFromArticleDocument, removeMediaRefFromArticleDocument, serializeArticleDocument, createArticleDocument, tryDeserializeArticleDocument, type ArticleDocument } from '../../../lib/article-document.js'
import ArticleStructuredEditor from '../../../components/ArticleStructuredEditor.js'
import ArticleStructuredRenderer from '../../../components/ArticleStructuredRenderer.js'
import { articleEditorPlugins } from '../../../components/article-editor-plugins.js'
import { useRouter } from 'next/navigation'

type ContentType = 'article' | 'post' | 'video'
type AiMode = 'none' | 'outline' | 'assist' | 'full'

type PublishPreflightResult = {
  verdict: 'PASS' | 'YELLOW' | 'RED'
  score: number
  seoReadiness: 'READY' | 'IMPROVE' | 'BLOCKED'
  summary: string
  findings: Array<{ severity: 'INFO' | 'WARN' | 'BLOCK'; category: string; title: string; message: string; fix: string }>
  analyzed: {
    titleChars: number
    bodyChars: number
    paragraphCount: number
    headingCount: number
    externalUrlCount: number
    phoneCount: number
    mobileNumberCount: number
    detectedPhoneRegions: string[]
    messengerIdCount: number
    detectedMessengers: string[]
  }
}

type UploadedAsset = {
  id: string
  url: string
  filename?: string
  mimeType: string
}

type VideoMetadata = {
  duration: number
  width: number
  height: number
}

type ContentResponse = {
  id: string
  slug?: string
  state: string
  version: number
  etag: string
  contentType?: ContentType
  title?: string
  bodyRef?: string
  mediaRefs?: string[]
  coverRef?: string | null
}

type PollOptionView = { optionId: string; text: string; position: number; votes: number }
type DraftPoll = { options: PollOptionView[]; durationHours: 24 | 72 | 168 }
type PollApiResponse = { data?: { poll?: { options?: PollOptionView[]; durationHours?: number } | null }; error?: { message?: string } }

const CONTENT_MUTATED_EVENT = 'luckread:content-mutated'

async function authorizedFetch<T = unknown>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<{ response: Response; data: T | null }> {
  const result = await fetchJson<T>(input, {
    ...init,
    credentials: 'include',
  })
  if (result.response.status === 401) throw new Error('AUTH_REQUIRED')
  return result
}


type ApiFailureEnvelope = {
  requestId?: unknown
  error?: { code?: unknown; message?: unknown }
}

function getApiFailureDiagnostic(response: Response, data: unknown, fallback: string): string {
  const envelope = data && typeof data === 'object' && !Array.isArray(data)
    ? data as ApiFailureEnvelope
    : null
  const code = typeof envelope?.error?.code === 'string' ? envelope.error.code : ''
  const requestId = typeof envelope?.requestId === 'string' ? envelope.requestId : ''
  const serverMessage = getApiErrorMessage(data, fallback)
  const statusHint = response.status === 413
    ? '请压缩文件或选择较小的文件'
    : response.status === 415
      ? '请确认文件格式受支持'
      : response.status === 429
        ? '请求过于频繁，请稍后重试'
        : response.status >= 500
          ? '服务暂时不可用，请稍后重试'
          : ''
  const message = statusHint ? serverMessage + '；' + statusHint : serverMessage
  const diagnostics = [
    'HTTP ' + response.status,
    code || null,
    requestId ? '请求 ID ' + requestId : null,
  ].filter((part): part is string => Boolean(part))
  return message + '（' + diagnostics.join('；') + '）'
}

const isVideoAsset = (asset: UploadedAsset): boolean => asset.mimeType.startsWith('video/')
const isImageAsset = (asset: UploadedAsset): boolean => asset.mimeType.startsWith('image/')

const formatVideoDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const remaining = total % 60
  const hours = Math.floor(minutes / 60)
  const minutePart = hours > 0 ? minutes % 60 : minutes
  return hours > 0
    ? hours + ':' + String(minutePart).padStart(2, '0') + ':' + String(remaining).padStart(2, '0')
    : minutePart + ':' + String(remaining).padStart(2, '0')
}

const inferRestoredMediaType = (url: string, contentType: ContentType): string => {
  if (contentType === 'article') return 'image/*'
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  })()
  return /\.(?:mp4|webm|mov|m4v|avi|mkv)(?:$|[?#])/.test(pathname) ? 'video/*' : 'image/*'
}

const resolveCoverRef = (
  type: ContentType,
  assets: UploadedAsset[],
  explicitCoverRef: string,
  fallbackRefs: string[] = [],
): string | null => {
  const explicit = explicitCoverRef.trim()
  if (explicit) return explicit
  if (type === 'video') return assets.find(isImageAsset)?.url ?? null
  return fallbackRefs[0] ?? assets[0]?.url ?? null
}

type ReplyAudience = 'everyone' | 'verified' | 'following' | 'mentioned' | 'followingNetwork'
type ReplyAudienceApiResponse = { data?: { replyAudience?: unknown }; error?: { message?: string } }
const isReplyAudience = (value: unknown): value is ReplyAudience =>
  value === 'everyone' || value === 'verified' || value === 'following' || value === 'mentioned' || value === 'followingNetwork'

type CurrentProfile = {
  id: string
  username: string
  displayName: string | null
  avatar: string | null
}

const REPLY_AUDIENCE_OPTIONS: ReadonlyArray<{
  value: ReplyAudience
  label: string
  description: string
}> = [
  { value: 'everyone', label: '每个人', description: '所有账号都可以回复' },
  { value: 'verified', label: '认证账号', description: '只有认证账号可以回复' },
  { value: 'following', label: '你关注的账号', description: '只有你关注的账号可以回复' },
  { value: 'mentioned', label: '只有你提及的账号', description: '只有你在帖子中提及的账号可以回复' },
  { value: 'followingNetwork', label: '你关注的账号及其关注的账号', description: '你关注的账号及其关注的账号可以回复' },
]

const replyAudienceLabels: Record<ReplyAudience, string> = {
  everyone: '所有人可以回复',
  verified: '认证账号可以回复',
  following: '你关注的账号可以回复',
  mentioned: '只有你提及的账号可以回复',
  followingNetwork: '你关注的账号及其关注的账号可以回复',
}

type PublishComposerProps = {
  contentBasePath?: string
  initialType?: ContentType
  presentation?: 'workspace' | 'tweet-modal' | 'x-workspace'
  onClose?: () => void
}

export default function PublishComposer({
  contentBasePath = '/api/v1/contents',
  initialType = 'article',
  presentation = 'workspace',
  onClose,
}: PublishComposerProps) {
  const router = useRouter()
  const isTweetModal = presentation === 'tweet-modal'
  const isXWorkspace = presentation === 'x-workspace'
  const xButtonBase = 'main-tab inline-flex min-h-10 items-center justify-center rounded-full px-4 py-2 text-sm font-bold transition hover:bg-light-primary/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5'
  const xButtonSecondary = xButtonBase + ' border border-light-border text-light-primary dark:border-dark-border dark:text-dark-primary'
  const xButtonGhost = xButtonBase + ' text-light-secondary dark:text-dark-secondary'
  const xButtonPrimary = 'inline-flex min-h-10 items-center justify-center rounded-full bg-main-accent px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50'
  const xButtonDanger = xButtonBase + ' border border-red-500/50 text-red-600 dark:text-red-400'
  const [type, setType] = useState<ContentType>(initialType)
  const [profile, setProfile] = useState<CurrentProfile | null>(null)
  const [replyAudience, setReplyAudience] = useState<ReplyAudience>('everyone')
  const [replyAudienceOpen, setReplyAudienceOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [articleDocument, setArticleDocument] = useState<ArticleDocument>(() => createArticleDocument())
  const [savedArticleSerialized, setSavedArticleSerialized] = useState('')
  const [assets, setAssets] = useState<UploadedAsset[]>([])
  const modalMediaInputRef = useRef<HTMLInputElement>(null)
  const [coverRef, setCoverRef] = useState('')
  const [pollEnabled, setPollEnabled] = useState(false)
  // Only call W05 to remove a poll if this draft actually has a persisted poll.
  // New text/video posts must not depend on an optional poll route being deployed.
  const pollConfiguredRef = useRef(false)
  const [pollOptions, setPollOptions] = useState<string[]>(['', ''])
  const [pollDurationHours, setPollDurationHours] = useState<24 | 72 | 168>(24)
  const [videoMetadataByAssetId, setVideoMetadataByAssetId] = useState<Record<string, VideoMetadata>>({})
  const [draft, setDraft] = useState<ContentResponse | null>(null)
  // Keep the latest server etag outside render closures so a publish queued behind autosave uses the new version.
  const latestDraftRef = useRef<ContentResponse | null>(null)
  const [savedBody, setSavedBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [preview, setPreview] = useState(false)
  const [aiMode, setAiMode] = useState<AiMode>('none')
  const [humanConfirmed, setHumanConfirmed] = useState(false)
  const [preflightReport, setPreflightReport] = useState<PublishPreflightResult | null>(null)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'scheduled' | 'saving' | 'saved' | 'error'>('idle')
  const autoSaveTimerRef = useRef<number | null>(null)
  const autoSaveInFlightRef = useRef(false)
  const autoSaveInFlightPromiseRef = useRef<Promise<void> | null>(null)
  const autoSaveLastSavedAtRef = useRef<number | null>(null)
  const autoSaveChangeTokenRef = useRef(0)
  const autoSaveDirtyRef = useRef(false)
  const restoreCompleteRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const draftId = new URL(window.location.href).searchParams.get('draft')?.trim()
    if (!draftId) {
      restoreCompleteRef.current = true
      return
    }

    async function restoreDraft() {
      setBusy(true)
      setError('')
      setMessage('正在恢复草稿…')
      try {
        const { response, data } = await authorizedFetch<ContentResponse | { error?: { message?: string } }>(
          `${contentBasePath}/${encodeURIComponent(draftId)}`,
          { method: 'GET', signal: controller.signal },
        )
        if (!response.ok || !data || !('id' in data) || !data.id || !('etag' in data) || !data.etag) {
          throw new Error(getApiErrorMessage(data, 'DRAFT_RECOVERY_FAILED'))
        }
        const recovered = data as ContentResponse
        let recoveredReplyAudience: ReplyAudience = 'everyone'
        if ((recovered.contentType ?? 'article') === 'post') {
          const policy = await authorizedFetch<ReplyAudienceApiResponse>(
            '/api/v1/contents/' + encodeURIComponent(recovered.id) + '/reply-audience',
            { method: 'GET', signal: controller.signal, headers: { accept: 'application/json' } },
          )
          if (!policy.response.ok || !isReplyAudience(policy.data?.data?.replyAudience)) {
            throw new Error(getApiErrorMessage(policy.data, 'REPLY_AUDIENCE_RECOVERY_FAILED'))
          }
          recoveredReplyAudience = policy.data.data.replyAudience
        }
        let recoveredBody = ''
        if (recovered.bodyRef) {
          const bodyResponse = await apiFetch(recovered.bodyRef, {
            method: 'GET',
            credentials: 'same-origin',
            signal: controller.signal,
          })
          if (bodyResponse.ok) recoveredBody = await bodyResponse.text()
        }
        let recoveredPoll: DraftPoll | null = null
        if ((recovered.contentType ?? 'article') === 'post') {
          const pollResult = await authorizedFetch<PollApiResponse>(
            '/api/v1/contents/' + encodeURIComponent(recovered.id) + '/poll',
            { method: 'GET', signal: controller.signal, headers: { accept: 'application/json' } },
          )
          const poll = pollResult.response.ok ? pollResult.data?.data?.poll : null
          if (poll && Array.isArray(poll.options) && [24, 72, 168].includes(Number(poll.durationHours))) {
            recoveredPoll = {
              options: poll.options,
              durationHours: Number(poll.durationHours) as 24 | 72 | 168,
            }
          }
        }
        if (cancelled) return
        latestDraftRef.current = recovered
        setDraft(recovered)
        setType(recovered.contentType ?? 'article')
        setReplyAudience(recoveredReplyAudience)
        setTitle(recovered.title ?? '')
        if ((recovered.contentType ?? 'article') === 'article') {
          const recoveredDocument = articleDocumentFromBody(recoveredBody)
          const wasStructured = tryDeserializeArticleDocument(recoveredBody) !== null
          setArticleDocument(recoveredDocument)
          const recoveredPlainText = plainTextFromArticleDocument(recoveredDocument)
          setBody(recoveredPlainText)
          setSavedBody(recoveredPlainText)
          setSavedArticleSerialized(wasStructured ? serializeArticleDocument(recoveredDocument) : '')
        } else {
          setBody(recoveredBody)
          setSavedBody(recoveredBody)
          setSavedArticleSerialized('')
        }
        setCoverRef(recovered.coverRef ?? '')
        pollConfiguredRef.current = Boolean(recoveredPoll)
        setPollEnabled(Boolean(recoveredPoll))
        setPollOptions(recoveredPoll ? recoveredPoll.options.map((option) => option.text) : ['', ''])
        setPollDurationHours(recoveredPoll?.durationHours ?? 24)
        setAssets((recovered.mediaRefs ?? []).map((url: string) => ({
          id: url,
          url,
          filename: '已关联媒体',
          mimeType: inferRestoredMediaType(url, recovered.contentType ?? 'article'),
        })))
        setMessage(recovered.state === 'PENDING_REVIEW' ? '草稿已恢复，当前正在审核。' : '草稿已恢复。')
        restoreCompleteRef.current = true
      } catch (caught) {
        if (cancelled || controller.signal.aborted) return
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        const code = caught instanceof Error ? caught.message : ''
        setError(code === 'AUTH_REQUIRED' ? '登录已失效，请重新登录。' : '草稿恢复失败，请检查链接或稍后重试。')
        setMessage('')
        if (code === 'AUTH_REQUIRED') {
          const returnTo = window.location.pathname + window.location.search + window.location.hash
          router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    void restoreDraft()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [contentBasePath, router])

  
async function cleanupUploadedBodyAsset(mediaId: string): Promise<void> {
  await apiFetch('/api/v1/media/' + encodeURIComponent(mediaId), {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Idempotency-Key': 'content-body-cleanup:' + mediaId + ':' + crypto.randomUUID() },
  }).catch((): undefined => undefined)
}

async function uploadFile(file: File): Promise<UploadedAsset> {
    const form = new FormData()
    form.append('_payload', JSON.stringify({ alt: file.name }))
    form.append('file', file)
    const { response, data } = await authorizedFetch<{
      doc?: { id?: string | number; url?: string; filename?: string }
      id?: string | number
      url?: string
      filename?: string
      error?: { message?: string }
    }>('/api/v1/media', {
      method: 'POST',
      body: form,
      headers: { 'Idempotency-Key': 'media-upload:' + crypto.randomUUID() },
    })
    const doc = data?.doc ?? data
    if (!response.ok) {
      throw new Error(getApiFailureDiagnostic(response, data, 'MEDIA_UPLOAD_FAILED'))
    }
    if (!doc?.id || !doc?.url) {
      throw new Error(getApiFailureDiagnostic(response, data, '上传接口未返回完整的媒体信息'))
    }
    return {
      id: String(doc.id),
      url: String(doc.url),
      filename: typeof doc.filename === 'string' ? doc.filename : file.name,
      mimeType: file.type || 'application/octet-stream',
    }
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    const remainingSlots = Math.max(0, 12 - assets.length)
    const selectedVideoCount = selected.filter((file) => file.type.startsWith('video/')).length
    const existingVideoCount = assets.filter(isVideoAsset).length
    if (type === 'video' && selectedVideoCount + existingVideoCount > 1) {
      setError('短视频只能包含一个主视频；请先移除现有视频后再更换。')
      event.target.value = ''
      return
    }
    if (!selected.length || remainingSlots === 0) {
      setError(remainingSlots === 0 ? '最多添加 12 个媒体文件。' : '')
      return
    }
    setError('')
    setMessage('正在上传媒体…')
    try {
      const uploaded: UploadedAsset[] = []
      for (const file of selected.slice(0, remainingSlots)) uploaded.push(await uploadFile(file))
      setAssets((current) => [...current, ...uploaded])
      if (!coverRef.trim() && type === 'video') {
        const firstImage = uploaded.find(isImageAsset)
        if (firstImage) setCoverRef(firstImage.url)
      }
      markDirty()
      setMessage(`已上传 ${uploaded.length} 个媒体文件`)
      if (selected.length > remainingSlots) setError('已达到 12 个媒体文件上限，其余文件未上传。')
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : ''
      if (code === 'AUTH_REQUIRED') {
        setError('登录已失效，请重新登录后再上传。')
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        const loginPath = window.location.pathname.startsWith('/admin/') ? '/admin/login' : '/login'
        router.replace(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
      } else {
        setError(code || '媒体上传失败，请检查文件后重试。')
      }
      setMessage('')
    } finally {
      event.target.value = ''
    }
  }

  function removeAsset(id: string) {
    const removed = assets.find((asset) => asset.id === id)
    setAssets((current) => current.filter((asset) => asset.id !== id))
    if (removed) {
      setVideoMetadataByAssetId((current) => {
        if (!current[removed.id]) return current
        const next = { ...current }
        delete next[removed.id]
        return next
      })
      const nextDocument = type === 'article'
        ? removeMediaRefFromArticleDocument(articleDocument, removed.url)
        : articleDocument
      if (nextDocument !== articleDocument) {
        setArticleDocument(nextDocument)
        setBody(plainTextFromArticleDocument(nextDocument))
        setPreflightReport(null)
      }

      if (coverRef.trim() === removed.url) {
        const fallback = type === 'video'
          ? assets.find((asset) => asset.id !== id && isImageAsset(asset))?.url ?? ''
          : assets.find((asset) => asset.id !== id)?.url ?? ''
        setCoverRef(fallback)
      }
    }
    markDirty()
  }

  const reviewLocked = draft?.state === 'PENDING_REVIEW' || (type === 'post' && draft?.state === 'PUBLISHED')

  const stateLabel = draft?.state === 'DRAFT'
    ? '草稿已保存'
    : draft?.state === 'PENDING_REVIEW'
      ? '审核中'
      : draft?.state === 'REJECTED'
        ? '审核退回'
        : draft?.state === 'PUBLISHED'
          ? '已发布'
          : draft?.state

  const effectiveContentTitle = (): string =>
    type === 'post' ? body.trim().slice(0, 500) : title.trim()

  const hasPublishableText = (): boolean =>
    Boolean(effectiveContentTitle() && body.trim())

  const readValidPollOptions = (): string[] | null => {
    if (!pollEnabled) return null
    const options = pollOptions.map((option) => option.trim().normalize('NFKC'))
    if (options.length < 2 || options.length > 4 || options.some((option) => !option || [...option].length > 50)) return null
    const normalized = options.map((option) => option.toLocaleLowerCase('en-US'))
    if (new Set(normalized).size !== normalized.length) return null
    return options
  }

  function assertPollConfigurationValid() {
    if (pollEnabled && !readValidPollOptions()) {
      throw new Error('投票需要填写 2–4 个不重复的选项，每项最多 50 个字符。')
    }
  }

  async function syncDraftReplyAudience(contentId: string) {
    if (type !== 'post') return
    const { response, data } = await authorizedFetch<ReplyAudienceApiResponse>(
      '/api/v1/contents/' + encodeURIComponent(contentId) + '/reply-audience',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'reply-audience:' + contentId + ':' + crypto.randomUUID(),
        },
        body: JSON.stringify({ replyAudience, text: body }),
      },
    )
    if (!response.ok || !isReplyAudience(data?.data?.replyAudience)) {
      throw new Error(getApiErrorMessage(data, '回复权限保存失败，请稍后重试。'))
    }
  }

  async function syncDraftPoll(contentId: string, strict = true) {
    if (type !== 'post') return
    if (pollEnabled) {
      const options = readValidPollOptions()
      if (!options) {
        if (strict) assertPollConfigurationValid()
        return
      }
      const { response, data } = await authorizedFetch<PollApiResponse>(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/poll',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Idempotency-Key': 'social-poll-config:' + contentId + ':' + crypto.randomUUID(),
          },
          body: JSON.stringify({ options, durationHours: pollDurationHours }),
        },
      )
      if (!response.ok) throw new Error(getApiErrorMessage(data, '投票保存失败，请稍后重试。'))
      pollConfiguredRef.current = true
      return
    }
    if (!pollConfiguredRef.current) return
    const { response, data } = await authorizedFetch<{ error?: { message?: string } }>(
      '/api/v1/contents/' + encodeURIComponent(contentId) + '/poll',
      {
        method: 'DELETE',
        headers: { 'Idempotency-Key': 'social-poll-remove:' + contentId + ':' + crypto.randomUUID() },
      },
    )
    if (!response.ok) throw new Error(getApiErrorMessage(data, '移除投票失败，请稍后重试。'))
    pollConfiguredRef.current = false
  }

  async function persistDraft(): Promise<ContentResponse> {
    const currentDraft = latestDraftRef.current
    let bodyRef = currentDraft?.bodyRef
    let nextSavedArticleSerialized: string | null = null
    let rollbackBodyAssetId: string | null = null

    try {
      if (type === 'article') {
        const serialized = serializeArticleDocument(articleDocument)
        if (!bodyRef || savedArticleSerialized !== serialized) {
          const bodyFile = new File(
            [serialized],
            `luckread-article-${crypto.randomUUID()}.json`,
            { type: 'application/json;charset=utf-8' },
          )
          const uploadedBody = await uploadFile(bodyFile)
          bodyRef = uploadedBody.url
          rollbackBodyAssetId = uploadedBody.id
          nextSavedArticleSerialized = serialized
        }
      } else if (!bodyRef || savedBody !== body) {
        const bodyFile = new File(
          [body],
          `luckread-content-${crypto.randomUUID()}.txt`,
          { type: 'text/plain;charset=utf-8' },
        )
        const uploadedBody = await uploadFile(bodyFile)
        bodyRef = uploadedBody.url
        rollbackBodyAssetId = uploadedBody.id
        setSavedArticleSerialized('')
      }

      const payload = {
        contentType: type,
        title: effectiveContentTitle(),
        bodyRef,
        mediaRefs: Array.from(new Set([
          ...assets.map((asset) => asset.url),
          ...(type === 'article' ? mediaRefsFromArticleDocument(articleDocument) : []),
        ])),
        coverRef: resolveCoverRef(
          type,
          assets,
          coverRef,
          type === 'article' ? mediaRefsFromArticleDocument(articleDocument) : [],
        ),
      }

      const isUpdate = Boolean(currentDraft?.id && currentDraft.etag)
      const { response, data } = await authorizedFetch<ContentResponse | { error?: { message?: string } }>(
        isUpdate
          ? `${contentBasePath}/${encodeURIComponent(currentDraft!.id)}`
          : contentBasePath,
        {
          method: isUpdate ? 'PATCH' : 'POST',
          headers: {
            'content-type': 'application/json',
            ...(isUpdate ? { 'If-Match': currentDraft!.etag } : {}),
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify(payload),
        },
      )

      if (!response.ok) {
        throw new Error(getApiFailureDiagnostic(response, data, 'CONTENT_SAVE_FAILED'))
      }

      // Once the content write has returned success, the body asset is now an
      // authoritative reference. Do not roll it back even if local state handling
      // fails afterward.
      rollbackBodyAssetId = null

      const saved = data && 'id' in data ? data : null
      if (!saved?.id || !saved.etag) throw new Error('CONTENT_SAVE_FAILED')

      latestDraftRef.current = saved
      setDraft(saved)
      setSavedBody(body)
      if (nextSavedArticleSerialized !== null) setSavedArticleSerialized(nextSavedArticleSerialized)
      autoSaveLastSavedAtRef.current = Date.now()
      if (!isTweetModal) {
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.set('draft', saved.id)
        window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash)
      }
      return saved
    } catch (error) {
      if (rollbackBodyAssetId) await cleanupUploadedBodyAsset(rollbackBodyAssetId)
      throw error
    }
  }

  function markDirty() {
    if (!restoreCompleteRef.current) return
    autoSaveChangeTokenRef.current += 1
    autoSaveDirtyRef.current = true
  }

  function handleContentTypeChange(nextType: ContentType) {
    if (nextType === type) return
    if (nextType === 'article') {
      const existingArticleText = plainTextFromArticleDocument(articleDocument).trim()
      const nextDocument = existingArticleText
        ? articleDocument
        : articleDocumentFromBody(body)
      setArticleDocument(nextDocument)
      setBody(plainTextFromArticleDocument(nextDocument))
    } else if (type === 'article') {
      setBody(plainTextFromArticleDocument(articleDocument))
    }
    setType(nextType)
    if (nextType === 'video' && !coverRef.trim()) {
      const firstImage = assets.find(isImageAsset)
      if (firstImage) setCoverRef(firstImage.url)
    }
    setPreflightReport(null)
    markDirty()
  }

  function cancelPendingAutoSave() {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    autoSaveChangeTokenRef.current += 1
  }

  function scheduleAutoSave() {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (!restoreCompleteRef.current || !autoSaveDirtyRef.current || reviewLocked || !hasPublishableText()) {
      setAutoSaveStatus('idle')
      return
    }

    const changeToken = autoSaveChangeTokenRef.current
    const delay = computeAutoSaveDelay(Date.now(), autoSaveLastSavedAtRef.current)
    setAutoSaveStatus('scheduled')
    autoSaveTimerRef.current = window.setTimeout(async () => {
      autoSaveTimerRef.current = null
      if (
        changeToken !== autoSaveChangeTokenRef.current ||
        autoSaveInFlightRef.current ||
        busy ||
        !autoSaveDirtyRef.current ||
        !hasPublishableText() ||
        reviewLocked
      ) {
        return
      }

      autoSaveInFlightRef.current = true
      setAutoSaveStatus('saving')
      const autoSaveTask = (async () => {
        try {
          const autoSavedDraft = await persistDraft()
          await syncDraftPoll(autoSavedDraft.id, false)
          await syncDraftReplyAudience(autoSavedDraft.id)
          autoSaveLastSavedAtRef.current = Date.now()
          if (changeToken === autoSaveChangeTokenRef.current) {
            autoSaveDirtyRef.current = false
            setAutoSaveStatus('saved')
          }
        } catch {
          setAutoSaveStatus('error')
        } finally {
          autoSaveInFlightRef.current = false
          if (
            autoSaveDirtyRef.current &&
            changeToken !== autoSaveChangeTokenRef.current &&
            !reviewLocked
          ) {
            scheduleAutoSave()
          }
        }
      })()
      autoSaveInFlightPromiseRef.current = autoSaveTask
      try {
        await autoSaveTask
      } finally {
        if (autoSaveInFlightPromiseRef.current === autoSaveTask) {
          autoSaveInFlightPromiseRef.current = null
        }
      }
    }, delay)
  }

  const autoSaveSchedulerRef = useRef<() => void>(() => {})

  useEffect(() => {
    autoSaveSchedulerRef.current = scheduleAutoSave
  }, [scheduleAutoSave])

  useEffect(() => {
    if (autoSaveDirtyRef.current) autoSaveSchedulerRef.current()
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [title, body, type, assets, coverRef, busy, articleDocument, pollEnabled, pollOptions, pollDurationHours, replyAudience])

  function startNewContent() {
    latestDraftRef.current = null
    setDraft(null)
    setSavedBody('')
    setSavedArticleSerialized('')
    setArticleDocument(createArticleDocument())
    setTitle('')
    setBody('')
    setAssets([])
    setCoverRef('')
    setReplyAudience('everyone')
    pollConfiguredRef.current = false
    setPollEnabled(false)
    setPollOptions(['', ''])
    setPollDurationHours(24)
    setPreview(false)
    setCopied(false)
    cancelPendingAutoSave()
    autoSaveDirtyRef.current = false
    autoSaveLastSavedAtRef.current = null
    setAutoSaveStatus('idle')
    if (!isTweetModal) {
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.delete('draft')
      window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash)
    }
    setMessage('已准备新的内容草稿。')
    setError('')
  }

  async function copyDraftLink() {
    if (!draft?.id) return
    const url = new URL(window.location.href)
    url.searchParams.set('draft', draft.id)
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      setMessage('草稿恢复链接已复制。登录后可在其他设备继续编辑。')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('无法复制链接，请从地址栏复制当前页面地址。')
    }
  }

  async function runPreflight(): Promise<{ report: PublishPreflightResult | null; input: Record<string, unknown>; draft: ContentResponse }> {
    if (autoSaveInFlightRef.current) {
      const pendingAutoSave = autoSaveInFlightPromiseRef.current
      if (pendingAutoSave) await pendingAutoSave
      // The completed autosave can queue a retry if the user edited while it was running.
      // Cancel that timer before writing the latest form state for publication.
      cancelPendingAutoSave()
    }
    assertPollConfigurationValid()
    if (!hasPublishableText()) {
      throw new Error(type === 'post' ? '请先填写动态正文。' : '请先填写标题和正文。')
    }
    if (type === 'video') {
      const videoAssets = assets.filter(isVideoAsset)
      if (videoAssets.length === 0) throw new Error('短视频至少需要添加一个视频素材。')
      if (videoAssets.length > 1) throw new Error('短视频只能提交一个主视频，请移除多余视频后再提交。')
    }

    const savedDraft = await persistDraft()
    await syncDraftPoll(savedDraft.id)
    await syncDraftReplyAudience(savedDraft.id)
    autoSaveDirtyRef.current = false
    autoSaveLastSavedAtRef.current = Date.now()
    setAutoSaveStatus('saved')
    const input = {
      contentType: type,
      title: effectiveContentTitle(),
      body,
      mediaRefs: Array.from(new Set([
        ...assets.map((asset) => asset.url),
        ...(type === 'article' ? mediaRefsFromArticleDocument(articleDocument) : []),
      ])),
      coverRef: resolveCoverRef(
        type,
        assets,
        coverRef,
        type === 'article' ? mediaRefsFromArticleDocument(articleDocument) : [],
      ),
      ...(type === 'article' ? {
        aiMode,
        humanContribution: humanConfirmed ? 'substantial' : 'light',
      } : {}),
    }
    if (type === 'post') {
      // Social posts use W03's direct-publish transition, which re-runs the
      // authoritative preflight against stored content. Do not call the
      // creator-only editorial preflight route for ordinary social authors.
      setPreflightReport(null)
      return { report: null, input, draft: savedDraft }
    }

    const preflightBasePath = contentBasePath === '/api/v1/contents'
      ? '/api/creator/contents'
      : contentBasePath
    const { response, data: report } = await authorizedFetch<PublishPreflightResult | { error?: { message?: string } }>(
      preflightBasePath + '/' + encodeURIComponent(savedDraft.id) + '/preflight',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    )
    if (!response.ok || !report || !('verdict' in report) || !report.verdict) {
      throw new Error(getApiFailureDiagnostic(response, report, '发布前检查失败，请稍后重试。'))
    }
    setPreflightReport(report)
    return { report, input, draft: savedDraft }
  }



  async function saveDraft() {
    if (autoSaveInFlightRef.current) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (!hasPublishableText()) {
        setError(type === 'post' ? '请先填写动态正文。' : '请先填写标题和正文。')
        return
      }
      if (type === 'video' && !assets.some(isVideoAsset)) {
        setError('短视频至少需要添加一个视频素材。')
        return
      }
      assertPollConfigurationValid()
      const savedChangeToken = autoSaveChangeTokenRef.current
      const savedDraft = await persistDraft()
      await syncDraftPoll(savedDraft.id)
      await syncDraftReplyAudience(savedDraft.id)
      if (savedChangeToken === autoSaveChangeTokenRef.current) {
        autoSaveDirtyRef.current = false
        autoSaveLastSavedAtRef.current = Date.now()
        setAutoSaveStatus('saved')
      }
      window.dispatchEvent(new Event(CONTENT_MUTATED_EVENT))
      setMessage('草稿已保存。')
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : ''
      setError(code === 'AUTH_REQUIRED' ? '登录已失效，请重新登录。' : '草稿保存失败，请稍后重试。')
      if (code === 'AUTH_REQUIRED') {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function discardDraft() {
    if (!draft?.id || draft.state !== 'DRAFT') return
    if (!window.confirm('确定放弃这份草稿吗？此操作不可撤销。')) return

    cancelPendingAutoSave()
    autoSaveDirtyRef.current = false
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (type === 'post') {
        const pollResult = await authorizedFetch<{ error?: { message?: string } }>(
          '/api/v1/contents/' + encodeURIComponent(draft.id) + '/poll',
          { method: 'DELETE', headers: { 'Idempotency-Key': 'social-poll-discard:' + draft.id + ':' + crypto.randomUUID() } },
        )
        if (!pollResult.response.ok) throw new Error(getApiErrorMessage(pollResult.data, '投票清理失败。'))
      }
      const { response, data } = await authorizedFetch<{ error?: { message?: string } }>(
        contentBasePath + '/' + encodeURIComponent(draft.id),
        {
          method: 'DELETE',
          headers: {
            'If-Match': draft.etag,
            'Idempotency-Key': crypto.randomUUID(),
          },
        },
      )
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'CONTENT_DELETE_FAILED'))
      }
      latestDraftRef.current = null
      setDraft(null)
      setSavedBody('')
      setSavedArticleSerialized('')
      setArticleDocument(createArticleDocument())
      setTitle('')
      setBody('')
      setAssets([])
      setCoverRef('')
      if (!isTweetModal) {
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.delete('draft')
        window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash)
      }
      window.dispatchEvent(new Event(CONTENT_MUTATED_EVENT))
      setMessage('草稿已放弃。')
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : ''
      setError(code === 'AUTH_REQUIRED' ? '登录已失效，请重新登录。' : '放弃草稿失败，请稍后重试。')
      if (code === 'AUTH_REQUIRED') {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        const loginPath = window.location.pathname.startsWith('/admin/') ? '/admin/login' : '/login'
        router.replace(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
      }
    } finally {
      setBusy(false)
    }
  }

  async function submitForReview() {
    cancelPendingAutoSave()
    setBusy(true); setError(''); setMessage('')
    try {
      const { report, input, draft: savedDraft } = await runPreflight()
      if (type !== 'post') {
        if (!report) throw new Error('发布前检查未返回结果，请稍后重试。')
        if (report.verdict === 'RED') return
        if (report.verdict === 'YELLOW') {
          const warnings = report.findings.filter((item) => item.severity === 'WARN').slice(0, 4).map((item) => '• ' + item.title).join('\\n')
          if (!window.confirm(report.summary + '\\n\\n建议先处理：\\n' + warnings + '\\n\\n确认仍然提交审核吗？')) return
        }
      }
      const { response, data } = await authorizedFetch<{ to?: string; version?: number; etag?: string; error?: { message?: string } }>(
        contentBasePath + '/' + encodeURIComponent(savedDraft.id) + '/state',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'If-Match': savedDraft.etag,
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({ to: type === 'post' ? 'PUBLISHED' : 'PENDING_REVIEW', preflight: input }),
        },
      )
      if (!response.ok) throw new Error(getApiFailureDiagnostic(response, data, 'SUBMIT_FAILED'))
      const transition = data
      const currentDraft = latestDraftRef.current
      const transitionedDraft = currentDraft && transition.to && typeof transition.version === 'number' && transition.etag
        ? { ...currentDraft, state: transition.to, version: transition.version, etag: transition.etag }
        : currentDraft
      latestDraftRef.current = transitionedDraft
      setDraft(transitionedDraft)
      autoSaveDirtyRef.current = false
      window.dispatchEvent(new Event(CONTENT_MUTATED_EVENT))
      setMessage(type === 'post'
        ? '动态已发布，已进入公开信息流。'
        : '发布前检查通过，已提交审核。审核通过后将进入正式发布状态。')
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : ''
      setError(code === 'AUTH_REQUIRED' ? '登录已失效，请重新登录。' : code || '提交失败，请稍后重试。')
      if (code === 'AUTH_REQUIRED') {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        const loginPath = window.location.pathname.startsWith('/admin/') ? '/admin/login' : '/login'
        router.replace(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
      }
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!isTweetModal) return
    let cancelled = false
    void fetchJson<CurrentProfile>('/api/v1/users/me', {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    }).then(({ response, data }) => {
      if (cancelled) return
      if (response.ok && data?.id && data.username) setProfile(data)
      else setProfile(null)
    }).catch(() => {
      if (!cancelled) setProfile(null)
    })
    return () => { cancelled = true }
  }, [isTweetModal])

  return (
    <div
      className={isTweetModal ? "m-0 flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto rounded-none border-0 bg-black p-0 text-[#e7e9ea] shadow-none" : isXWorkspace ? "min-w-0 bg-main-background text-light-primary dark:text-dark-primary" : "lr-composer-card"}
      aria-busy={busy}
    >
      {isTweetModal ? (
        <header className="sticky top-0 z-20 flex shrink-0 items-center justify-between bg-black px-3.5 py-2.5 text-[#e7e9ea] pt-[max(env(safe-area-inset-top),0.5rem)]">
          <button
            aria-label="关闭发布窗口"
            className="custom-button accent-tab grid h-9 w-9 place-items-center rounded-full text-[#e7e9ea] hover:bg-light-primary/10 dark:hover:bg-dark-primary/10"
            onClick={() => onClose?.()}
            type="button"
          >
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <button
            className="rounded-full accent-tab bg-main-accent px-4 py-1.5 text-[13px] font-bold text-white transition enabled:hover:bg-main-accent/90 enabled:active:bg-main-accent/75 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || autoSaveStatus === 'saving' || reviewLocked || (!body.trim() && assets.length === 0)}
            onClick={submitForReview}
            type="button"
          >
            {busy ? '发布中…' : type === 'post' && draft?.state === 'PUBLISHED' ? '已发布' : '发帖'}
          </button>
        </header>
      ) : null}
      {!isTweetModal ? (
      <div className={isXWorkspace ? "grid grid-cols-3 gap-0 border-b border-light-border dark:border-dark-border" : "lr-type-tabs"} role="tablist" aria-label="内容类型">
        {draft ? <p className={isXWorkspace ? "col-span-3 border-b border-light-border px-4 py-2 text-xs text-light-secondary dark:border-dark-border dark:text-dark-secondary" : "lr-type-lock-note"}>草稿创建后内容类型不可变更；需要更换类型请新建内容。</p> : null}
        {([
          ['article', '文章'],
          ['post', '动态'],
          ['video', '视频'],
        ] as const).map(([value, label]) => (
          <button
            aria-selected={type === value}
            className={isXWorkspace
              ? type === value
                ? "main-tab relative flex min-h-14 items-center justify-center font-bold"
                : "main-tab flex min-h-14 items-center justify-center text-light-secondary dark:text-dark-secondary"
              : type === value ? 'active' : ''}
            key={value}
            disabled={busy || reviewLocked || Boolean(draft)}
            onClick={() => handleContentTypeChange(value)}
            role="tab"
            type="button"
          >
            {label}
            {isXWorkspace && type === value ? <span className="absolute bottom-0 h-1 w-14 rounded-full bg-main-accent" /> : null}
          </button>
        ))}
      </div>
      ) : null}

      {type !== 'post' ? (
        <label className={isXWorkspace ? "mb-4 grid gap-2 px-4 pt-4 text-sm font-semibold text-light-primary dark:text-dark-primary" : "lr-field"}>
          <span>标题</span>
          <input
            className={isXWorkspace ? "w-full rounded-md border border-light-border bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus:border-main-accent focus:ring-1 focus:ring-main-accent/30 dark:border-dark-border dark:text-dark-primary" : undefined}
            maxLength={512}
            disabled={busy || reviewLocked}
            onChange={(event) => { setTitle(event.target.value); markDirty() }}
            placeholder="输入一个清晰、有吸引力的标题"
            value={title}
          />
        </label>
      ) : null}

      {type === 'article' ? (
        <ArticleStructuredEditor
          disabled={busy || reviewLocked}
          plugins={articleEditorPlugins}
          mediaAssets={assets.map((asset) => ({ id: asset.id, url: asset.url, filename: asset.filename, mimeType: asset.mimeType }))}
          onChange={(nextDocument, plainText) => {
            setArticleDocument(nextDocument)
            setBody(plainText)
            setPreflightReport(null)
            markDirty()
          }}
          value={articleDocument}
        />
      ) : (
        <div className={isTweetModal && type === 'post' ? "hover-animation grid w-full grid-cols-[auto,1fr] gap-3 px-4 py-3" : undefined}>
          {isTweetModal && type === 'post' ? (
            <div className="blur-picture flex h-12 w-12 shrink-0 items-center justify-center self-start overflow-hidden bg-[#16181c] text-sm font-semibold text-[#e7e9ea]">
              {profile?.avatar
                ? <img alt="" className="h-full w-full object-cover" src={profile.avatar} />
                : (profile?.displayName?.trim() || profile?.username || 'L').slice(0, 1).toUpperCase()}
            </div>
          ) : null}
          <label className={isTweetModal ? 'm-0 grid min-w-0 flex-1 gap-0' : isXWorkspace ? 'mb-4 grid gap-2 px-4 text-sm font-semibold text-light-primary dark:text-dark-primary' : 'lr-field'}>
            <span className={isTweetModal ? 'sr-only' : undefined}>{type === 'post' ? '推文正文' : '视频文案'}</span>
            <textarea
              aria-label={type === 'post' ? '推文正文' : '视频文案'}
              disabled={busy || reviewLocked}
              maxLength={type === 'post' ? 500 : 160000}
              onChange={(event) => { setBody(event.target.value); markDirty(); setPreflightReport(null) }}
              placeholder={type === 'post' ? '有什么新鲜事？' : '写下你的内容…'}
              rows={type === 'post' ? 5 : 14}
              className={isTweetModal && type === 'post'
                ? 'block min-h-[42dvh] w-full min-w-0 resize-none bg-transparent px-0 py-2 text-xl leading-[1.5] text-[#e7e9ea] outline-none placeholder:text-[#71767b] focus:border-0 focus:ring-0 sm:min-h-[320px]'
                : isXWorkspace
                  ? 'block min-h-32 w-full resize-y rounded-md border border-light-border bg-main-background px-3 py-3 text-base leading-6 text-light-primary outline-none placeholder:text-light-secondary focus:border-main-accent focus:ring-1 focus:ring-main-accent/30 dark:border-dark-border dark:text-dark-primary'
                  : undefined}
              value={body}
            />
            {type === 'post' && !isTweetModal ? <small aria-live="polite">{body.length}/500</small> : null}
          </label>
        </div>
      )}

{!isTweetModal ? (
      <div className={isXWorkspace ? "mb-4 border-y border-light-border px-4 py-4 dark:border-dark-border" : "lr-media-box"}>
        <div className={isXWorkspace ? "mb-3 flex items-center justify-between gap-3" : "lr-media-heading"}>
          <div>
            <strong>{type === 'video' ? '短视频素材' : '图片 / 视频'}</strong>
            <span>{type === 'video' ? '1 个主视频 + 可选封面' : assets.length + '/12'}</span>
          </div>
          <label className={isXWorkspace ? "inline-flex min-h-9 cursor-pointer items-center rounded-full border border-light-border px-4 py-2 text-sm font-bold text-main-accent hover:bg-main-accent/10 dark:border-dark-border" : "lr-upload-button"}>
            添加媒体
            <input
              accept={type === 'article' ? 'image/*' : 'image/*,video/*'}
              hidden
              multiple
              disabled={busy || reviewLocked}
              onChange={handleFiles}
              type="file"
            />
          </label>
        </div>
        {type === 'video' && assets.some(isVideoAsset) ? (
        <div className={isXWorkspace ? "mb-3 grid gap-1 rounded-lg border border-light-border px-3 py-2 text-sm dark:border-dark-border" : "lr-content-status"} role="group" aria-label="视频资料">
          <span>视频资料</span>
          <strong>上传后可直接修改标题、视频文案、封面并保存</strong>
          {(() => {
            const primaryVideo = assets.find(isVideoAsset)
            const metadata = primaryVideo ? videoMetadataByAssetId[primaryVideo.id] : null
            return (
              <>
                <span>{primaryVideo?.filename || '主视频'}</span>
                <span>{metadata
                  ? formatVideoDuration(metadata.duration) + ' · ' + metadata.width + '×' + metadata.height
                  : '正在读取视频信息…'}</span>
              </>
            )
          })()}
        </div>
      ) : null}

      {assets.length ? (
          <div className={isXWorkspace ? "grid gap-3" : "lr-asset-list"}>
            {assets.map((asset) => (
              <div className={isXWorkspace ? "grid grid-cols-[96px,minmax(0,1fr)] items-start gap-3 rounded-xl border border-light-border p-3 dark:border-dark-border" : "lr-asset"} key={asset.id}>
                <div className={isXWorkspace ? "overflow-hidden rounded-lg bg-main-sidebar-background" : "lr-asset-preview"}>
                  {asset.mimeType.startsWith('video/')
                    ? (
                      <video
                        className={isXWorkspace ? "block aspect-square w-full object-cover" : undefined}
                        aria-label={asset.filename ?? '已上传视频'}
                        muted
                        playsInline
                        preload="metadata"
                        src={asset.url}
                        onLoadedMetadata={(event) => {
                          const media = event.currentTarget
                          setVideoMetadataByAssetId((current) => ({
                            ...current,
                            [asset.id]: {
                              duration: media.duration,
                              width: media.videoWidth,
                              height: media.videoHeight,
                            },
                          }))
                        }}
                      />
                    )
                    : <img className={isXWorkspace ? "block aspect-square w-full object-cover" : undefined} alt="" loading="lazy" src={asset.url} />}
                </div>
                <div className={isXWorkspace ? "grid min-w-0 content-start gap-1 text-sm" : "lr-asset-info"}>
                  <strong className={isXWorkspace ? "break-all font-semibold" : undefined}>{asset.filename ?? asset.id}</strong>
                  <span className={isXWorkspace ? "text-xs text-light-secondary dark:text-dark-secondary" : undefined}>{asset.mimeType}</span>
                  {type === 'video' && isVideoAsset(asset) ? (
                    videoMetadataByAssetId[asset.id] ? (
                      <small className={isXWorkspace ? "text-xs text-light-secondary dark:text-dark-secondary" : undefined}>
                        {formatVideoDuration(videoMetadataByAssetId[asset.id].duration)}
                        {' · '}
                        {videoMetadataByAssetId[asset.id].width}×{videoMetadataByAssetId[asset.id].height}
                      </small>
                    ) : (
                      <small className={isXWorkspace ? "text-xs text-light-secondary dark:text-dark-secondary" : undefined}>正在读取视频信息…</small>
                    )
                  ) : null}
                </div>
                <div className={isXWorkspace ? "col-span-2 flex flex-wrap gap-2" : "lr-asset-actions"}>
                  {isImageAsset(asset) ? (
                    <button
                      className={isXWorkspace ? (coverRef.trim() === asset.url ? xButtonSecondary : xButtonGhost) : undefined}
                      disabled={busy || reviewLocked}
                      onClick={() => { setCoverRef(asset.url); markDirty() }}
                      type="button"
                    >
                      {coverRef.trim() === asset.url ? '当前封面' : '设为封面'}
                    </button>
                  ) : null}
                  <button className={isXWorkspace ? xButtonGhost : undefined} disabled={busy || reviewLocked} onClick={() => removeAsset(asset.id)} type="button">移除</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={isXWorkspace ? "rounded-lg border border-dashed border-light-border px-4 py-5 text-center text-sm text-light-secondary dark:border-dark-border dark:text-dark-secondary" : "lr-empty"}>
            {type === 'video' ? '添加 1 个主视频；可再添加 1 张封面图。' : '可一次选择多张图片或一个视频，也可以只发纯文字。'}
          </p>
        )}
      </div>
      ) : (
        <>
          <input
            accept="image/*,video/*"
            hidden
            multiple
            disabled={busy || reviewLocked}
            onChange={handleFiles}
            ref={modalMediaInputRef}
            type="file"
          />
          {assets.length ? (
            <div className="grid grid-cols-2 gap-2 px-3.5 pb-3" aria-label="已添加媒体">
              {assets.map((asset) => (
                <div className="relative min-w-0 overflow-hidden rounded-[14px] border border-[#2f3336] bg-[#16181c]" key={asset.id}>
                  {isVideoAsset(asset) ? (
                    <video className="block aspect-[4/3] max-h-[280px] w-full object-cover" aria-label={asset.filename ?? '已上传视频'} muted playsInline preload="metadata" src={asset.url} />
                  ) : (
                    <img className="block aspect-[4/3] max-h-[280px] w-full object-cover" alt={asset.filename ?? '已上传图片'} loading="lazy" src={asset.url} />
                  )}
                  <button
                    aria-label={'移除媒体 ' + (asset.filename ?? asset.id)}
                    className="absolute right-[7px] top-[7px] grid h-7 w-7 cursor-pointer place-items-center rounded-full border-0 bg-black/80 text-white"
                    disabled={busy || reviewLocked}
                    onClick={() => removeAsset(asset.id)}
                    type="button"
                  >
                    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}


      {type === 'post' && (pollEnabled || !isTweetModal) ? (
        <section className={isTweetModal ? "mx-3.5 mb-3 grid gap-3 rounded-xl border border-[#2f3336] p-3" : isXWorkspace ? "my-4 border-y border-light-border px-4 py-4 dark:border-dark-border" : "lr-media-box"} aria-label="投票设置">
          {isTweetModal ? (
            <div className="flex items-center justify-between gap-3">
              <strong className="text-sm font-semibold">投票</strong>
              <button
                className="rounded-full px-3 py-1 text-xs font-semibold text-[#71767b] transition hover:bg-[#16181c]"
                type="button"
                disabled={busy || reviewLocked}
                onClick={() => { setPollEnabled(false); markDirty() }}
              >
                移除投票
              </button>
            </div>
          ) : (
            <div className={isXWorkspace ? "mb-3 flex items-center justify-between gap-3" : "lr-media-heading"}>
              <div>
                <strong>投票</strong>
                <span>{pollEnabled ? '2–4 个选项 · 每人限投一次' : '为动态添加投票'}</span>
              </div>
              <button
                className={isXWorkspace ? xButtonSecondary : "lr-upload-button"}
                type="button"
                disabled={busy || reviewLocked}
                onClick={() => {
                  setPollEnabled((enabled) => !enabled)
                  if (!pollEnabled) setPollOptions(['', ''])
                  markDirty()
                }}
              >
                {pollEnabled ? '移除投票' : '添加投票'}
              </button>
            </div>
          )}
          {pollEnabled ? (
            <div className="flex flex-col gap-3 p-1">
              {pollOptions.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <label className={isTweetModal ? "grid min-w-0 flex-1 gap-1 text-sm text-[#e7e9ea]" : isXWorkspace ? "grid min-w-0 flex-1 gap-2 text-sm font-semibold text-light-primary dark:text-dark-primary" : "lr-field min-w-0 flex-1"}>
                    <span>选项 {index + 1}</span>
                    <input
                      className={isTweetModal ? "min-w-0 w-full rounded-lg border border-[#2f3336] bg-black px-3 py-2.5 text-sm text-[#e7e9ea] outline-none placeholder:text-[#71767b] focus:border-main-accent" : isXWorkspace ? "min-w-0 w-full rounded-md border border-light-border bg-main-background px-3 py-2.5 text-sm text-light-primary outline-none focus:border-main-accent focus:ring-1 focus:ring-main-accent/30 dark:border-dark-border dark:text-dark-primary" : undefined}
                      aria-label={'投票选项 ' + (index + 1)}
                      maxLength={50}
                      disabled={busy || reviewLocked}
                      onChange={(event) => {
                        setPollOptions((current) => current.map((value, optionIndex) => optionIndex === index ? event.target.value : value))
                        markDirty()
                      }}
                      placeholder={'输入选项 ' + (index + 1)}
                      value={option}
                    />
                    <small className={isTweetModal ? "text-xs text-[#71767b]" : undefined}>{option.length}/50</small>
                  </label>
                  {pollOptions.length > 2 ? (
                    <button
                      className={isTweetModal ? "shrink-0 rounded-full px-3 py-2 text-xs text-[#71767b] hover:bg-[#16181c]" : "ghost"}
                      type="button"
                      disabled={busy || reviewLocked}
                      aria-label={'移除选项 ' + (index + 1)}
                      onClick={() => {
                        setPollOptions((current) => current.filter((_value, optionIndex) => optionIndex !== index))
                        markDirty()
                      }}
                    >
                      移除
                    </button>
                  ) : null}
                </div>
              ))}
              {pollOptions.length < 4 ? (
                <button
                  className={isTweetModal ? "self-start rounded-full px-3 py-1.5 text-sm font-semibold text-main-accent hover:bg-main-accent/10" : "ghost self-start"}
                  type="button"
                  disabled={busy || reviewLocked}
                  onClick={() => {
                    setPollOptions((current) => [...current, ''])
                    markDirty()
                  }}
                >
                  + 添加选项
                </button>
              ) : null}
              <label className={isTweetModal ? "grid gap-1 text-sm text-[#e7e9ea]" : "lr-field"}>
                <span>投票时长</span>
                <select
                  className={isTweetModal ? "w-full rounded-lg border border-[#2f3336] bg-black px-3 py-2.5 text-sm text-[#e7e9ea]" : isXWorkspace ? "rounded-md border border-light-border bg-main-background px-3 py-2.5 text-sm text-light-primary outline-none focus:border-main-accent dark:border-dark-border dark:text-dark-primary" : undefined}
                  aria-label="投票时长"
                  disabled={busy || reviewLocked}
                  value={pollDurationHours}
                  onChange={(event) => {
                    setPollDurationHours(Number(event.target.value) as 24 | 72 | 168)
                    markDirty()
                  }}
                >
                  <option value={24}>1 天</option>
                  <option value={72}>3 天</option>
                  <option value={168}>7 天</option>
                </select>
              </label>
              <p className={isTweetModal ? "text-xs leading-5 text-[#71767b]" : "text-xs text-light-secondary dark:text-dark-secondary"}>投票会随动态一起发布；每个账号只能投一次，发布后不能修改选项。</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {isTweetModal && type === 'post' && pollEnabled ? (
        <section className="mx-3.5 mb-3 grid gap-[9px] rounded-[14px] border border-[#2f3336] bg-black p-3" aria-label="投票选项">
          <div className="grid gap-2">
            {pollOptions.map((option, index) => (
              <div className="flex items-center gap-2" key={index}>
                <input
                  className="min-w-0 w-full rounded-lg border border-[#536471] bg-black px-3 py-2.5 text-[#e7e9ea] outline-none focus:border-[#1d9bf0]"
                  aria-label={'投票选项 ' + (index + 1)}
                  disabled={busy || reviewLocked}
                  maxLength={50}
                  onChange={(event) => {
                    setPollOptions((current) => current.map((value, optionIndex) => optionIndex === index ? event.target.value : value))
                    markDirty()
                  }}
                  placeholder={'选项 ' + (index + 1)}
                  value={option}
                />
                {pollOptions.length > 2 ? (
                  <button
                    aria-label={'移除选项 ' + (index + 1)}
                    className="h-7 w-7 flex-none cursor-pointer rounded-full border-0 bg-transparent text-xl text-[#e7e9ea] disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={busy || reviewLocked}
                    onClick={() => {
                      setPollOptions((current) => current.filter((_value, optionIndex) => optionIndex !== index))
                      markDirty()
                    }}
                    type="button"
                  >×</button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2.5">
            {pollOptions.length < 4 ? (
              <button
                className="flex-none cursor-pointer border-0 bg-transparent text-xs text-main-accent"
                disabled={busy || reviewLocked}
                onClick={() => {
                  setPollOptions((current) => [...current, ''])
                  markDirty()
                }}
                type="button"
              >+ 添加选项</button>
            ) : <span />}
            <select
              className="rounded-full border border-[#536471] bg-black px-2.5 py-1.5 text-xs text-[#e7e9ea] outline-none"
              aria-label="投票时长"
              disabled={busy || reviewLocked}
              value={pollDurationHours}
              onChange={(event) => {
                setPollDurationHours(Number(event.target.value) as 24 | 72 | 168)
                markDirty()
              }}
            >
              <option value={24}>1 天</option>
              <option value={72}>3 天</option>
              <option value={168}>7 天</option>
            </select>
          </div>
        </section>
      ) : null}

{!isTweetModal && type === 'article' ? (
      <div className={isXWorkspace ? "my-4 grid gap-4 border-y border-light-border px-4 py-4 dark:border-dark-border" : "lr-preflight-policy"}>
        <div className={isXWorkspace ? "flex flex-wrap items-center justify-between gap-3" : "lr-preflight-policy-heading"}>
          <strong>{isTweetModal ? '创作声明' : '创作者质量与 AI 规范'}</strong>
          <span>发布前自动检查</span>
        </div>
        <label className={isXWorkspace ? "grid gap-2 text-sm font-semibold text-light-primary dark:text-dark-primary" : "lr-field"}>
          <span>{isTweetModal ? 'AI 使用方式' : 'AI 使用方式（请据实选择）'}</span>
          <select className={isXWorkspace ? "w-full rounded-md border border-light-border bg-main-background px-3 py-3 text-base text-light-primary outline-none focus:border-main-accent focus:ring-1 focus:ring-main-accent/30 dark:border-dark-border dark:text-dark-primary" : undefined} aria-label="AI 使用方式" disabled={busy || reviewLocked} onChange={(event) => { setAiMode(event.target.value as AiMode); setPreflightReport(null) }} value={aiMode}>
            <option value="none">未使用 AI</option>
            <option value="outline">AI 只做提纲 / 框架</option>
            <option value="assist">AI 辅助整理 / 润色</option>
            <option value="full">整篇 AI 生成（禁止直接发布）</option>
          </select>
        </label>
        {type === 'article' ? (
          <label className={isXWorkspace ? "flex items-start gap-3 text-sm leading-6 text-light-secondary dark:text-dark-secondary" : "lr-preflight-check"}>
            <input className={isXWorkspace ? "mt-1 h-4 w-4 accent-main-accent" : undefined} checked={humanConfirmed} disabled={busy || reviewLocked} onChange={(event) => { setHumanConfirmed(event.target.checked); setPreflightReport(null) }} type="checkbox" />
            <span>我已补充自己的原创事实、经验、案例、数据或判断，并亲自核验关键事实。</span>
          </label>
        ) : null}
        {!isTweetModal ? <p>原则：AI 可以帮你搭框架，但不能替代创作者完成文章；最终内容必须真正帮助读者。</p> : null}
      </div>
      ) : null}

      {!isTweetModal && preflightReport ? (
        <section className={isXWorkspace
          ? "mx-4 my-4 grid gap-3 rounded-xl border border-light-border p-4 dark:border-dark-border"
          : 'lr-preflight-report lr-preflight-' + preflightReport.verdict.toLowerCase()} aria-label="发布前检查结果">
          <div className={isXWorkspace ? "flex flex-wrap items-center justify-between gap-3 border-b border-light-border pb-3 dark:border-dark-border" : "lr-preflight-report-head"}>
            <strong className={isXWorkspace ? "text-sm font-bold" : undefined}>{preflightReport.verdict === 'PASS' ? '检查通过' : preflightReport.verdict === 'YELLOW' ? '建议修改后发布' : '暂不能提交'}</strong>
            <span className={isXWorkspace ? "rounded-full bg-main-sidebar-background px-3 py-1 text-xs font-semibold text-light-secondary dark:text-dark-secondary" : undefined}>质量 / SEO 准备度 {preflightReport.score}</span>
          </div>
          <p className={isXWorkspace ? "text-sm leading-6 text-light-secondary dark:text-dark-secondary" : undefined}>{preflightReport.summary}</p>
          <div className={isXWorkspace ? "grid grid-cols-2 gap-2 sm:grid-cols-3" : "lr-preflight-stats"} aria-label="检测统计">
            <span className={isXWorkspace ? "rounded-lg bg-main-sidebar-background px-3 py-2 text-xs text-light-secondary dark:text-dark-secondary" : undefined}>正文 {preflightReport.analyzed.bodyChars}</span>
            <span className={isXWorkspace ? "rounded-lg bg-main-sidebar-background px-3 py-2 text-xs text-light-secondary dark:text-dark-secondary" : undefined}>段落 {preflightReport.analyzed.paragraphCount}</span>
            <span className={isXWorkspace ? "rounded-lg bg-main-sidebar-background px-3 py-2 text-xs text-light-secondary dark:text-dark-secondary" : undefined}>外链 {preflightReport.analyzed.externalUrlCount}</span>
            <span className={isXWorkspace ? "rounded-lg bg-main-sidebar-background px-3 py-2 text-xs text-light-secondary dark:text-dark-secondary" : undefined}>电话 {preflightReport.analyzed.phoneCount}</span>
            <span className={isXWorkspace ? "rounded-lg bg-main-sidebar-background px-3 py-2 text-xs text-light-secondary dark:text-dark-secondary" : undefined}>即时通讯 {preflightReport.analyzed.messengerIdCount}</span>
          </div>
          {preflightReport.findings.slice(0, 8).map((item, index) => (
            <div className={isXWorkspace ? "grid gap-1 rounded-lg border border-light-border px-3 py-2.5 text-sm dark:border-dark-border" : "lr-preflight-finding"} key={item.category + item.title + index}>
              <strong className={isXWorkspace ? "font-semibold" : undefined}>{item.severity === 'BLOCK' ? '阻断' : item.severity === 'WARN' ? '建议' : '提示'} · {item.title}</strong>
              <span className={isXWorkspace ? "text-light-secondary dark:text-dark-secondary" : undefined}>{item.message}</span>
              <small className={isXWorkspace ? "text-xs text-light-secondary dark:text-dark-secondary" : undefined}>建议：{item.fix}</small>
            </div>
          ))}
        </section>
      ) : null}


      {!isTweetModal || type !== 'post' ? (
      <label className={isXWorkspace ? "mb-4 grid gap-2 px-4 text-sm font-semibold text-light-primary dark:text-dark-primary" : "lr-field"}>
        <span>{type === 'video' ? '短视频封面' : '封面引用'}（可选）</span>
        <input
          className={isXWorkspace ? "w-full rounded-md border border-light-border bg-main-background px-3 py-3 text-base text-light-primary outline-none focus:border-main-accent focus:ring-1 focus:ring-main-accent/30 dark:border-dark-border dark:text-dark-primary" : undefined}
          disabled={busy || reviewLocked}
          onChange={(event) => { setCoverRef(event.target.value); markDirty() }}
          placeholder={type === 'video' ? '默认使用第一张图片素材' : '默认使用第一个媒体文件'}
          value={coverRef}
        />
      </label>
      ) : null}

      {!isTweetModal && draft ? (
        <div className={isXWorkspace ? "mx-4 my-3 flex flex-wrap items-center gap-3 rounded-lg border border-light-border px-3 py-2 text-sm dark:border-dark-border" : "lr-content-status"} role="status">
          <span>当前状态</span>
          <strong>{stateLabel}</strong>
          <span>版本 {draft.version}</span>
        </div>
      ) : null}
      {!isTweetModal && draft?.state === 'DRAFT' ? (
        <div className={isXWorkspace ? "mx-4 my-3 flex flex-wrap items-center gap-3 rounded-lg border border-light-border px-3 py-2 text-sm dark:border-dark-border" : "lr-content-status"} role="status" aria-live="polite">
          <span>自动保存</span>
          <strong>
            {autoSaveStatus === 'saving' ? '保存中…'
              : autoSaveStatus === 'scheduled' ? '即将保存'
                : autoSaveStatus === 'saved' ? '已保存'
                  : autoSaveStatus === 'error' ? '保存失败'
                    : '等待编辑'}
          </strong>
        </div>
      ) : null}
      {message ? <div aria-live="polite" className={isTweetModal ? "mx-3.5 mb-2 mt-1 text-xs text-[#71767b]" : isXWorkspace ? "mx-4 my-2 text-sm text-main-accent" : "lr-success"} role="status">{message}</div> : null}
      {error ? <div className={isTweetModal ? "mx-3.5 mb-2 mt-1 text-xs text-[#f4212e]" : isXWorkspace ? "mx-4 my-2 text-sm text-red-600 dark:text-red-400" : "lr-error"} role="alert">{error}</div> : null}

      {preview ? (
        <section className={isXWorkspace ? "mx-4 my-4 overflow-hidden rounded-xl border border-light-border dark:border-dark-border" : "lr-preview"} aria-label="发布预览">
          <div className={isXWorkspace ? "flex flex-wrap items-center justify-between gap-3 border-b border-light-border px-4 py-3 dark:border-dark-border" : "lr-preview-heading"}>
            <div>
              <strong>发布预览</strong>
              {draft ? <span aria-label={'预览版本 ' + draft.version}>版本 v{draft.version}</span> : <span>当前草稿版本</span>}
            </div>
            <button className={isXWorkspace ? xButtonGhost : "ghost"} onClick={() => setPreview(false)} type="button">返回编辑</button>
          </div>
          <article className={isXWorkspace ? "grid gap-3 p-4" : "lr-preview-card"}>
            <span className={isXWorkspace ? "justify-self-start rounded-full bg-main-sidebar-background px-3 py-1 text-xs font-semibold text-light-secondary dark:text-dark-secondary" : "lr-preview-type"}>{type === 'article' ? '文章' : type === 'post' ? '动态' : '视频'}</span>
            <h2 className={isXWorkspace ? "text-xl font-bold text-light-primary dark:text-dark-primary" : undefined}>{effectiveContentTitle() || '未填写标题'}</h2>
            {type === 'article' ? (
              <ArticleStructuredRenderer document={articleDocument} />
            ) : type === 'post' ? null : (
              <p className={isXWorkspace ? "whitespace-pre-wrap text-sm leading-6 text-light-secondary dark:text-dark-secondary" : "lr-preview-body"}>{body.trim() || '暂无正文'}</p>
            )}
            {resolveCoverRef(
              type,
              assets,
              coverRef,
              type === 'article' ? mediaRefsFromArticleDocument(articleDocument) : [],
            ) ? (
              <div className={isXWorkspace ? "overflow-hidden rounded-xl border border-light-border dark:border-dark-border" : "lr-preview-cover"}>
                <img
                  className={isXWorkspace ? "block max-h-[560px] w-full object-contain" : undefined}
                  alt=""
                  loading="eager"
                  src={resolveCoverRef(
                    type,
                    assets,
                    coverRef,
                    type === 'article' ? mediaRefsFromArticleDocument(articleDocument) : [],
                  ) ?? undefined}
                />
              </div>
            ) : null}
            {assets.length ? (
              <div className={isXWorkspace ? "grid grid-cols-2 gap-2" : "lr-preview-media"}>
                {assets.slice(0, 4).map((asset) =>
                  asset.mimeType.startsWith('video/')
                    ? <video
                        className={isXWorkspace ? "block max-h-[360px] w-full rounded-lg object-cover" : undefined}
                        controls
                        key={asset.id}
                        muted
                        playsInline
                        preload="metadata"
                        poster={type === 'video' && coverRef ? coverRef : undefined}
                        src={asset.url}
                      />
                    : <img className={isXWorkspace ? "block max-h-[360px] w-full rounded-lg object-cover" : undefined} alt={asset.filename ?? ''} key={asset.id} loading="lazy" src={asset.url} />,
                )}
                {assets.length > 4 ? <span className={isXWorkspace ? "col-span-2 text-xs text-light-secondary dark:text-dark-secondary" : undefined}>+{assets.length - 4} 个媒体</span> : null}
              </div>
            ) : null}
            {type === 'post' && pollEnabled ? (
              <section className={isXWorkspace ? "grid gap-2 rounded-xl border border-light-border p-3 dark:border-dark-border" : "lr-media-box"} aria-label="投票预览">
                <strong>投票</strong>
                {pollOptions.filter((option) => option.trim()).map((option, index) => (
                  <div key={index} className={isXWorkspace ? "rounded-lg border border-light-border px-3 py-2 text-sm dark:border-dark-border" : "rounded-full border border-light-border px-3 py-2 text-sm dark:border-dark-border"}>{option}</div>
                ))}
                <small className={isXWorkspace ? "text-xs text-light-secondary dark:text-dark-secondary" : undefined}>{pollDurationHours === 24 ? '1 天' : pollDurationHours === 72 ? '3 天' : '7 天'}</small>
              </section>
            ) : null}
          </article>
        </section>
      ) : null}

      {isTweetModal ? (
        <div className="flex-1" aria-hidden="true" />
      ) : null}
      {isTweetModal ? (
        <button
          aria-haspopup="dialog"
          className="flex w-full shrink-0 items-center gap-3 border-y border-[#2f3336] px-5 py-3 text-left text-sm font-medium text-main-accent transition hover:bg-[#080808]"
          onClick={() => setReplyAudienceOpen(true)}
          type="button"
        >
          <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" />
            <ellipse cx="12" cy="12" rx="4" ry="9" />
            <path d="M3 12h18M5.5 6.5h13M5.5 17.5h13" />
          </svg>
          <span>{replyAudienceLabels[replyAudience]}</span>
        </button>
      ) : null}
      <div className={isTweetModal ? "sticky bottom-0 z-10 flex min-h-[52px] shrink-0 items-center justify-between gap-3 bg-black px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 sm:px-3.5" : isXWorkspace ? "flex flex-wrap items-center justify-end gap-2 border-t border-light-border px-4 py-3 dark:border-dark-border" : "lr-actions"}>
        {isTweetModal ? (
          <>
            <div className="flex text-main-accent xs:[&>button:nth-child(n+6)]:hidden md:[&>button]:!block [&>button:nth-child(n+4)]:hidden">
              <button
                aria-label="添加图片或视频"
                className="custom-button accent-tab accent-bg-tab group relative rounded-full p-2 text-main-accent hover:bg-main-accent/10 active:bg-main-accent/20"
                disabled={busy || reviewLocked || pollEnabled}
                onClick={() => modalMediaInputRef.current?.click()}
                title="图片或视频"
                type="button"
              >
                <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <circle cx="8.5" cy="9" r="1.5" />
                  <path d="m21 15-5-5L5 20" />
                </svg>
              </button>
              <button
                aria-label={pollEnabled ? "移除投票" : "添加投票"}
                aria-pressed={pollEnabled}
                className={pollEnabled ? "custom-button accent-tab accent-bg-tab group relative rounded-full bg-main-accent/10 p-2 text-main-accent hover:bg-main-accent/10 active:bg-main-accent/20" : "custom-button accent-tab accent-bg-tab group relative rounded-full p-2 text-main-accent hover:bg-main-accent/10 active:bg-main-accent/20"}
                disabled={busy || reviewLocked || assets.length > 0}
                onClick={() => {
                  setPollEnabled((enabled) => !enabled)
                  if (!pollEnabled) setPollOptions(['', ''])
                  markDirty()
                }}
                title="投票"
                type="button"
              >
                <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19V5M4 19H21" />
                  <path d="M8 16v-5M13 16V7M18 16v-8" />
                </svg>
              </button>
              <button aria-label="GIF（暂不可用）" className="custom-button accent-tab accent-bg-tab group relative rounded-full p-2 text-main-accent" disabled title="GIF 暂不可用" type="button">
                <span className="rounded border border-current px-1 text-[9px] font-extrabold">GIF</span>
              </button>
              <button aria-label="表情（暂不可用）" className="custom-button accent-tab accent-bg-tab group relative rounded-full p-2 text-main-accent" disabled title="表情功能暂不可用" type="button">
                <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
                </svg>
              </button>
              <button aria-label="定时发布（暂不可用）" className="custom-button accent-tab accent-bg-tab group relative rounded-full p-2 text-main-accent" disabled title="定时发布暂不可用" type="button">
                <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                </svg>
              </button>
              <button aria-label="位置（暂不可用）" className="custom-button accent-tab accent-bg-tab group relative rounded-full p-2 text-main-accent" disabled title="位置功能暂不可用" type="button">
                <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" />
                </svg>
              </button>
            </div>
            <div className="flex min-w-10 items-center justify-end gap-2">
              {body.length > 0 ? <span className="text-[11px] tabular-nums text-[#71767b]" aria-live="polite">{body.length}/500</span> : null}
            </div>
          </>
        ) : (
          <>
            {draft?.state === 'PENDING_REVIEW' || (type === 'post' && draft?.state === 'PUBLISHED') ? (
              <button className={isXWorkspace ? xButtonSecondary : "secondary"} disabled={busy} onClick={startNewContent} type="button">
                新建内容
              </button>
            ) : null}
            {type !== 'post' ? (
            <button className={isXWorkspace ? xButtonGhost : "ghost"} disabled={busy || reviewLocked} onClick={async () => {
              setBusy(true); setError(''); setMessage('')
              try { await runPreflight(); setMessage('发布前检查完成，请查看检查结果。') }
              catch (caught) { setError(caught instanceof Error ? caught.message : '发布前检查失败，请稍后重试。') }
              finally { setBusy(false) }
            }} type="button">
              发布前自检
            </button>
            ) : null}
            <button className={isXWorkspace ? xButtonGhost : "ghost"} disabled={busy} onClick={() => setPreview((current) => !current)} type="button">
              {preview ? '关闭预览' : '预览'}
            </button>
            {draft?.id && draft.state === 'DRAFT' ? (
              <button className={isXWorkspace ? xButtonGhost : "ghost"} disabled={busy} onClick={copyDraftLink} type="button">
                {copied ? '已复制' : '复制恢复链接'}
              </button>
            ) : null}
            {draft?.state === 'DRAFT' ? (
              <button className={isXWorkspace ? xButtonDanger : "danger"} disabled={busy} onClick={discardDraft} type="button">
                放弃草稿
              </button>
            ) : null}
            <button className={isXWorkspace ? xButtonSecondary : "secondary"} disabled={busy || autoSaveStatus === 'saving' || reviewLocked} onClick={saveDraft} type="button">
              {busy ? '处理中…' : '保存草稿'}
            </button>
            <button className={isXWorkspace ? xButtonPrimary : "primary"} disabled={busy || autoSaveStatus === 'saving' || reviewLocked} onClick={submitForReview} type="button">
              {busy ? '处理中…' : draft?.state === 'PENDING_REVIEW' ? '审核中…' : type === 'post' && draft?.state === 'PUBLISHED' ? '已发布' : type === 'post' ? '发布动态' : '提交发布'}
            </button>
          </>
        )}
      </div>
      {isTweetModal && replyAudienceOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setReplyAudienceOpen(false) }}
        >
          <section
            aria-labelledby="luckread-reply-audience-title"
            aria-modal="true"
            className="max-h-[86dvh] w-full overflow-y-auto border-t border-[#2f3336] bg-black pb-[max(env(safe-area-inset-bottom),1rem)] text-[#e7e9ea] sm:max-w-xl sm:rounded-2xl sm:border"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="mx-auto mt-3 h-1 w-12 rounded-full bg-[#2f3336] sm:hidden" />
            <header className="px-5 pb-3 pt-5">
              <h2 className="text-2xl font-bold tracking-tight" id="luckread-reply-audience-title">谁可以回复？</h2>
              <p className="mt-2 text-sm leading-5 text-[#71767b]">选择谁可以回复这个帖子。请记住，只要是提及的人就都能回复。</p>
            </header>
            {REPLY_AUDIENCE_OPTIONS.map((option) => (
              <button
                aria-pressed={replyAudience === option.value}
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-[#16181c]"
                key={option.value}
                onClick={() => {
                  setReplyAudience(option.value)
                  markDirty()
                  setReplyAudienceOpen(false)
                }}
                type="button"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center text-[#e7e9ea]">
                  {option.value === 'everyone' ? (
                    <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.93 9h-3.1a15.7 15.7 0 0 0-1.32-5.1A8.04 8.04 0 0 1 18.93 11ZM12 4.05c.9 1.3 1.6 3.75 1.85 6.95h-3.7C10.4 7.8 11.1 5.35 12 4.05ZM4.07 13h3.1c.2 1.9.7 3.7 1.32 5.1A8.04 8.04 0 0 1 4.07 13Zm3.1-2h-3.1a8.04 8.04 0 0 1 4.42-5.1A15.7 15.7 0 0 0 7.17 11Zm4.83 8.95c-.9-1.3-1.6-3.75-1.85-6.95h3.7c-.25 3.2-.95 5.65-1.85 6.95Zm2.51-1.85A15.7 15.7 0 0 0 15.83 13h3.1a8.04 8.04 0 0 1-4.42 5.1Z" />
                    </svg>
                  ) : option.value === 'verified' ? (
                    <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
                      <path d="m12 2 2.5 2 3.2-.2 1.1 3 2.7 1.7-1 3 1 3-2.7 1.7-1.1 3-3.2-.2-2.5 2-2.5-2-3.2.2-1.1-3L2.5 14.5l1-3-1-3 2.7-1.7 1.1-3 3.2.2L12 2Z" />
                      <path d="m8.5 12 2.2 2.2 4.8-5" fill="none" stroke="#000" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : option.value === 'following' ? (
                    <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="9" cy="7" r="4" />
                      <path d="M2 21v-2a7 7 0 0 1 14 0v2Z" />
                      <path d="m16 12 2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : option.value === 'mentioned' ? (
                    <span aria-hidden="true" className="text-3xl font-extrabold">@</span>
                  ) : (
                    <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="8" cy="8" r="3.5" />
                      <circle cx="17" cy="9" r="2.7" />
                      <path d="M1 20v-1a7 7 0 0 1 14 0v1ZM14 15a5.5 5.5 0 0 1 9 4v1h-6v-1a8.8 8.8 0 0 0-3-4Z" />
                    </svg>
                  )}
                </span>
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="text-base font-medium">{option.label}</span>
                  <span className="text-sm text-[#71767b]">{option.description}</span>
                </span>
                <span className={replyAudience === option.value ? "grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-main-accent" : "h-5 w-5 shrink-0 rounded-full border-2 border-[#71767b]"}>
                  {replyAudience === option.value ? <span className="h-2.5 w-2.5 rounded-full bg-main-accent" /> : null}
                </span>
              </button>
            ))}
          </section>
        </div>
      ) : null}

    </div>
  )
}
