const USERNAME_PATTERN = /^[A-Za-z0-9]{6,32}$/

export const normalizeUsernameRedirectHandle = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const handle = value.trim()
  return USERNAME_PATTERN.test(handle) ? handle : null
}

export const usernameRedirectFromPath = (username: string): string => {
  const handle = normalizeUsernameRedirectHandle(username)
  if (!handle) throw new Error('LUCKREAD_USERNAME_INVALID')
  return '/@' + handle.toLowerCase()
}

export const usernameRedirectTargetPath = (username: string): string => {
  const handle = normalizeUsernameRedirectHandle(username)
  if (!handle) throw new Error('LUCKREAD_USERNAME_INVALID')
  return '/@' + encodeURIComponent(handle)
}

export type UsernameRoutePath = {
  username: string
  suffix: string
}

export const parseUsernameRoutePath = (pathname: string): UsernameRoutePath | null => {
  const firstSegment = pathname.split('/')[1] ?? ''
  if (!firstSegment.startsWith('@')) return null

  let decodedUsername: string
  try {
    decodedUsername = decodeURIComponent(firstSegment.slice(1))
  } catch {
    return null
  }

  const username = normalizeUsernameRedirectHandle(decodedUsername)
  if (!username) return null

  return {
    username,
    suffix: pathname.slice(firstSegment.length + 1),
  }
}

export const buildUsernameRedirectPathname = (
  pathname: string,
  targetUsername: string,
): string | null => {
  const source = parseUsernameRoutePath(pathname)
  const target = normalizeUsernameRedirectHandle(targetUsername)
  if (!source || !target) return null
  if (usernameRedirectFromPath(source.username) === usernameRedirectFromPath(target)) return null
  return usernameRedirectTargetPath(target) + source.suffix
}
