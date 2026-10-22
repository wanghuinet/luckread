export const PUBLIC_MEDIA_ORIGIN = 'https://cdn.luckread.com'

export interface PublicMediaUrlInput {
  filename: string
  prefix?: string
}

/**
 * Build a stable public URL for a file already stored under the Payload R2
 * object key. Each key segment is encoded independently so nested prefixes
 * remain path separators while spaces and other filename characters are safe.
 */
export function createPublicMediaUrl({ filename, prefix = '' }: PublicMediaUrlInput): string {
  const segments = [...prefix.split('/'), filename].filter(Boolean)

  if (!filename.trim() || filename.includes('/') || filename.includes('\\\\') || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid R2 media object key')
  }

  const encodedKey = segments.map((segment) => encodeURIComponent(segment)).join('/')
  return `${PUBLIC_MEDIA_ORIGIN}/${encodedKey}`
}
