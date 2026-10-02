'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type ShareResponse = {
  data?: {
    shareId?: string
    contentId?: string
  }
  error?: { message?: string }
}

export default function ShareLandingPage({
  params,
}: {
  params: Promise<{ shareId: string }>
}) {
  const router = useRouter()
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const { shareId } = await params
        if (!shareId?.trim()) throw new Error('分享链接无效')

        const response = await fetch('/api/v1/shares/' + encodeURIComponent(shareId), {
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })
        const data = await response.json().catch((): null => null) as ShareResponse | null
        if (!response.ok || typeof data?.data?.contentId !== 'string' || !data.data.contentId) {
          throw new Error(data?.error?.message || '分享内容不存在或已下线。')
        }

        router.replace('/content/' + encodeURIComponent(data.data.contentId))
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : '分享内容暂时无法打开。')
      }
    })()

    return () => controller.abort()
  }, [params, router])

  return (
    <main style={{ maxWidth: 640, margin: '20vh auto', padding: '0 20px' }}>
      {error ? (
        <>
          <h1>分享链接无法打开</h1>
          <p>{error}</p>
          <Link href="/content">去发现内容</Link>
        </>
      ) : (
        <p role="status">正在打开分享内容…</p>
      )}
    </main>
  )
}
