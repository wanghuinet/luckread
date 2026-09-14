export const SERVER_OWNED_FIELDS = new Set([
  'role',
  'status',
  'verified',
  'owner_id',
  'organization_id',
  'scope_id',
  'entitlements',
  'subscription_state',
  'payment_state',
  'moderation_state',
  'security_state',
])

export const USER_PROFILE_FIELDS = new Set([
  'username',
  'email',
  'displayName',
  'bio',
  'avatar',
  'locale',
  'timezone',
])

export function assertClientWritableFields(data: Record<string, unknown>): void {
  for (const field of Object.keys(data)) {
    if (SERVER_OWNED_FIELDS.has(field)) {
      throw new Error(`PROTECTED_FIELD_MUTATION_DENIED:${field}`)
    }
  }
}
