import Image from 'next/image'
import Link from 'next/link'

export function TwitterLogo({ className = 'h-6 w-6' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M23.643 4.937c-.835.37-1.732.62-2.675.733.962-.576 1.7-1.49 2.048-2.578-.9.534-1.897.922-2.958 1.13-.85-.904-2.06-1.47-3.4-1.47-2.572 0-4.658 2.086-4.658 4.66 0 .364.042.718.12 1.06-3.873-.195-7.304-2.05-9.602-4.868-.4.69-.63 1.49-.63 2.342 0 1.616.823 3.043 2.072 3.878-.764-.025-1.482-.234-2.11-.583v.06c0 2.257 1.605 4.14 3.737 4.568-.392.106-.803.162-1.227.162-.3 0-.593-.028-.877-.082.593 1.85 2.313 3.198 4.352 3.234-1.595 1.25-3.604 1.995-5.786 1.995-.376 0-.747-.022-1.112-.065 2.062 1.323 4.51 2.093 7.14 2.093 8.57 0 13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602.91-.658 1.7-1.477 2.323-2.41z" /></svg>
}

export default function TwitterCloneLanding() {
  return <div className="grid min-h-screen grid-rows-[1fr,auto] bg-main-background text-light-primary dark:text-dark-primary">
    <main className="grid min-h-[calc(100vh-64px)] lg:grid-cols-[1fr,45vw]">
      <div className="relative hidden items-center justify-center overflow-hidden lg:flex">
        <Image alt="" className="object-cover" fill priority sizes="55vw" src="/twitter-clone/assets/twitter-banner.png" />
        <div className="absolute inset-0 bg-black/10" />
        <i className="absolute"><TwitterLogo className="h-96 w-96 text-white" /></i>
      </div>
      <div className="flex flex-col items-center justify-between gap-6 p-8 lg:items-start lg:justify-center">
        <i className="mb-0 self-center text-accent-blue lg:mb-10 lg:self-auto dark:text-twitter-icon"><TwitterLogo className="-mt-4 h-8 w-8 lg:h-12 lg:w-12" /></i>
        <div className="flex max-w-xs flex-col gap-4 font-twitter-chirp-extended lg:max-w-none lg:gap-16">
          <h1 className="text-3xl leading-tight lg:text-6xl">Happening now</h1>
          <h2 className="hidden text-xl lg:block lg:text-3xl">Join LuckRead today.</h2>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-6 lg:max-w-sm">
          <div className="grid gap-3 font-bold">
            <Link className="flex justify-center rounded-full border border-light-line-reply bg-white px-4 py-3 text-light-primary transition hover:bg-[#e6e6e6] active:bg-[#cccccc] dark:border-0" href="/register">Sign up with email</Link>
            <div className="grid w-full grid-cols-[1fr,auto,1fr] items-center gap-2"><i className="border-b border-light-border dark:border-dark-border" /><p className="text-sm">or</p><i className="border-b border-light-border dark:border-dark-border" /></div>
            <Link className="flex justify-center rounded-full bg-main-accent px-4 py-3 text-white transition hover:brightness-90 active:brightness-75" href="/login">Sign in</Link>
            <p className="text-xs leading-relaxed text-light-secondary dark:text-dark-secondary">By signing up, you agree to LuckRead&apos;s terms and privacy practices. LuckRead account, publishing, and social actions remain protected by the existing account and permission services.</p>
          </div>
          <div className="flex flex-col gap-3"><p className="font-bold">Already have an account?</p><Link className="flex justify-center rounded-full border border-light-line-reply px-4 py-3 font-bold text-main-accent transition hover:bg-main-accent/10 dark:border-dark-border" href="/login">Sign in</Link></div>
        </div>
      </div>
    </main>
    <footer className="hidden justify-center px-4 py-5 text-sm text-light-secondary dark:text-dark-secondary lg:flex"><nav className="flex flex-wrap justify-center gap-4 gap-y-2">
      <Link className="custom-underline" data-umami-event="content-discovery-open" href="/content">Explore</Link><Link className="custom-underline" data-umami-event="short-video-discovery-open" href="/shorts">Short videos</Link><Link className="custom-underline" data-umami-event="creator-center-open" href="/creator-center">Creator Studio</Link><Link className="custom-underline" href="/me/subscriptions">Subscriptions</Link><span>© LuckRead</span>
    </nav></footer>
  </div>
}
