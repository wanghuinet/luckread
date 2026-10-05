import type { Metadata } from 'next'
import React from 'react'

import './styles.css'

export const metadata: Metadata = {
  description: 'LuckRead 是面向新一代创作者与读者的内容平台，让好内容被看见，让阅读、表达与连接产生长期价值。',
  title: 'LuckRead · 让好内容被看见',
}

export default function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props
  return (
    <html lang="zh-CN">
      <body><main>{children}</main></body>
    </html>
  )
}
