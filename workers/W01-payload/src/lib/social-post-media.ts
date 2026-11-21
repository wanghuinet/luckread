export type SocialPostMediaItem = {
  src: string
  kind: 'image' | 'video'
  poster?: string
}

const MAX_SOCIAL_POST_MEDIA = 4

export function isVideoMediaRef(value: string): boolean {
  try {
    const url = new URL(value, 'https://luckread.invalid')
    return /\.(?:mp4|webm|mov|m4v|avi|mkv)$/i.test(url.pathname)
  } catch {
    return /\.(?:mp4|webm|mov|m4v|avi|mkv)(?:[?#]|$)/i.test(value)
  }
}

/**
 * Resolve the media shown on a social post card without fetching more content.
 * Preserve W03's mediaRefs order, de-duplicate references, and fall back to the
 * canonical cover only when the content-list DTO has no usable media refs.
 */
export function resolveSocialPostMedia(
  mediaRefs: readonly string[] | undefined,
  coverRef?: string | null,
): SocialPostMediaItem[] {
  const candidates = Array.from(new Set(
    (mediaRefs ?? []).map((ref) => ref.trim()).filter(Boolean),
  ))
  if (candidates.length === 0 && typeof coverRef === 'string' && coverRef.trim()) {
    candidates.push(coverRef.trim())
  }

  return candidates.slice(0, MAX_SOCIAL_POST_MEDIA).map((src) => {
    const kind = isVideoMediaRef(src) ? 'video' : 'image'
    return {
      src,
      kind,
      ...(kind === 'video' && coverRef ? { poster: coverRef } : {}),
    }
  })
}
