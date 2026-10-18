import Link from 'next/link'

import VerifyEmailForm from './VerifyEmailForm'

export default function VerifyEmailPage() {
  return (
    <main className="min-h-screen bg-main-background px-4 py-10 text-light-primary dark:text-dark-primary">
      <section className="mx-auto flex w-full max-w-xl flex-col gap-5 border-x border-light-border px-6 py-8 dark:border-dark-border" aria-labelledby="verify-email-title">
        <Link className="mb-2 text-2xl font-bold text-light-primary dark:text-dark-primary" href="/" aria-label="LuckRead 首页">LuckRead</Link>
        <h1 id="verify-email-title">重发验证邮件</h1>
        <p className="text-sm text-light-secondary dark:text-dark-secondary">
          注册后没有收到验证邮件？输入注册时使用的邮箱，我们会提交验证邮件请求。
        </p>
        <VerifyEmailForm />
        <div className="mt-5 flex justify-between gap-3">
          <Link className="text-sm font-medium text-main-accent hover:underline" href="/login">返回登录</Link>
          <Link className="text-sm font-medium text-main-accent hover:underline" href="/register">创建账号</Link>
        </div>
      </section>
    </main>
  )
}
