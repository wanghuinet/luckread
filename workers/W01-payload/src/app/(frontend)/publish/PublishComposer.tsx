'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { computeAutoSaveDelay } from '../../../lib/content-autosave.js'
import { articleDocumentFromBody, plainTextFromArticleDocument, mediaRefsFromArticleDocument, serializeArticleDocument, createArticleDocument, tryDeserializeArticleDocument, type ArticleDocument } from '../../../lib/article-document.js'
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

const CONTENT_MUTATED_EVENT = 'luckread:content-mutated'

async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const response = await fetch(input, {
    ...init,
    credentials: 'include',
  })

  if (response.status === 401) throw new Error('AUTH_REQUIRED')
  return response
}

const isVideoAsset = (asset: UploadedAsset): boolean => asset.mimeType.startsWith('video/')
const isImageAsset = (asset: UploadedAsset): boolean => asset.mimeType.startsWith('image/')

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

type PublishComposerProps = {
  contentBasePath?: string
  initialType?: ContentType
}

export default function PublishComposer({
  contentBasePath = '/api/v1/contents',
  initialType = 'article',
}: PublishComposerProps) {
  const router = useRouter()
  const [type, setType] = useState<ContentType>(initialType)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [articleDocument, setArticleDocument] = useState<ArticleDocument>(() => createArticleDocument())
  const [savedArticleSerialized, setSavedArticleSerialized] = useState('')
  const [assets, setAssets] = useState<UploadedAsset[]>([])
  const [coverRef, setCoverRef] = useState('')
  const [draft, setDraft] = useState<ContentResponse | null>(null)
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
        const response = await authorizedFetch(
          `${contentBasePath}/${encodeURIComponent(draftId)}`,
          { method: 'GET', signal: controller.signal },
        )
        const data = await response.json().catch((): null => null)
        if (!response.ok || !data?.id || !data?.etag) throw new Error(data?.error?.message || 'DRAFT_RECOVERY_FAILED')
        const recovered = data as ContentResponse
        let recoveredBody = ''
        if (recovered.bodyRef) {
          const bodyResponse = await fetch(recovered.bodyRef, {
            method: 'GET',
            credentials: 'same-origin',
            signal: controller.signal,
          })
          if (bodyResponse.ok) recoveredBody = await bodyResponse.text()
        }
        if (cancelled) return
        setDraft(recovered)
        setType(recovered.contentType ?? 'article')
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
        setAssets((recovered.mediaRefs ?? []).map((url: string) => ({
          id: url,
          url,
          filename: '已关联媒体',
          mimeType: 'application/octet-stream',
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

  async function uploadFile(file: File): Promise<UploadedAsset> {
    const form = new FormData()
    form.append('_payload', JSON.stringify({ alt: file.name }))
    form.append('file', file)
    const response = await authorizedFetch('/api/v1/media', {
      method: 'POST',
      body: form,
      headers: { 'Idempotency-Key': 'media-upload:' + crypto.randomUUID() },
    })
    const data = await response.json().catch((): null => null)
    const doc = data?.doc ?? data
    if (!response.ok || !doc?.id || !doc?.url) {
      throw new Error('MEDIA_UPLOAD_FAILED')
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
    } catch {
      setError('媒体上传失败，请检查文件后重试。')
      setMessage('')
    } finally {
      event.target.value = ''
    }
  }

  function removeAsset(id: string) {
    const removed = assets.find((asset) => asset.id === id)
    setAssets((current) => current.filter((asset) => asset.id !== id))
    if (removed && coverRef.trim() === removed.url) {
      const fallback = type === 'video'
        ? assets.find((asset) => asset.id !== id && isImageAsset(asset))?.url ?? ''
        : assets.find((asset) => asset.id !== id)?.url ?? ''
      setCoverRef(fallback)
    }
    markDirty()
  }

  const reviewLocked = draft?.state === 'PENDING_REVIEW'

  const stateLabel = draft?.state === 'DRAFT'
    ? '草稿已保存'
    : draft?.state === 'PENDING_REVIEW'
      ? '审核中'
      : draft?.state === 'REJECTED'
        ? '审核退回'
        : draft?.state === 'PUBLISHED'
          ? '已发布'
          : draft?.state

  async function persistDraft(): Promise<ContentResponse> {
    let bodyRef = draft?.bodyRef
    let nextSavedArticleSerialized: string | null = null
    if (type === 'article') {
      const serialized = serializeArticleDocument(articleDocument)
      if (!bodyRef || savedArticleSerialized !== serialized) {
        const bodyFile = new File(
          [serialized],
          `luckread-article-${crypto.randomUUID()}.json`,
          { type: 'application/json;charset=utf-8' },
        )
        bodyRef = (await uploadFile(bodyFile)).url
        nextSavedArticleSerialized = serialized
      }
    } else if (!bodyRef || savedBody !== body) {
      const bodyFile = new File(
        [body],
        `luckread-content-${crypto.randomUUID()}.txt`,
        { type: 'text/plain;charset=utf-8' },
      )
      bodyRef = (await uploadFile(bodyFile)).url
      setSavedArticleSerialized('')
    }

    const payload = {
      contentType: type,
      title: title.trim(),
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

    const isUpdate = Boolean(draft?.id && draft.etag)
    const response = await authorizedFetch(
      isUpdate
        ? `${contentBasePath}/${encodeURIComponent(draft!.id)}`
        : contentBasePath,
      {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: {
          'content-type': 'application/json',
          ...(isUpdate ? { 'If-Match': draft!.etag } : {}),
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      },
    )
    const data = await response.json().catch((): null => null)
    if (!response.ok) throw new Error(data?.error?.message || 'CONTENT_SAVE_FAILED')
    const saved = data as ContentResponse
    setDraft(saved)
    setSavedBody(body)
    if (nextSavedArticleSerialized !== null) setSavedArticleSerialized(nextSavedArticleSerialized)
    autoSaveLastSavedAtRef.current = Date.now()
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set('draft', saved.id)
    window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash)
    return saved
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
    if (!restoreCompleteRef.current || !autoSaveDirtyRef.current || reviewLocked || !title.trim() || !body.trim()) {
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
        !title.trim() ||
        !body.trim() ||
        reviewLocked
      ) {
        return
      }

      autoSaveInFlightRef.current = true
      setAutoSaveStatus('saving')
      try {
        await persistDraft()
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
  }, [title, body, type, assets, coverRef, busy, articleDocument])

  function startNewContent() {
    setDraft(null)
    setSavedBody('')
    setSavedArticleSerialized('')
    setArticleDocument(createArticleDocument())
    setTitle('')
    setBody('')
    setAssets([])
    setCoverRef('')
    setPreview(false)
    setCopied(false)
    cancelPendingAutoSave()
    autoSaveDirtyRef.current = false
    autoSaveLastSavedAtRef.current = null
    setAutoSaveStatus('idle')
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.delete('draft')
    window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash)
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

  async function runPreflight(): Promise<{ report: PublishPreflightResult; input: Record<string, unknown>; draft: ContentResponse }> {
    if (autoSaveInFlightRef.current) throw new Error('自动保存正在进行，请稍后重试。')
    if (!title.trim() || !body.trim()) throw new Error('请先填写标题和正文。')
    if (type === 'video' && !assets.some(isVideoAsset)) throw new Error('短视频至少需要添加一个视频素材。')

    const savedDraft = await persistDraft()
    autoSaveDirtyRef.current = false
    autoSaveLastSavedAtRef.current = Date.now()
    setAutoSaveStatus('saved')
    const input = {
      contentType: type,
      title: title.trim(),
      body,
      mediaRefs: assets.map((asset) => asset.url),
      coverRef: resolveCoverRef(
        type,
        assets,
        coverRef,
        type === 'article' ? mediaRefsFromArticleDocument(articleDocument) : [],
      ),
      aiMode,
      humanContribution: humanConfirmed ? 'substantial' : 'light',
    }
    const response = await authorizedFetch(
      contentBasePath + '/' + encodeURIComponent(savedDraft.id) + '/preflight',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    )
    const report = await response.json().catch((): null => null) as PublishPreflightResult | null
    if (!response.ok || !report?.verdict) throw new Error('发布前检查失败，请稍后重试。')
    setPreflightReport(report)
    return { report, input, draft: savedDraft }
  }



  async function saveDraft() {
    if (autoSaveInFlightRef.current) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (!title.trim() || !body.trim()) {
        setError('请先填写标题和正文。')
        return
      }
      if (type === 'video' && !assets.some(isVideoAsset)) {
        setError('短视频至少需要添加一个视频素材。')
        return
      }
      const savedChangeToken = autoSaveChangeTokenRef.current
      await persistDraft()
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
      const response = await authorizedFetch(
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
        const data = await response.json().catch((): null => null)
        throw new Error(data?.error?.message || 'CONTENT_DELETE_FAILED')
      }
      setDraft(null)
      setSavedBody('')
      setSavedArticleSerialized('')
      setArticleDocument(createArticleDocument())
      setTitle('')
      setBody('')
      setAssets([])
      setCoverRef('')
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.delete('draft')
      window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash)
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
      if (report.verdict === 'RED') return
      if (report.verdict === 'YELLOW') {
        const warnings = report.findings.filter((item) => item.severity === 'WARN').slice(0, 4).map((item) => '• ' + item.title).join('\\n')
        if (!window.confirm(report.summary + '\\n\\n建议先处理：\\n' + warnings + '\\n\\n确认仍然提交审核吗？')) return
      }
      const response = await authorizedFetch(
        contentBasePath + '/' + encodeURIComponent(savedDraft.id) + '/state',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'If-Match': savedDraft.etag,
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({ to: 'PENDING_REVIEW', preflight: input }),
        },
      )
      const data = await response.json().catch((): null => null)
      if (!response.ok) throw new Error(data?.error?.message || 'SUBMIT_FAILED')
      const transition = data as { to?: string; version?: number; etag?: string }
      setDraft((current) =>
        current && transition.to && typeof transition.version === 'number' && transition.etag
          ? { ...current, state: transition.to, version: transition.version, etag: transition.etag }
          : current,
      )
      autoSaveDirtyRef.current = false
      window.dispatchEvent(new Event(CONTENT_MUTATED_EVENT))
      setMessage('发布前检查通过，已提交审核。审核通过后将进入正式发布状态。')
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

  return (
    <div className="lr-composer-card" aria-busy={busy}>
      <div className="lr-type-tabs" role="tablist" aria-label="内容类型">
        {([
          ['article', '文章'],
          ['post', '动态'],
          ['video', '视频'],
        ] as const).map(([value, label]) => (
          <button
            aria-selected={type === value}
            className={type === value ? 'active' : ''}
            key={value}
            disabled={busy || reviewLocked}
            onClick={() => handleContentTypeChange(value)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <label className="lr-field">
        <span>标题</span>
        <input
          maxLength={512}
          disabled={busy || reviewLocked}
          onChange={(event) => { setTitle(event.target.value); markDirty() }}
          placeholder={type === 'post' ? '这一刻想分享什么？' : '输入一个清晰、有吸引力的标题'}
          value={title}
        />
      </label>

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
        <label className="lr-field">
          <span>{type === 'post' ? '正文' : '视频简介'}</span>
          <textarea
            disabled={busy || reviewLocked}
            onChange={(event) => { setBody(event.target.value); markDirty() }}
            placeholder="写下你的内容…"
            rows={14}
            value={body}
          />
        </label>
      )}

      <div className="lr-media-box">
        <div className="lr-media-heading">
          <div>
            <strong>图片 / 视频</strong>
            <span>{assets.length}/12</span>
          </div>
          <label className="lr-upload-button">
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
        {assets.length ? (
          <div className="lr-asset-list">
            {assets.map((asset) => (
              <div className="lr-asset" key={asset.id}>
                <div className="lr-asset-preview">
                  {asset.mimeType.startsWith('video/')
                    ? <video aria-label={asset.filename ?? '已上传视频'} muted playsInline preload="metadata" src={asset.url} />
                    : <img alt="" loading="lazy" src={asset.url} />}
                </div>
                <div className="lr-asset-info">
                  <strong>{asset.filename ?? asset.id}</strong>
                  <span>{asset.mimeType}</span>
                </div>
                <div className="lr-asset-actions">
                  {isImageAsset(asset) ? (
                    <button
                      disabled={busy || reviewLocked}
                      onClick={() => { setCoverRef(asset.url); markDirty() }}
                      type="button"
                    >
                      {coverRef.trim() === asset.url ? '当前封面' : '设为封面'}
                    </button>
                  ) : null}
                  <button disabled={busy || reviewLocked} onClick={() => removeAsset(asset.id)} type="button">移除</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="lr-empty">可一次选择多张图片或一个视频，也可以只发纯文字。</p>
        )}
      </div>


      <div className="lr-preflight-policy">
        <div className="lr-preflight-policy-heading">
          <strong>创作者质量与 AI 规范</strong>
          <span>发布前自动检查</span>
        </div>
        <label className="lr-field">
          <span>AI 使用方式（请据实选择）</span>
          <select disabled={busy || reviewLocked} onChange={(event) => { setAiMode(event.target.value as AiMode); setPreflightReport(null) }} value={aiMode}>
            <option value="none">未使用 AI</option>
            <option value="outline">AI 只做提纲 / 框架</option>
            <option value="assist">AI 辅助整理 / 润色</option>
            <option value="full">整篇 AI 生成（禁止直接发布）</option>
          </select>
        </label>
        {type === 'article' ? (
          <label className="lr-preflight-check">
            <input checked={humanConfirmed} disabled={busy || reviewLocked} onChange={(event) => { setHumanConfirmed(event.target.checked); setPreflightReport(null) }} type="checkbox" />
            <span>我已补充自己的原创事实、经验、案例、数据或判断，并亲自核验关键事实。</span>
          </label>
        ) : null}
        <p>原则：AI 可以帮你搭框架，但不能替代创作者完成文章；最终内容必须真正帮助读者。</p>
      </div>

      {preflightReport ? (
        <section className={'lr-preflight-report lr-preflight-' + preflightReport.verdict.toLowerCase()} aria-label="发布前检查结果">
          <div className="lr-preflight-report-head">
            <strong>{preflightReport.verdict === 'PASS' ? '检查通过' : preflightReport.verdict === 'YELLOW' ? '建议修改后发布' : '暂不能提交'}</strong>
            <span>质量 / SEO 准备度 {preflightReport.score}</span>
          </div>
          <p>{preflightReport.summary}</p>
          <div className="lr-preflight-stats" aria-label="检测统计">
            <span>正文 {preflightReport.analyzed.bodyChars}</span>
            <span>段落 {preflightReport.analyzed.paragraphCount}</span>
            <span>外链 {preflightReport.analyzed.externalUrlCount}</span>
            <span>电话 {preflightReport.analyzed.phoneCount}</span>
            <span>即时通讯 {preflightReport.analyzed.messengerIdCount}</span>
          </div>
          {preflightReport.findings.slice(0, 8).map((item, index) => (
            <div className="lr-preflight-finding" key={item.category + item.title + index}>
              <strong>{item.severity === 'BLOCK' ? '阻断' : item.severity === 'WARN' ? '建议' : '提示'} · {item.title}</strong>
              <span>{item.message}</span>
              <small>建议：{item.fix}</small>
            </div>
          ))}
        </section>
      ) : null}


      <label className="lr-field">
        <span>{type === 'video' ? '短视频封面' : '封面引用'}（可选）</span>
        <input
          disabled={busy || reviewLocked}
          onChange={(event) => { setCoverRef(event.target.value); markDirty() }}
          placeholder={type === 'video' ? '默认使用第一张图片素材' : '默认使用第一个媒体文件'}
          value={coverRef}
        />
      </label>

      {draft ? (
        <div className="lr-content-status" role="status">
          <span>当前状态</span>
          <strong>{stateLabel}</strong>
          <span>版本 {draft.version}</span>
        </div>
      ) : null}
      {draft?.state === 'DRAFT' ? (
        <div className="lr-content-status" role="status" aria-live="polite">
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
      {message ? <div className="lr-success" role="status">{message}</div> : null}
      {error ? <div className="lr-error" role="alert">{error}</div> : null}

      {preview ? (
        <section className="lr-preview" aria-label="发布预览">
          <div className="lr-preview-heading">
            <div>
              <strong>发布预览</strong>
              {draft ? <span aria-label={'预览版本 ' + draft.version}>版本 v{draft.version}</span> : <span>当前草稿版本</span>}
            </div>
            <button className="ghost" onClick={() => setPreview(false)} type="button">返回编辑</button>
          </div>
          <article className="lr-preview-card">
            <span className="lr-preview-type">{type === 'article' ? '文章' : type === 'post' ? '动态' : '视频'}</span>
            <h2>{title.trim() || '未填写标题'}</h2>
            {type === 'article' ? (
              <ArticleStructuredRenderer document={articleDocument} />
            ) : (
              <p className="lr-preview-body">{body.trim() || '暂无正文'}</p>
            )}
            {resolveCoverRef(type, assets, coverRef) ? (
              <div className="lr-preview-cover">
                <img alt="" loading="eager" src={resolveCoverRef(type, assets, coverRef) ?? undefined} />
              </div>
            ) : null}
            {assets.length ? (
              <div className="lr-preview-media">
                {assets.slice(0, 4).map((asset) =>
                  asset.mimeType.startsWith('video/')
                    ? <video controls key={asset.id} muted playsInline preload="metadata" src={asset.url} />
                    : <img alt={asset.filename ?? ''} key={asset.id} loading="lazy" src={asset.url} />,
                )}
                {assets.length > 4 ? <span>+{assets.length - 4} 个媒体</span> : null}
              </div>
            ) : null}
          </article>
        </section>
      ) : null}

      <div className="lr-actions">
        {draft?.state === 'PENDING_REVIEW' ? (
          <button className="secondary" disabled={busy} onClick={startNewContent} type="button">
            新建内容
          </button>
        ) : null}
        <button className="ghost" disabled={busy || reviewLocked} onClick={async () => {
          setBusy(true); setError(''); setMessage('')
          try { await runPreflight(); setMessage('发布前检查完成，请查看检查结果。') }
          catch (caught) { setError(caught instanceof Error ? caught.message : '发布前检查失败，请稍后重试。') }
          finally { setBusy(false) }
        }} type="button">
          发布前自检
        </button>
        <button className="ghost" disabled={busy} onClick={() => setPreview((current) => !current)} type="button">
          {preview ? '关闭预览' : '预览'}
        </button>
        {draft?.id && draft.state === 'DRAFT' ? (
          <button className="ghost" disabled={busy} onClick={copyDraftLink} type="button">
            {copied ? '已复制' : '复制恢复链接'}
          </button>
        ) : null}
        {draft?.state === 'DRAFT' ? (
          <button className="danger" disabled={busy} onClick={discardDraft} type="button">
            放弃草稿
          </button>
        ) : null}
        <button className="secondary" disabled={busy || autoSaveStatus === 'saving'} onClick={saveDraft} type="button">
          {busy ? '处理中…' : '保存草稿'}
        </button>
        <button className="primary" disabled={busy || autoSaveStatus === 'saving' || draft?.state === 'PENDING_REVIEW'} onClick={submitForReview} type="button">
          {busy ? '处理中…' : draft?.state === 'PENDING_REVIEW' ? '审核中…' : '提交发布'}
        </button>
      </div>

      <p className="lr-note">
        提交发布不会绕过审核：创建后先进入草稿；发布前由 W03 做质量、SEO、导流与 AI 创作规范检查，再按内容状态机进入审核和正式发布。
      </p>
    </div>
  )
}
