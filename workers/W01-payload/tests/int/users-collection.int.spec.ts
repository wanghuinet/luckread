import { describe, expect, it } from 'vitest'
import { rejectNativePasswordRecovery } from '../../src/auth/reject-native-password-recovery'
import { Users } from '../../src/collections/Users'

describe('W01 Users collection contract', () => {
  it('declares the approved ENT-USER profile and preference fields', () => {
    const fields = Users.fields as Array<{
      name?: string
      type?: string
      required?: boolean
      unique?: boolean
      index?: boolean
      defaultValue?: string
    }>

    expect(Users.slug).toBe('users')
    expect(Users.auth).toBe(true)

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'username',
          type: 'text',
          required: true,
          unique: true,
          index: true,
        }),
        expect.objectContaining({ name: 'displayName', type: 'text' }),
        expect.objectContaining({ name: 'bio', type: 'textarea' }),
        expect.objectContaining({ name: 'avatar', type: 'text' }),
        expect.objectContaining({ name: 'locale', type: 'text', defaultValue: 'en-US' }),
        expect.objectContaining({ name: 'timezone', type: 'text', defaultValue: 'UTC' }),
      ]),
    )
  })
})


describe('W01 native password recovery containment', () => {
  it('registers the fail-closed recovery hook on the Users collection', () => {
    expect(Users.hooks?.beforeOperation).toEqual([rejectNativePasswordRecovery])
  })

  it('rejects Payload native forgot/reset operations before token processing', () => {
    for (const operation of ['forgotPassword', 'resetPassword']) {
      expect(() => rejectNativePasswordRecovery({ operation })).toThrowError(
        expect.objectContaining({
          status: 404,
          isPublic: true,
          message: 'Not Found',
        }),
      )
    }
  })

  it('leaves unrelated Payload auth operations untouched', () => {
    expect(() => rejectNativePasswordRecovery({ operation: 'login' })).not.toThrow()
  })
})
