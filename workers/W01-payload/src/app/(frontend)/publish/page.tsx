import PublishComposer from './PublishComposer'
import './publish.css'

export default function PublishPage() {
  return (
    <main className="lr-publish-shell">
      <div className="lr-publish-topbar">
        <a href="/" className="lr-wordmark">LuckRead</a>
        <a href="/login" className="lr-quiet-link">切换账号</a>
      </div>
      <section className="lr-publish-layout">
        <div>
          <span className="lr-eyebrow">创作者中心</span>
          <h1>发布内容</h1>
          <p className="lr-subtitle">一套编辑器，覆盖文章、动态、图文与视频。</p>
        </div>
        <PublishComposer />
      </section>
    </main>
  )
}
