import type { Metadata } from 'next'

import ShortVideoFeed from './ShortVideoFeed'

export const metadata: Metadata = {
  title: '短视频 · LuckRead',
  description: '全屏沉浸式短视频浏览。',
}

export default function ShortsPage() {
  return <ShortVideoFeed />
}
