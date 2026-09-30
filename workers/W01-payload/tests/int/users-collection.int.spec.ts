import { describe, expect, it } from 'vitest'
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
    expect(Users.auth).toEqual(
      expect.objectContaining({
        forgotPassword: expect.any(Object),
        removeTokenFromResponses: true,
      }),
    )

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
