import type { Metadata } from 'next'
import React from 'react'

import UmamiAnalytics from '../(frontend)/UmamiAnalytics'
import '../(frontend)/styles.css'
import '../../styles/twitter-clone-globals.scss'

export const metadata: Metadata = {
  description: 'LuckRead is a creator-focused platform for reading, sharing, and discovering articles, posts, and videos.',
  title: 'LuckRead · Discover and share great content',
}

export default function TwitterCloneLayout(props: { children: React.ReactNode }) {
  return (
    <html className="dark" lang="en">
      <body>
        <UmamiAnalytics />
        {props.children}
      </body>
    </html>
  )
}
