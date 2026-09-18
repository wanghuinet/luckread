import { describe, expect, it } from 'vitest'

import { assertClientWritableFields, SERVER_OWNED_FIELDS } from './field-policy'

describe('server-owned field policy', () => {
  it('covers the frozen protected-field family', () => {
    expect(SERVER_OWNED_FIELDS).toEqual(
      new Set([
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
      ]),
    )
  })

  it('rejects protected-field injection', () => {
    expect(() => assertClientWritableFields({ displayName: 'ok', role: 'admin' })).toThrow(
      'PROTECTED_FIELD_MUTATION_DENIED:role',
    )
  })

  it('allows ordinary profile fields', () => {
    expect(() => assertClientWritableFields({ displayName: 'ok', bio: 'hello' })).not.toThrow()
  })
})
