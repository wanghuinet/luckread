'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { fetchJson } from '../../lib/client-api.js'
import type { PublicLocale } from '../(frontend)/i18n/public-locale'
import { getTwitterCloneCopy } from './twitter-clone-copy'

type CurrentProfile = {
  id: string
  email: string
  username: string
  displayName: string | null
  avatar: string | null
}

export default function TwitterCloneSidebarProfile({ locale }: { locale: PublicLocale }) {
  const copy = getTwitterCloneCopy(locale)
  const [profile, setProfile] = useState<CurrentProfile | null>(null)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchJson<CurrentProfile>('/api/v1/users/me', {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    }).then(({ response, data }) => {
      if (cancelled) return
      if (response.ok && data?.id && data.username) {
        setProfile(data)
        setSignedIn(true)
      } else {
        setSignedIn(false)
      }
    }).catch(() => {
      if (!cancelled) setSignedIn(false)
    })
    return () => { cancelled = true }
  }, [])

  const label = profile?.displayName?.trim() || profile?.username || (signedIn === false
    ? (locale === 'en' ? 'Sign in' : locale === 'tw' ? '登入' : '登录')
    : (locale === 'en' ? 'Loading profile…' : locale === 'tw' ? '載入個人資料…' : '正在加载个人资料…'))
  const href = signedIn === false ? '/login?returnTo=%2Fhome' : profile?.username ? '/' + encodeURIComponent(profile.username) : '/me/profile'
  const initial = label.trim().charAt(0).toUpperCase() || 'L'

  return <Link className="hidden items-center gap-3 rounded-full p-3 transition hover:bg-light-primary/10 dark:hover:bg-dark-primary/10 xl:flex" href={href} aria-label={copy.home.profileAndSettings}>
    {profile?.avatar
      ? <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-main-sidebar-background"><img alt="" className="h-full w-full object-cover" src={profile.avatar} /></span>
      : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-main-sidebar-background font-bold">{initial}</span>}
    <span className="grid min-w-0">
      <strong className="truncate text-sm">{label}</strong>
      <small className="truncate text-light-secondary dark:text-dark-secondary">{profile?.username ? '@' + profile.username : copy.home.profileAndSettings}</small>
    </span>
  </Link>
}
