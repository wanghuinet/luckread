/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { assertNotBlocked } from './block-policy.js'

const db = (row: unknown = null) => ({
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(async () => row),
    })),
  })),
}) as unknown as D1Database

describe('block policy', () => {
  it('allows independent users without a block', async () => {
    await expect(assertNotBlocked(db(), 'u1', 'u2')).resolves.toBeUndefined()
  })

  it('rejects either-direction block', async () => {
    await expect(assertNotBlocked(db({ blocked: 1 }), 'u1', 'u2')).rejects.toMatchObject({
      code: 'RELATIONSHIP_BLOCKED',
      status: 409,
    })
  })

  it('does not self-block-check', async () => {
    const prepare = vi.fn()
    await expect(assertNotBlocked({ prepare } as unknown as D1Database, 'u1', 'u1')).resolves.toBeUndefined()
    expect(prepare).not.toHaveBeenCalled()
  })
})
