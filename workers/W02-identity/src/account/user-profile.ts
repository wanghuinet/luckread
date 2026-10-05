import { createLuckReadAuth } from '../auth/better-auth.js'

export type UserProfile = {
  id: string
  email: string
  username: string
  displayName: string | null
  bio: string | null
  avatar: string | null
  locale: string | null
  timezone: string | null
  updatedAt: string
}

type UserRow = {
  id: string
  email: string
  name: string
  image: string | null
  username: string | null
  bio: string | null
  locale: string | null
  timezone: string | null
  updatedAt: string
}

const PROFILE_FIELDS = new Set([
  'username',
  'displayName',
  'bio',
  'avatar',
  'locale',
  'timezone',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const readUser = async (db: D1Database, userId: string): Promise<UserRow | null> =>
  db.prepare(
    'SELECT CAST(id AS TEXT) AS id, email, name, image, username, bio, locale, timezone, updated_at AS updatedAt ' +
    'FROM "user" WHERE CAST(id AS TEXT) = ? LIMIT 1',
  ).bind(userId).first<UserRow>()

const mapProfile = (row: UserRow): UserProfile => ({
  id: row.id,
  email: row.email,
  username: row.username ?? '',
  displayName: row.name && row.name !== (row.username ?? '') ? row.name : null,
  bio: row.bio,
  avatar: row.image,
  locale: row.locale,
  timezone: row.timezone,
  updatedAt: row.updatedAt,
})

const etagForProfile = async (profile: UserProfile): Promise<string> => {
  const snapshot = {
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
    avatar: profile.avatar,
    locale: profile.locale,
    timezone: profile.timezone,
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(snapshot)),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return 'W/"' + hex + '"'
}

const normalizeEtag = (value: string): string => {
  let result = value.trim()
  if (result.startsWith('W/')) result = result.slice(2)
  if (result.startsWith('"') && result.endsWith('"')) result = result.slice(1, -1)
  return result
}

const profileResponse = async (profile: UserProfile, status = 200): Promise<Response> => {
  const { updatedAt: _updatedAt, ...publicProfile } = profile
  return Response.json(publicProfile, {
    status,
    headers: {
      'cache-control': 'no-store',
      ETag: await etagForProfile(profile),
    },
  })
}

const authenticate = async (
  db: D1Database,
  request: Request,
  betterAuthSecret: string,
): Promise<string | null> => {
  const auth = createLuckReadAuth({
    D1_01: db,
    BETTER_AUTH_SECRET: betterAuthSecret,
  })
  try {
    const result = await auth.api.getSession({ headers: request.headers, query: {} }) as
      { user?: { id?: unknown } } | null
    return typeof result?.user?.id === 'string' && result.user.id.length > 0
      ? result.user.id
      : null
  } catch {
    return null
  }
}

const validatePatch = (value: unknown): { ok: true; data: Record<string, string | null> } | { ok: false } => {
  if (!isRecord(value)) return { ok: false }
  if (Object.keys(value).some((key) => !PROFILE_FIELDS.has(key))) return { ok: false }
  const data: Record<string, string | null> = {}
  for (const [field, raw] of Object.entries(value)) {
    if (field === 'username') {
      if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 128) return { ok: false }
      data.username = raw.trim()
      continue
    }
    if (raw !== null && typeof raw !== 'string') return { ok: false }
    data[field] = typeof raw === 'string' ? raw : null
  }
  return Object.keys(data).length > 0 ? { ok: true, data } : { ok: false }
}

const updateProfile = async (
  db: D1Database,
  userId: string,
  current: UserRow,
  data: Record<string, string | null>,
): Promise<UserRow | null> => {
  const columns: string[] = []
  const values: Array<string> = []
  if ('username' in data && current.name === (current.username ?? '')) {
    columns.push('name = ?')
    values.push(data.username ?? '')
  }

  for (const [field, value] of Object.entries(data)) {
    switch (field) {
      case 'username':
        columns.push('username = ?')
        values.push(value ?? '')
        break
      case 'displayName':
        columns.push('name = ?')
        values.push(value ?? data.username ?? current.username ?? '')
        break
      case 'bio':
        columns.push('bio = ?')
        values.push(value ?? '')
        break
      case 'avatar':
        columns.push('image = ?')
        values.push(value ?? '')
        break
      case 'locale':
        columns.push('locale = ?')
        values.push(value ?? 'en-US')
        break
      case 'timezone':
        columns.push('timezone = ?')
        values.push(value ?? 'UTC')
        break
    }
  }
  if (columns.length === 0) return null
  values.push(new Date().toISOString(), userId, current.updatedAt)
  try {
    const result = await db.prepare(
      'UPDATE "user" SET ' + columns.join(', ') + ', updated_at = ? ' +
      'WHERE CAST(id AS TEXT) = ? AND updated_at = ?',
    ).bind(...values).run()
    if (result.meta?.changes !== 1) return null
  } catch (error) {
    if (error instanceof Error && /unique constraint|duplicate/i.test(error.message)) {
      throw new Error('PROFILE_USERNAME_CONFLICT')
    }
    throw error
  }
  return readUser(db, userId)
}

export async function getAuthenticatedUserProfile(
  db: D1Database,
  request: Request,
  betterAuthSecret: string,
): Promise<Response> {
  const userId = await authenticate(db, request, betterAuthSecret)
  if (!userId) return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
  const user = await readUser(db, userId)
  if (!user) return errorResponse(404, 'RESOURCE_NOT_FOUND', 'User not found')
  return profileResponse(mapProfile(user))
}

export async function updateAuthenticatedUserProfile(
  db: D1Database,
  request: Request,
  betterAuthSecret: string,
  body: unknown,
): Promise<Response> {
  const userId = await authenticate(db, request, betterAuthSecret)
  if (!userId) return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required')
  const parsed = validatePatch(body)
  if (!parsed.ok) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid profile update')
  const current = await readUser(db, userId)
  if (!current) return errorResponse(404, 'RESOURCE_NOT_FOUND', 'User not found')
  const currentEtag = await etagForProfile(mapProfile(current))
  if (normalizeEtag(ifMatch) !== normalizeEtag(currentEtag)) {
    return errorResponse(412, 'PRECONDITION_FAILED', 'If-Match does not match current profile ETag')
  }
  try {
    const updated = await updateProfile(db, userId, current, parsed.data)
    if (!updated) return errorResponse(412, 'PRECONDITION_FAILED', 'Profile changed before update')
    return profileResponse(mapProfile(updated))
  } catch (error) {
    if (error instanceof Error && error.message === 'PROFILE_USERNAME_CONFLICT') {
      return errorResponse(400, 'VALIDATION_FAILED', 'Profile update could not be completed')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Profile service unavailable')
  }
}

const publicResponse = async (user: UserRow | null): Promise<Response> => {
  if (!user) return errorResponse(404, 'RESOURCE_NOT_FOUND', 'User not found')
  const profile = mapProfile(user)
  return Response.json(
    {
      id: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      avatar: profile.avatar,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export const getPublicUserProfileById = async (db: D1Database, userId: string): Promise<Response> =>
  publicResponse(await readUser(db, userId))

export const getPublicUserProfileByUsername = async (db: D1Database, username: string): Promise<Response> =>
  publicResponse(
    await db.prepare(
      'SELECT CAST(id AS TEXT) AS id, email, name, image, username, bio, locale, timezone, updated_at AS updatedAt ' +
      'FROM "user" WHERE username = ? LIMIT 1',
    ).bind(username).first<UserRow>(),
  )