import { Suspense } from 'react'
import LoginForm from './LoginForm'
import './login.css'

export default function LoginPage() {
  return (
    <main className="lr-auth-shell">
      <section className="lr-auth-card">
        <div className="lr-brand">LuckRead</div>
        <h1>登录创作者中心</h1>
        <p className="lr-muted">登录后可以创建文章、动态和视频内容。</p>
        <Suspense fallback={<p className="lr-muted" role="status">正在加载登录页面…</p>}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  )
}
