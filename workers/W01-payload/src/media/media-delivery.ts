export type MediaHostKind = 'image' | 'video'
export type MediaByteRange = { offset: number; length: number }

const VIDEO_EXTENSIONS = new Set([
  '3g2', '3gp', 'aac', 'asf', 'avi', 'f4v', 'flv', 'm2ts', 'm2v', 'm4a',
  'm4s', 'm4v', 'm4p', 'mkv', 'mov', 'mp2', 'mp4', 'mp4a', 'mpe', 'mpeg',
  'mpg', 'mpg4', 'mpd', 'm3u8', 'mts', 'ogg', 'ogv', 'qt', 'rm', 'rmvb',
  'ts', 'vtt', 'webm', 'wmv',
])

/** Validate already-decoded Next route segments before using them as an R2 key. */
export function resolveMediaObjectKey(segments: unknown): string | null {
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 32) return null
  const safe: string[] = []
  let totalLength = 0
  for (const value of segments) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > 255 ||
      value === '.' ||
      value === '..' ||
      value.includes('/') ||
      value.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) return null
    totalLength += value.length + 1
    if (totalLength > 1024) return null
    safe.push(value)
  }
  return safe.join('/')
}

export function mediaHostKind(hostname: string): MediaHostKind | null {
  const host = hostname.toLowerCase()
  if (host === 'img.luckread.com') return 'image'
  if (host === 'video.luckread.com') return 'video'
  return null
}

export function isVideoMediaKey(key: string): boolean {
  const filename = key.slice(key.lastIndexOf('/') + 1)
  const dot = filename.lastIndexOf('.')
  return dot >= 0 && VIDEO_EXTENSIONS.has(filename.slice(dot + 1).toLowerCase())
}

/** Reject a public-domain/content-type mismatch instead of serving cross-kind objects. */
export function mediaTypeAllowed(hostKind: MediaHostKind, key: string, contentType: string | null): boolean {
  if (!contentType) return false
  const mime = contentType.split(';', 1)[0]!.trim().toLowerCase()
  if (hostKind === 'image') return mime.startsWith('image/') && !isVideoMediaKey(key)
  if (!isVideoMediaKey(key)) return false
  const ext = key.slice(key.lastIndexOf('/') + 1).split('.').pop()?.toLowerCase() ?? ''
  // Streaming manifests and subtitles have distinct MIME types. Validate them
  // before the broader audio/video allowance so a wrong MIME cannot bypass it.
  if (ext === 'm3u8') return ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl'].includes(mime)
  if (ext === 'mpd') return mime === 'application/dash+xml'
  if (ext === 'vtt') return mime === 'text/vtt'
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return true
  return ['m4s', 'm2ts', 'ts', 'aac', 'm4a', 'mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'mpg', 'mpeg', 'ogv', '3gp', '3g2', 'asf', 'f4v', 'flv', 'wmv', 'rm', 'rmvb', 'mp2', 'mp4a', 'ogg'].includes(ext)
    && ['application/octet-stream', 'application/mp4', 'audio/mp4', 'audio/aac', 'video/mp2t', 'application/ogg'].includes(mime)
}

/** Parse one byte range; unsupported or multiple ranges fail closed. */
export function parseMediaByteRange(header: string | null, size: number): MediaByteRange | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size <= 0) return 'invalid'
  const startText = match[1]!
  const endText = match[2]!
  if (!startText && !endText) return 'invalid'
  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid'
    const length = Math.min(suffix, size)
    return { offset: size - length, length }
  }
  const offset = Number(startText)
  const end = endText ? Number(endText) : size - 1
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end < offset || offset >= size) return 'invalid'
  return { offset, length: Math.min(end, size - 1) - offset + 1 }
}
