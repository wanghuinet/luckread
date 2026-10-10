import Link from 'next/link'

import VerifyEmailForm from './VerifyEmailForm'
import '../login/login.css'

export default function VerifyEmailPage() {
  return (
    <main className="lr-auth-shell">
      <section className="lr-auth-card" aria-labelledby="verify-email-title">
        <Link className="lr-brand" href="/" aria-label="LuckRead 首页">LuckRead</Link>
        <h1 id="verify-email-title">重发验证邮件</h1>
        <p className="lr-muted">
          注册后没有收到验证邮件？输入注册时使用的邮箱，我们会提交验证邮件请求。
        </p>
        <VerifyEmailForm />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 20 }}>
          <Link className="lr-link" href="/login">返回登录</Link>
          <Link className="lr-link" href="/register">创建账号</Link>
        </div>
      </section>
    </main>
  )
}
