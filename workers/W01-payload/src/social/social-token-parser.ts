export type SocialTokenKind = 'mention' | 'hashtag'

export type SocialToken = {
  kind: SocialTokenKind
  value: string
  normalized: string
  start: number
  end: number
}

const TOKEN_PATTERN = /(^|[\s([{"'“‘，。！？；：、])([@#])([\p{L}\p{N}_]{1,64})/gu

export function extractSocialTokens(input: string): SocialToken[] {
  const source = input.normalize('NFKC')
  const tokens: SocialToken[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = TOKEN_PATTERN.exec(source)) !== null) {
    const marker = match[2]
    const value = match[3]
    const kind: SocialTokenKind = marker === '@' ? 'mention' : 'hashtag'
    const normalized = value.toLocaleLowerCase('en-US')
    const start = match.index + match[1].length
    const end = start + marker.length + value.length
    const key = kind + ':' + normalized

    if (seen.has(key)) continue
    seen.add(key)
    tokens.push({
      kind,
      value: marker + value,
      normalized,
      start,
      end,
    })
  }

  return tokens
}
