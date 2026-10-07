'use client'

import Link from 'next/link'
import { ChangeEvent, useCallback, useEffect, useState } from 'react'

type MediaItem = {
  id: string | number
  url?: string | null
  filename?: string | null
  mimeType?: string | null
  filesize?: number | null
  alt?: string | null
}

type MediaListResponse = {
  docs?: MediaItem[]
  totalDocs?: number
  page?: number
  totalPages?: number
}

function redirectToLogin(loginPath: '/admin/login' | '/login') {
  const returnTo = window.location.pathname + window.location.search + window.location.hash
  window.location.assign(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
}

export default function CreatorAssetLibrary({ adminMode = true, loginPath = '/admin/login' }: { adminMode?: boolean; loginPath?: '/admin/login' | '/login' }) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [totalDocs, setTotalDocs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | number | null>(null)
  const [editingAlt, setEditingAlt] = useState('')
  const [error, setError] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async (page = 1, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/v1/media?limit=8&page=' + String(page), {
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      const data = await response.json().catch((): null => null) as MediaListResponse | { error?: { message?: string } } | null
      if (response.status === 401) {
        redirectToLogin(loginPath)
        return
      }
      if (!response.ok) {
        throw new Error(data && 'error' in data ? data.error?.message || '素材读取失败' : '素材读取失败')
      }
      const nextItems = Array.isArray((data as MediaListResponse)?.docs)
        ? (data as MediaListResponse).docs!
        : []
      setItems((current) => append ? [...current, ...nextItems] : nextItems)
      setTotalDocs(typeof (data as MediaListResponse)?.totalDocs === 'number' ? (data as MediaListResponse).totalDocs! : 0)
      setPageNumber(typeof (data as MediaListResponse)?.page === 'number' ? (data as MediaListResponse).page! : page)
      setTotalPages(typeof (data as MediaListResponse)?.totalPages === 'number' ? (data as MediaListResponse).totalPages! : 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '素材读取失败')
      setItems([])
      setTotalDocs(0)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [loginPath])

  async function loadMore() {
    if (loadingMore || pageNumber >= totalPages) return
    await load(pageNumber + 1, true)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 8)
    event.target.value = ''
    if (!files.length) return

    setError('')
    setMessage('正在上传素材…')
    try {
      let uploaded = 0
      for (const file of files) {
        const form = new FormData()
        form.append('_payload', JSON.stringify({ alt: file.name }))
        form.append('file', file)
        const response = await fetch('/api/v1/media', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Idempotency-Key': 'media-upload:' + crypto.randomUUID() },
          body: form,
        })
        const data = await response.json().catch((): null => null) as MediaItem | { doc?: MediaItem; error?: { message?: string } } | null
        if (response.status === 401) {
          redirectToLogin(loginPath)
          return
        }
        if (!response.ok) {
          throw new Error(data && 'error' in data ? data.error?.message || '素材上传失败' : '素材上传失败')
        }
        uploaded += 1
      }
      setMessage('已上传 ' + uploaded + ' 个素材。')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '素材上传失败')
      await load()
    }
  }

  async function saveAlt(item: MediaItem) {
    const alt = editingAlt.trim()
    if (!alt) {
      setError('素材说明不能为空')
      return
    }
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/v1/media/' + encodeURIComponent(String(item.id)), {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ alt }),
      })
      const data = await response.json().catch((): null => null) as MediaItem | { error?: { message?: string } } | null
      if (response.status === 401) {
        redirectToLogin(loginPath)
        return
      }
      if (!response.ok) {
        throw new Error(data && 'error' in data ? data.error?.message || '素材更新失败' : '素材更新失败')
      }
      const updated = data as MediaItem
      setItems((current) => current.map((currentItem) =>
        String(currentItem.id) === String(item.id)
          ? { ...currentItem, alt: typeof updated.alt === 'string' ? updated.alt : alt }
          : currentItem,
      ))
      setEditingId(null)
      setMessage('素材说明已更新。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '素材更新失败')
    }
  }

  async function remove(id: string | number) {
    if (!window.confirm('确定删除这个素材吗？已被内容引用的地址可能随之失效。')) return
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/v1/media/' + encodeURIComponent(String(id)), {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'Idempotency-Key': 'media-delete:' + crypto.randomUUID(),
        },
      })
      if (response.status === 401) {
        redirectToLogin(loginPath)
        return
      }
      if (!response.ok) {
        const data = await response.json().catch((): null => null) as { error?: { message?: string } } | null
        throw new Error(data?.error?.message || '素材删除失败')
      }
      setItems((current) => current.filter((item) => String(item.id) !== String(id)))
      setTotalDocs((current) => Math.max(0, current - 1))
      setMessage('素材已删除。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '素材删除失败')
    }
  }

  const formatSize = (value?: number | null) => {
    if (!value || value <= 0) return ''
    if (value < 1024 * 1024) return Math.round(value / 1024) + ' KB'
    return (value / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <div>
      <div className="assetLinks">
        {adminMode ? <Link className="secondaryButton btn" href="/admin/collections/media">打开完整媒体库</Link> : null}
        <label className="primaryButton btn">
          上传素材
          <input
            accept="image/*,video/*"
            hidden
            multiple
            onChange={uploadFiles}
            type="file"
          />
        </label>
        <Link className="secondaryButton btn" href="/publish">上传并发布</Link>
        <button className="secondaryButton btn" disabled={loading || loadingMore} onClick={() => void load()} type="button">
          {loading ? '加载中…' : '刷新'}
        </button>
      </div>

      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      {loading && items.length === 0 ? (
        <p>正在读取你的素材…</p>
      ) : items.length === 0 ? (
        <p>还没有素材。上传第一张图片或一个视频后，这里会显示最近使用的 8 个素材。</p>
      ) : (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: 18 }}>
          {items.map((item) => {
            const url = typeof item.url === 'string' ? item.url : ''
            const mimeType = typeof item.mimeType === 'string' ? item.mimeType : ''
            const isVideo = mimeType.startsWith('video/')
            return (
              <article key={item.id} style={{ border: '1px solid var(--lr-line)', borderRadius: 14, overflow: 'hidden', background: 'var(--lr-surface)' }}>
                <div style={{ aspectRatio: '16 / 10', background: 'var(--lr-surface-2, #f4f6f8)' }}>
                  {url && isVideo ? (
                    <video aria-label={item.filename || '视频素材'} muted playsInline preload="metadata" src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : url ? (
                    <img alt={item.filename || '图片素材'} loading="lazy" src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                </div>
                <div style={{ display: 'grid', gap: 5, padding: 11 }}>
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.filename || '未命名素材'}</strong>
                  {editingId === item.id ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <input
                        aria-label="素材说明"
                        maxLength={1000}
                        onChange={(event) => setEditingAlt(event.target.value)}
                        value={editingAlt}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="primaryButton btn" onClick={() => void saveAlt(item)} type="button">保存</button>
                        <button className="secondaryButton btn" onClick={() => { setEditingId(null); setError('') }} type="button">取消</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="secondaryButton btn"
                      onClick={() => { setEditingId(item.id); setEditingAlt(item.alt || '') }}
                      type="button"
                    >
                      编辑说明
                    </button>
                  )}
                  <span style={{ color: 'var(--lr-text-3)', fontSize: 10 }}>{mimeType || '媒体'} {formatSize(item.filesize) ? ' · ' + formatSize(item.filesize) : ''}</span>
                  <button className="secondaryButton btn" onClick={() => void remove(item.id)} type="button">删除</button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {items.length > 0 && pageNumber < totalPages ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
          <button
            className="secondaryButton btn"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            type="button"
          >
            {loadingMore ? '加载中…' : '加载更多素材'}
          </button>
        </div>
      ) : null}

      <p style={{ color: 'var(--lr-text-3)', fontSize: 10, marginTop: 12 }}>
        已显示 {items.length} 个 / 共 {totalDocs} 个素材
      </p>
    </div>
  )
}
