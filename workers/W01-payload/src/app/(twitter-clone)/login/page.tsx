import { Suspense } from 'react'
import Link from 'next/link'
import LoginForm from '../../(frontend)/login/LoginForm'

export default function LoginPage() {
  return <div className="min-h-screen bg-main-background text-light-primary dark:text-dark-primary">
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col border-x border-light-border dark:border-dark-border">
      <header className="sticky top-0 z-10 flex items-center gap-6 bg-main-background/60 px-4 py-3 backdrop-blur-md">
        <Link aria-label="LuckRead home" className="custom-button main-tab text-accent-blue dark:text-twitter-icon" href="/"><span className="text-2xl font-bold">L</span></Link><h1 className="text-xl font-bold">Sign in to LuckRead</h1>
      </header>
      <section className="flex flex-col gap-6 px-8 py-10"><h2 className="font-twitter-chirp-extended text-3xl">Welcome back.</h2>
        <Suspense fallback={<p className="text-sm text-light-secondary dark:text-dark-secondary">Loading sign-in form…</p>}><LoginForm /></Suspense>
        <p className="text-center text-sm text-light-secondary dark:text-dark-secondary">New to LuckRead? <Link className="text-main-accent hover:underline" href="/register">Create an account</Link></p>
      </section>
    </main>
  </div>
}
