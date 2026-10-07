const CONTENT_SLUG_MAX_LENGTH = 128
const CONTENT_SLUG_BASE_MAX_LENGTH = 95

const normalizeTitle = (title: string): string =>
  title.normalize('NFKC').trim().toLowerCase()

export const contentSlugFor = (title: string, contentId: string): string => {
  const normalized = normalizeTitle(title)
  const base = normalized
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CONTENT_SLUG_BASE_MAX_LENGTH)
    .replace(/-+$/g, '')
  const suffix = contentId.replaceAll('-', '').slice(0, 32).toLowerCase()
  const prefix = base || 'content'
  const slug = prefix + '-' + suffix
  return slug.slice(0, CONTENT_SLUG_MAX_LENGTH)
}

export const isContentSlug = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 2 &&
  value.length <= CONTENT_SLUG_MAX_LENGTH &&
  /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(value)
