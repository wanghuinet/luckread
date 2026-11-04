/// <reference types="@cloudflare/workers-types" />

export class PushEndpointRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
  }
}

export type PushEndpointRegistrationInput = Readonly<{
  platform: 'ios' | 'android'
  permissionStatus: 'granted' | 'denied' | 'undetermined'
  expoPushToken: string | null
  appVersion?: string | null
}>

type PushEndpointRow = Readonly<{
  endpoint_id: string
  permission_status: string
}>

const MAX_USER_ID = 128
const MAX_APP_VERSION = 64
const MAX_PUSH_TOKEN = 512

const validUserId = (value: string): string => {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_USER_ID || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) {
    throw new PushEndpointRuntimeError('UNAUTHENTICATED', 401)
  }
  return normalized
}

const validInstallationId = (value: string): string => {
  const normalized = value.trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    throw new PushEndpointRuntimeError('VALIDATION_FAILED', 400)
  }
  return normalized
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseRegistration = (value: unknown): PushEndpointRegistrationInput => {
  if (!isRecord(value)) throw new PushEndpointRuntimeError('VALIDATION_FAILED', 400)

  const allowedKeys = new Set(['platform', 'permissionStatus', 'expoPushToken', 'appVersion'])
  if (Object.keys(value).some(key => !allowedKeys.has(key))) {
    throw new PushEndpointRuntimeError('VALIDATION_FAILED', 400)
  }

  if (value.platform !== 'ios' && value.platform !== 'android') {
    throw new PushEndpointRuntimeError('VALIDATION_FAILED', 400)
  }
  if (
    value.permissionStatus !== 'granted' &&
    value.permissionStatus !== 'denied' &&
    value.permissionStatus !== 'undetermined'
  ) {
    throw new PushEndpointRuntimeError('VALIDATION_FAILED', 400)
  }

  const rawToken = value.expoPushToken
  if (rawToken !== null && typeof rawToken !== 'string') {
    throw new PushEndpointRuntimeError('VALIDATION_FAILED', 400)
  }
  const token = typeof rawToken === 'string' ? rawToken.trim() : null
  if (value.permissionStatus === 'granted') {
    if (
      !token ||
      token.length > MAX_PUSH_TOKEN ||
      !/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{16,480}\]$/.test(token)
    ) {
      throw new PushEndpointRuntimeError('VALIDATION_FAILED', 400)
    }
  } else if (token !== null) {
    // Revoked/undetermined permission must never leave an old token eligible
    // for delivery.
    throw new PushEndpointRuntimeError('VALIDATION_FAILED', 400)
  }

  let appVersion: string | null = null
  if (value.appVersion !== undefined && value.appVersion !== null) {
    if (
      typeof value.appVersion !== 'string' ||
      !value.appVersion.trim() ||
      value.appVersion.trim().length > MAX_APP_VERSION ||
      !/^[A-Za-z0-9.+_-]+$/.test(value.appVersion.trim())
    ) {
      throw new PushEndpointRuntimeError('VALIDATION_FAILED', 400)
    }
    appVersion = value.appVersion.trim()
  }

  return {
    platform: value.platform,
    permissionStatus: value.permissionStatus,
    expoPushToken: token,
    appVersion,
  }
}

const isUniquePushTokenConflict = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  return error.message.includes(
    'UNIQUE constraint failed: notification_push_endpoints.provider, notification_push_endpoints.push_token',
  )
}

/**
 * W05 owns notification routing endpoints. This table is deliberately placed
 * in the scoped D1-03 runtime boundary, separate from social inbox state in
 * D1-02. The authenticated principal is always supplied by W01 transport.
 */
export async function upsertPushEndpoint(
  db: D1Database | undefined,
  ownerUserIdValue: string,
  installationIdValue: string,
  rawInput: unknown,
): Promise<Readonly<{ endpointId: string; status: 'ACTIVE' | 'DISABLED' }>> {
  if (!db) throw new PushEndpointRuntimeError('SERVICE_UNAVAILABLE', 503)

  const ownerUserId = validUserId(ownerUserIdValue)
  const installationId = validInstallationId(installationIdValue)
  const input = parseRegistration(rawInput)
  const now = new Date().toISOString()
  const endpointId = crypto.randomUUID()

  try {
    const row = await db.prepare(
      `INSERT INTO notification_push_endpoints
         (endpoint_id, installation_id, owner_user_id, provider, platform, push_token,
          permission_status, app_version, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, 'expo', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(installation_id) DO UPDATE SET
         owner_user_id = excluded.owner_user_id,
         provider = excluded.provider,
         platform = excluded.platform,
         push_token = excluded.push_token,
         permission_status = excluded.permission_status,
         app_version = excluded.app_version,
         updated_at = excluded.updated_at,
         last_seen_at = excluded.last_seen_at
       RETURNING endpoint_id, permission_status`,
    ).bind(
      endpointId,
      installationId,
      ownerUserId,
      input.platform,
      input.expoPushToken,
      input.permissionStatus,
      input.appVersion ?? null,
      now,
      now,
      now,
    ).first<PushEndpointRow>()

    if (!row?.endpoint_id) throw new PushEndpointRuntimeError('SERVICE_UNAVAILABLE', 503)
    return {
      endpointId: row.endpoint_id,
      status: row.permission_status === 'granted' ? 'ACTIVE' : 'DISABLED',
    }
  } catch (error) {
    if (error instanceof PushEndpointRuntimeError) throw error
    if (isUniquePushTokenConflict(error)) throw new PushEndpointRuntimeError('CONFLICT', 409)
    // Never expose database diagnostics or the submitted push token to callers.
    throw new PushEndpointRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

/** Idempotent self-scoped deletion; it does not revoke an auth session/device. */
export async function deletePushEndpoint(
  db: D1Database | undefined,
  ownerUserIdValue: string,
  installationIdValue: string,
): Promise<void> {
  if (!db) throw new PushEndpointRuntimeError('SERVICE_UNAVAILABLE', 503)
  const ownerUserId = validUserId(ownerUserIdValue)
  const installationId = validInstallationId(installationIdValue)

  try {
    await db.prepare(
      'DELETE FROM notification_push_endpoints WHERE owner_user_id = ? AND installation_id = ?',
    ).bind(ownerUserId, installationId).run()
  } catch {
    throw new PushEndpointRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}
