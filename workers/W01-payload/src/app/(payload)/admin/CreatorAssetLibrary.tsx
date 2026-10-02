'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

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
  totalPages?: number
}

export default function CreatorAssetLibrary() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [totalDocs, setTotalDocs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | number | null>(null)
  const [editingAlt, setEditingAlt] = useState('')
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/v1/media?limit=8&page=1', {
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      const data = await response.json().catch((): null => null) as MediaListResponse | { error?: { message?: string } } | null
      if (!response.ok) {
        throw new Error(data && 'error' in data ? data.error?.message || '素材读取失败' : '素材读取失败')
      }
      setItems(Array.isArray((data as MediaListResponse)?.docs) ? (data as MediaListResponse).docs! : [])
      setTotalDocs(typeof (data as MediaListResponse)?.totalDocs === 'number' ? (data as MediaListResponse).totalDocs! : 0)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '素材读取失败')
      setItems([])
      setTotalDocs(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

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
        headers: { accept: 'application/json' },
      })
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
        <Link className="secondaryButton btn" href="/admin/collections/media">打开完整媒体库</Link>
        <Link className="primaryButton btn" href="/publish">上传并发布</Link>
        <button className="secondaryButton btn" disabled={loading} onClick={() => void load()} type="button">
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

      <p style={{ color: 'var(--lr-text-3)', fontSize: 10, marginTop: 12 }}>
        最近 {Math.min(items.length, 8)} 个 / 共 {totalDocs} 个素材
      </p>
    </div>
  )
}
