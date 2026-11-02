import Link from 'next/link'
import type { ReactNode } from 'react'

export type SocialMentionReference = {
  userId: string
  handle: string
}

const normalizeHandle = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase('en-US')

export default function SocialMentionText({
  text,
  mentions,
}: {
  text: string
  mentions: readonly SocialMentionReference[]
}) {
  const byHandle = new Map<string, SocialMentionReference | null>()
  for (const mention of mentions) {
    const handle = mention.handle.trim().replace(/^[@＠]/, '')
    const userId = mention.userId.trim()
    if (!handle || !userId) continue
    const key = normalizeHandle(handle)
    const existing = byHandle.get(key)
    if (existing && existing.userId !== userId) {
      byHandle.set(key, null)
    } else if (!byHandle.has(key)) {
      byHandle.set(key, { userId, handle })
    }
  }

  const nodes: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  const pattern = /(^|[\\s([{"'“‘，。！？；：、])([@＠])([\\p{L}\\p{N}_]{1,64})/gu
  while ((match = pattern.exec(text)) !== null) {
    const marker = match[2]
    const handle = match[3]
    const mention = byHandle.get(normalizeHandle(handle))
    if (!mention) continue

    const start = match.index + match[1].length
    const end = start + marker.length + handle.length
    nodes.push(text.slice(cursor, start))
    nodes.push(
      <Link
        className="text-main-accent hover:underline"
        href={'/users/' + encodeURIComponent(mention.userId)}
        key={'mention:' + start + ':' + mention.userId}
      >
        {marker + handle}
      </Link>,
    )
    cursor = end
  }

  nodes.push(text.slice(cursor))
  return <>{nodes}</>
}
