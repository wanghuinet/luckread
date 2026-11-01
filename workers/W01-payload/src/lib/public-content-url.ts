export type PublicContentRouteType = 'article' | 'post' | 'video' | 'short'

type PublicContentHrefInput = {
  id: string
  slug?: string | null
  contentType?: 'article' | 'post' | 'video' | string
  creator?: { username?: string | null } | null
  author?: { username?: string | null } | null
  authorUsername?: string | null
}

export function buildPublicContentHref(
  content: PublicContentHrefInput,
  options: { short?: boolean } = {},
): string {
  const id = content.id.trim()
  if (!id) return '/content/' + encodeURIComponent(content.slug || content.id)

  const username = (
    content.authorUsername ||
    content.creator?.username ||
    content.author?.username ||
    ''
  ).trim().replace(/^@+/, '')

  // Older API projections may not yet contain an author handle. Keep those
  // links working through the compatibility route; it redirects once the
  // canonical author projection is available.
  if (!username) return '/content/' + encodeURIComponent(content.slug || id)

  const segment: PublicContentRouteType = options.short
    ? 'short'
    : content.contentType === 'article'
      ? 'article'
      : content.contentType === 'post'
        ? 'post'
        : 'video'

  return '/@' + encodeURIComponent(username) + '/' + segment + '/' + encodeURIComponent(id)
}
