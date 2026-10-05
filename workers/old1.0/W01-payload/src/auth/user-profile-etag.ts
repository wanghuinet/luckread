export type UserProfileSnapshot = {
  username: string
  displayName?: string | null
  bio?: string | null
  avatar?: string | null
  locale?: string | null
  timezone?: string | null
}

export const PROFILE_MUTABLE_FIELDS = [
  'username',
  'displayName',
  'bio',
  'avatar',
  'locale',
  'timezone',
] as const

export type ProfileMutableField = typeof PROFILE_MUTABLE_FIELDS[number]

export function pickUserProfileSnapshot(user: Record<string, unknown>): UserProfileSnapshot {
  return {
    username: typeof user.username === 'string' ? user.username : '',
    displayName: typeof user.displayName === 'string' ? user.displayName : null,
    bio: typeof user.bio === 'string' ? user.bio : null,
    avatar: typeof user.avatar === 'string' ? user.avatar : null,
    locale: typeof user.locale === 'string' ? user.locale : null,
    timezone: typeof user.timezone === 'string' ? user.timezone : null,
  }
}

export function normalizeEtag(value: string): string {
  let result = value.trim()
  if (result.startsWith('W/')) result = result.slice(2)
  if (result.startsWith('"') && result.endsWith('"')) result = result.slice(1, -1)
  return result
}

export async function etagForUserProfile(user: Record<string, unknown>): Promise<string> {
  const snapshot = pickUserProfileSnapshot(user)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(snapshot)),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return 'W/"' + hex + '"'
}
