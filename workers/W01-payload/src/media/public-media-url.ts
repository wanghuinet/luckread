export const PUBLIC_IMAGE_MEDIA_ORIGIN = 'https://img.luckread.com'
export const PUBLIC_VIDEO_MEDIA_ORIGIN = 'https://video.luckread.com'

// Payload's GenerateFileURL contract provides filename/prefix rather than
// MIME type, so choose the video host from the file extension. Keep common
// source-video and adaptive-streaming playlist/segment formats on video.
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

/**
 * Build a stable public URL for a file already stored under the Payload R2
 * object key. Image and other non-video assets use img.luckread.com; video
 * files and common HLS/DASH playlists or segments use video.luckread.com.
 * Each key segment is encoded independently so nested prefixes remain path
 * separators while spaces and other filename characters are safe.
 */
export function createPublicMediaUrl({ filename, prefix = '' }: PublicMediaUrlInput): string {
  const segments = [...prefix.split('/'), filename].filter(Boolean)
  const hasPathSeparator = filename.includes('/') || filename.includes('\\')
  const hasTraversalSegment = segments.some((segment) => segment === '.' || segment === '..')

  if (!filename.trim() || hasPathSeparator || hasTraversalSegment) {
    throw new Error('Invalid R2 media object key')
  }

  const extension = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
    : ''
  const origin = VIDEO_EXTENSIONS.has(extension)
    ? PUBLIC_VIDEO_MEDIA_ORIGIN
    : PUBLIC_IMAGE_MEDIA_ORIGIN
  const encodedKey = segments.map((segment) => encodeURIComponent(segment)).join('/')
  return origin + '/' + encodedKey
}
