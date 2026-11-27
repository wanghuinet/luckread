import type { Metadata } from 'next'
import React from 'react'
import { cookies } from 'next/headers'
import { normalizePublicLocale } from '../(frontend)/i18n/public-locale'
import '../(frontend)/styles.css'
import '../../styles/twitter-clone-globals.scss'
import UmamiAnalytics from '../(frontend)/UmamiAnalytics'

export const metadata: Metadata = {
  description: 'LuckRead 是面向新一代创作者与读者的内容平台，让好内容被看见，让阅读、表达与连接产生长期价值。',
  title: 'LuckRead · 让好内容被看见',
}

export default async function TwitterCloneLayout(props: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const theme = cookieStore.get('luckread-ui-theme')?.value === 'light' ? 'light' : 'dark'
  const locale = normalizePublicLocale(cookieStore.get('luckread-ui-locale')?.value)
  const language = locale === 'en' ? 'en' : locale === 'tw' ? 'zh-TW' : 'zh-CN'

  return <html className={theme === 'dark' ? 'dark' : undefined} lang={language}><body><UmamiAnalytics />{props.children}</body></html>
}
