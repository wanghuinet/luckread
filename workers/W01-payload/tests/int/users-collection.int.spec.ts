import { describe, expect, it } from 'vitest'
import { Users } from '../../src/collections/Users'

describe('W01 Users collection contract', () => {
  it('uses Better Auth as the sole Payload authentication strategy', () => {
    expect(Users.slug).toBe('users')
    expect(Users.auth).toEqual(
      expect.objectContaining({
        disableLocalStrategy: true,
      }),
    )
    expect(Users.auth).toHaveProperty('strategies')
    expect((Users.auth as any).strategies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'better-auth' }),
      ]),
    )
  })

  it('declares the approved ENT-USER profile and preference fields', () => {
    const fields = Users.fields as Array<{
      name?: string
      type?: string
      required?: boolean
      unique?: boolean
      index?: boolean
      defaultValue?: string
    }>

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
