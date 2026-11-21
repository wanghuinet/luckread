export const PUBLIC_IMAGE_MEDIA_ORIGIN = 'https://img.luckread.com'
export const PUBLIC_VIDEO_MEDIA_ORIGIN = 'https://video.luckread.com'

const VIDEO_EXTENSIONS = new Set([
  '3g2', '3gp', 'aac', 'asf', 'avi', 'f4v', 'flv', 'm2ts', 'm2v', 'm4a',
  'm4s', 'm4v', 'm4p', 'mkv', 'mov', 'mp2', 'mp4', 'mp4a', 'mpe', 'mpeg',
  'mpg', 'mpg4', 'mpd', 'm3u8', 'mts', 'ogg', 'ogv', 'qt', 'rm', 'rmvb',
  'ts', 'vtt', 'webm', 'wmv',
])

export interface PublicMediaUrlInput {
  filename: string
  prefix?: string
}

export function createPublicMediaUrl({ filename, prefix = '' }: PublicMediaUrlInput): string {
  const segments = [...prefix.split('/'), filename].filter(Boolean)
  if (
    !filename.trim() ||
    filename.includes('/') ||
    filename.includes('\\') ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Invalid R2 media object key')
  }
  const extension = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
    : ''
  const origin = VIDEO_EXTENSIONS.has(extension)
    ? PUBLIC_VIDEO_MEDIA_ORIGIN
    : PUBLIC_IMAGE_MEDIA_ORIGIN
  return origin + '/' + segments.map((segment) => encodeURIComponent(segment)).join('/')
}
