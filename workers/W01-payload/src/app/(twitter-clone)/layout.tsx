import type { Metadata } from 'next'
import React from 'react'
import '../(frontend)/styles.css'
import '../../styles/twitter-clone-globals.scss'
import UmamiAnalytics from '../(frontend)/UmamiAnalytics'

export const metadata: Metadata = {
  description: 'LuckRead 是面向新一代创作者与读者的内容平台，让好内容被看见，让阅读、表达与连接产生长期价值。',
  title: 'LuckRead · 让好内容被看见',
}

export default function TwitterCloneLayout(props: { children: React.ReactNode }) {
  return <html className="dark" lang="en"><body><UmamiAnalytics />{props.children}</body></html>
}
