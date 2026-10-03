'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import { getPublicCopy, readPublicLocaleCookie, type PublicLocale } from '../../i18n/public-locale'

type CommentItem = {
  id: string
  contentId: string
  authorUserId: string
  parentId: string | null
  body: string
  state: 'PENDING' | 'PUBLISHED' | 'REJECTED'
  depth: number
  createdAt: string
  updatedAt: string
}

type CommentPage = {
  items: CommentItem[]
  nextCursor: string | null
  hasMore: boolean
}

export default function ContentComments({
  contentId,
  viewerUserId,
  interactionRestricted = false,
  locale = readPublicLocaleCookie(),
}: {
  contentId: string
  viewerUserId: string | null
  interactionRestricted?: boolean
  locale?: PublicLocale
}) {
  const copy = getPublicCopy(locale)
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  const [comments, setComments] = useState<CommentItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [likedComments, setLikedComments] = useState<Record<string, boolean>>({})
  const [likingCommentId, setLikingCommentId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const commentsRequestRef = useRef<AbortController | null>(null)
  const commentsRequestIdRef = useRef(0)

  const loadComments = useCallback(async (nextCursor: string | null = null) => {
    commentsRequestRef.current?.abort()
    const requestId = ++commentsRequestIdRef.current
    const controller = new AbortController()
    commentsRequestRef.current = controller
    if (nextCursor) setLoadingMore(true)
    else setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (nextCursor) params.set('cursor', nextCursor)
      const response = await fetch(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/comments?' + params.toString(),
        {
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        },
      )
      const data = await response.json().catch((): null => null)
      if (!response.ok || !data?.data) {
        throw new Error(data?.error?.message || copy.comments.loadError)
      }
      const page = data.data as CommentPage
      if (requestId !== commentsRequestIdRef.current) return
      setComments((current) => nextCursor ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (requestId !== commentsRequestIdRef.current) return
      setMessage(error instanceof Error ? error.message : copy.comments.loadError)
    } finally {
      if (requestId !== commentsRequestIdRef.current) return
      commentsRequestRef.current = null
      setLoading(false)
      setLoadingMore(false)
    }
  }, [contentId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadComments()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      commentsRequestRef.current?.abort()
      commentsRequestRef.current = null
      commentsRequestIdRef.current += 1
    }
  }, [loadComments])



  async function toggleCommentLike(comment: CommentItem) {
    if (likingCommentId) return
    setLikingCommentId(comment.id)
    setMessage('')
    try {
      const statusResponse = await fetch(
        '/api/v1/interactions/likes?targetType=comment&targetId=' + encodeURIComponent(comment.id),
        {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        },
      )

      if (statusResponse.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }

      const statusData = await statusResponse.json().catch((): null => null) as { data?: { liked?: boolean } } | null
      if (!statusResponse.ok || typeof statusData?.data?.liked !== 'boolean') {
        setMessage(statusData?.data ? (locale === 'en' ? 'Could not read comment like status.' : locale === 'tw' ? '留言按讚狀態讀取失敗。' : '评论点赞状态读取失败。') : copy.comments.likeError)
        return
      }

      const liked = statusData.data.liked
      const method = liked ? 'DELETE' : 'POST'
      const response = await fetch('/api/v1/comments/' + encodeURIComponent(comment.id) + '/likes', {
        method,
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'Idempotency-Key': 'social-comment-like:' + crypto.randomUUID(),
        },
      })

      const data = await response.json().catch((): null => null)
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok && response.status !== 204) {
        setMessage(data?.error?.message || copy.comments.likeError)
        return
      }

      setLikedComments((current) => ({ ...current, [comment.id]: !liked }))
    } catch {
      setMessage(copy.comments.networkError)
    } finally {
      setLikingCommentId(null)
    }
  }

  async function deleteComment(comment: CommentItem) {
    if (deletingId || comment.authorUserId !== viewerUserId) return
    setDeletingId(comment.id)
    setMessage('')
    try {
      const response = await fetch(
        '/api/v1/comments/' + encodeURIComponent(comment.id),
        {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': 'social-comment-delete:' + crypto.randomUUID(),
          },
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        const data = await response.json().catch((): null => null)
        setMessage(
          data?.error?.code === 'COMMENT_HAS_REPLIES'
            ? copy.comments.tooManyReplies
            : data?.error?.message || copy.comments.deleteError,
        )
        return
      }
      setComments((current) => current.filter((item) => item.id !== comment.id))
    } catch {
      setMessage(copy.comments.networkError)
    } finally {
      setDeletingId(null)
    }
  }

  async function updateComment(comment: CommentItem) {
    if (savingEdit || comment.authorUserId !== viewerUserId || !editBody.trim()) return
    setSavingEdit(true)
    setMessage('')
    try {
      const response = await fetch(
        '/api/v1/comments/' + encodeURIComponent(comment.id),
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Idempotency-Key': 'social-comment-update:' + crypto.randomUUID(),
            'If-Match': '"' + comment.updatedAt + '"',
          },
          body: JSON.stringify({ body: editBody.trim() }),
        },
      )
      const data = await response.json().catch((): null => null)
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (response.status === 412) {
        setMessage(copy.comments.conflict)
        return
      }
      if (!response.ok || !data?.data) {
        setMessage(data?.error?.message || copy.comments.updateError)
        return
      }
      const updated = data.data as CommentItem
      setComments((current) => current.map((item) => item.id === updated.id ? updated : item))
      setEditingId(null)
      setEditBody('')
    } catch {
      setMessage(copy.comments.networkError)
    } finally {
      setSavingEdit(false)
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!body.trim() || submitting) return
    setSubmitting(true)
    setMessage('')
    const idempotencyKey = crypto.randomUUID()
    try {
      const response = await fetch(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/comments',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({ body: body.trim(), parentId: replyingTo }),
        },
      )
      const data = await response.json().catch((): null => null)
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data) {
        setMessage(data?.error?.message || copy.comments.submitError)
        return
      }
      const created = data.data as CommentItem
      setComments((current) => [...current, created])
      setBody('')
      setReplyingTo(null)
    } catch {
      setMessage(copy.comments.networkError)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="content-comments" aria-labelledby="content-comments-heading">
      <div className="content-comments-heading">
        <h2 id="content-comments-heading">{copy.comments.title}</h2>
      </div>

      {!interactionRestricted ? (
        <form className="content-comment-form" onSubmit={submitComment}>
        <label htmlFor="content-comment-body">{copy.comments.formLabel}</label>
        <textarea
          id="content-comment-body"
          maxLength={10000}
          onChange={(event) => setBody(event.target.value)}
          placeholder={replyingTo ? copy.comments.replyPlaceholder : copy.comments.commentPlaceholder}
          rows={4}
          value={body}
        />
        <div className="content-comment-form-actions">
          <span>{body.length}/10000</span>
          {replyingTo ? (
            <button disabled={submitting} onClick={() => { setReplyingTo(null); setBody('') }} type="button">{copy.comments.cancelReply}</button>
          ) : null}
          <button disabled={!body.trim() || submitting} type="submit">
            {submitting ? copy.comments.submitting : copy.comments.submit}
          </button>
          </div>
        </form>
      ) : (
        <p className="content-comment-message" role="status">{copy.comments.restricted}</p>
      )}

      {message ? <p className="content-comment-message" role="status">{message}</p> : null}

      {loading ? (
        <p className="content-comment-state" role="status">{copy.comments.loading}</p>
      ) : comments.length === 0 ? (
        <p className="content-comment-state">{copy.comments.empty}</p>
      ) : (
        <div className="content-comment-list">
          {comments.map((comment) => (
            <article
              className="content-comment-item"
              key={comment.id}
              style={{ marginInlineStart: Math.min(comment.depth, 3) * 24 }}
            >
              <header>
                <strong>{copy.comments.reader}</strong>
                <Link href={'/users/' + encodeURIComponent(comment.authorUserId)}>
                  {copy.comments.profile}
                </Link>
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString(dateLocale, { hour12: false })}
                </time>
              </header>
              {editingId === comment.id ? (
                <div className="content-comment-form">
                  <label htmlFor={'content-comment-edit-' + comment.id}>{locale === 'en' ? 'Edit comment' : locale === 'tw' ? '編輯留言' : '编辑评论'}</label>
                  <textarea
                    id={'content-comment-edit-' + comment.id}
                    maxLength={10000}
                    onChange={(event) => setEditBody(event.target.value)}
                    rows={4}
                    value={editBody}
                  />
                  <div className="content-comment-form-actions">
                    <span>{editBody.length}/10000</span>
                    <button
                      disabled={savingEdit}
                      onClick={() => {
                        setEditingId(null)
                        setEditBody('')
                      }}
                      type="button"
                    >
                      {copy.comments.cancel}
                    </button>
                    <button
                      disabled={!editBody.trim() || savingEdit}
                      onClick={() => void updateComment(comment)}
                      type="button"
                    >
                      {savingEdit ? copy.comments.saving : copy.comments.save}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p>{comment.body}</p>
                  {!interactionRestricted ? (
                    <button
                      className="content-comment-reply"
                      disabled={likingCommentId === comment.id}
                      onClick={() => void toggleCommentLike(comment)}
                      type="button"
                    >
                      {likingCommentId === comment.id
                        ? copy.comments.processing
                        : likedComments[comment.id]
                          ? copy.comments.liked
                          : copy.comments.like}
                    </button>
                  ) : null}
                  {comment.authorUserId === viewerUserId ? (
                    <button
                      className="content-comment-reply"
                      onClick={() => {
                        setEditingId(comment.id)
                        setEditBody(comment.body)
                        setReplyingTo(null)
                        setMessage('')
                      }}
                      type="button"
                    >
                      {copy.comments.edit}
                    </button>
                  ) : null}
                  {comment.authorUserId === viewerUserId ? (
                    <button
                      className="content-comment-reply"
                      disabled={deletingId === comment.id}
                      onClick={() => void deleteComment(comment)}
                      type="button"
                    >
                      {deletingId === comment.id ? copy.comments.deleting : copy.comments.delete}
                    </button>
                  ) : null}
                  {!interactionRestricted && comment.depth < 3 ? (
                    <button
                      className="content-comment-reply"
                      onClick={() => {
                        setReplyingTo(comment.id)
                        setBody('')
                        setMessage('')
                      }}
                      type="button"
                    >
                      {copy.comments.reply}
                    </button>
                  ) : null}
                </>
              )}
            </article>
          ))}
        </div>
      )}

      {hasMore ? (
        <button
          className="content-comments-load-more"
          disabled={loadingMore}
          onClick={() => void loadComments(cursor)}
          type="button"
        >
          {loadingMore ? copy.content.loading : copy.comments.more}
        </button>
      ) : null}
    </section>
  )
}
