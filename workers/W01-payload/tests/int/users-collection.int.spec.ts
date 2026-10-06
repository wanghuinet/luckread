import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Users } from '../../src/collections/Users'

describe('W01 Users collection contract', () => {
  it('declares the approved ENT-USER profile and preference fields', async () => {
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
        disableLocalStrategy: true,
        removeTokenFromResponses: true,
      }),
    )
    expect(Users.auth).not.toHaveProperty('forgotPassword')
    expect(Users.access?.create).toBeTypeOf('function')
    expect(await Users.access.create({} as never)).toBe(false)

    const config = readFileSync(resolve(process.cwd(), 'src/payload.config.ts'), 'utf8')
    expect(config).toContain("Component: '/auth/PayloadAdminLoginRedirect'")
    expect(config).toContain("Button: '/auth/PayloadAdminLogoutButton'")

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
