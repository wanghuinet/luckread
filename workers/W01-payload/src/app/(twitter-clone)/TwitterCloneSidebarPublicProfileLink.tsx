'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { fetchJson } from '../../lib/client-api.js'
import type { PublicLocale } from '../(frontend)/i18n/public-locale'
import { getTwitterCloneCopy } from './twitter-clone-copy'

type CurrentProfile = {
  id?: string
  username?: string
}

export default function TwitterCloneSidebarPublicProfileLink({
  locale,
  active = false,
}: {
  locale: PublicLocale
  active?: boolean
}) {
  const pathname = usePathname()
  const copy = getTwitterCloneCopy(locale)
  const [href, setHref] = useState('/me/profile')

  useEffect(() => {
    const controller = new AbortController()
    void fetchJson<CurrentProfile>('/api/v1/users/me', {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    }).then(({ response, data }) => {
      if (controller.signal.aborted) return
      if (response.ok && typeof data?.username === 'string' && data.username) {
        setHref('/' + encodeURIComponent(data.username))
      } else if (response.status === 401) {
        setHref('/login?returnTo=%2Fhome')
      }
    }).catch(() => {
      // Keep the existing account-profile route available if identity lookup fails.
    })
    return () => controller.abort()
  }, [])

  const isActive = active || (href !== '/me/profile' && pathname === href)
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={'custom-button main-tab flex items-center gap-5 rounded-full hover:bg-light-primary/10 dark:hover:bg-dark-primary/10 xl:justify-start' + (isActive ? ' font-bold' : '')}
    >
      <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        <path d="M20 21a8 8 0 0 0-16 0m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
      </svg>
      <span className="hidden text-xl xl:inline">{copy.home.profile}</span>
    </Link>
  )
}
