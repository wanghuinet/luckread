'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'

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
}: {
  contentId: string
  viewerUserId: string | null
  interactionRestricted?: boolean
}) {
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
        throw new Error(data?.error?.message || '评论加载失败')
      }
      const page = data.data as CommentPage
      if (requestId !== commentsRequestIdRef.current) return
      setComments((current) => nextCursor ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (requestId !== commentsRequestIdRef.current) return
      setMessage(error instanceof Error ? error.message : '评论加载失败')
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
        setMessage(statusData?.data ? '评论点赞状态读取失败。' : '评论点赞失败，请稍后重试。')
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
        setMessage(data?.error?.message || '评论点赞失败，请稍后重试。')
        return
      }

      setLikedComments((current) => ({ ...current, [comment.id]: !liked }))
    } catch {
      setMessage('网络异常，请稍后重试。')
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
            ? '该评论已有回复，暂不支持删除。'
            : data?.error?.message || '评论删除失败，请稍后重试。',
        )
        return
      }
      setComments((current) => current.filter((item) => item.id !== comment.id))
    } catch {
      setMessage('网络异常，请稍后重试。')
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
        setMessage('评论已经被修改，请刷新后再编辑。')
        return
      }
      if (!response.ok || !data?.data) {
        setMessage(data?.error?.message || '评论修改失败，请稍后重试。')
        return
      }
      const updated = data.data as CommentItem
      setComments((current) => current.map((item) => item.id === updated.id ? updated : item))
      setEditingId(null)
      setEditBody('')
    } catch {
      setMessage('网络异常，请稍后重试。')
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
        setMessage(data?.error?.message || '评论提交失败，请稍后重试。')
        return
      }
      const created = data.data as CommentItem
      setComments((current) => [...current, created])
      setBody('')
      setReplyingTo(null)
    } catch {
      setMessage('网络异常，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="content-comments" aria-labelledby="content-comments-heading">
      <div className="content-comments-heading">
        <h2 id="content-comments-heading">评论</h2>
      </div>

      {!interactionRestricted ? (
        <form className="content-comment-form" onSubmit={submitComment}>
        <label htmlFor="content-comment-body">发表评论</label>
        <textarea
          id="content-comment-body"
          maxLength={10000}
          onChange={(event) => setBody(event.target.value)}
          placeholder={replyingTo ? '写下你的回复…' : '写下你的看法…'}
          rows={4}
          value={body}
        />
        <div className="content-comment-form-actions">
          <span>{body.length}/10000</span>
          {replyingTo ? (
            <button disabled={submitting} onClick={() => { setReplyingTo(null); setBody('') }} type="button">取消回复</button>
          ) : null}
          <button disabled={!body.trim() || submitting} type="submit">
            {submitting ? '提交中…' : '发表评论'}
          </button>
          </div>
        </form>
      ) : (
        <p className="content-comment-message" role="status">当前关系受屏蔽规则限制，暂不可发表评论或互动。</p>
      )}

      {message ? <p className="content-comment-message" role="status">{message}</p> : null}

      {loading ? (
        <p className="content-comment-state" role="status">正在加载评论…</p>
      ) : comments.length === 0 ? (
        <p className="content-comment-state">还没有评论，来发表第一条吧。</p>
      ) : (
        <div className="content-comment-list">
          {comments.map((comment) => (
            <article
              className="content-comment-item"
              key={comment.id}
              style={{ marginInlineStart: Math.min(comment.depth, 3) * 24 }}
            >
              <header>
                <strong>读者</strong>
                <Link href={'/users/' + encodeURIComponent(comment.authorUserId)}>
                  查看主页
                </Link>
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </time>
              </header>
              {editingId === comment.id ? (
                <div className="content-comment-form">
                  <label htmlFor={'content-comment-edit-' + comment.id}>编辑评论</label>
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
                      取消
                    </button>
                    <button
                      disabled={!editBody.trim() || savingEdit}
                      onClick={() => void updateComment(comment)}
                      type="button"
                    >
                      {savingEdit ? '保存中…' : '保存修改'}
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
                        ? '处理中…'
                        : likedComments[comment.id]
                          ? '已赞'
                          : '赞'}
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
                      编辑
                    </button>
                  ) : null}
                  {comment.authorUserId === viewerUserId ? (
                    <button
                      className="content-comment-reply"
                      disabled={deletingId === comment.id}
                      onClick={() => void deleteComment(comment)}
                      type="button"
                    >
                      {deletingId === comment.id ? '删除中…' : '删除'}
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
                      回复
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
          {loadingMore ? '加载中…' : '加载更多评论'}
        </button>
      ) : null}
    </section>
  )
}
