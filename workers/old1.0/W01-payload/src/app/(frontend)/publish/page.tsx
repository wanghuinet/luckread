import Link from 'next/link'

import PublishComposer from './PublishComposer'
import './publish.css'

type ContentType = 'article' | 'post' | 'video'

function normalizeContentType(value: string | string[] | undefined): ContentType {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate === 'post' || candidate === 'video' ? candidate : 'article'
}

export default async function PublishPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[]; draft?: string | string[] }>
}) {
  const params = await searchParams
  const initialType = normalizeContentType(params.type)
  return (
    <main className="lr-publish-shell">
      <div className="lr-publish-topbar">
        <Link href="/" className="lr-wordmark">LuckRead</Link>
        <Link href="/login" className="lr-quiet-link">切换账号</Link>
      </div>
      <section className="lr-publish-layout">
        <div>
          <span className="lr-eyebrow">创作者中心</span>
          <h1>发布内容</h1>
          <p className="lr-subtitle">一套编辑器，覆盖文章、动态、图文与视频。</p>
        </div>
        <PublishComposer initialType={initialType} />
      </section>
    </main>
  )
}
