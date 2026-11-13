import { describe, expect, it } from 'vitest'

import {
  getW03PublicMediaReferencePostgresPool,
  getW03PublishedMediaReferenceReadStore,
  resolveW03PublicMediaReferenceDriver,
} from './runtime.js'

describe('W03 public media reference database driver', () => {
  it('keeps D1 as the default and requires no Hyperdrive binding', async () => {
    const d1 = {
      prepare() {
        throw new Error('empty candidate lookup must not query D1')
      },
    }
    const env = { D1_02: d1 }

    expect(resolveW03PublicMediaReferenceDriver(env)).toBe('d1')
    const store = getW03PublishedMediaReferenceReadStore(env)
    await expect(store.listPublishedMediaReferences([], 51)).resolves.toEqual([])
  })

  it('rejects unknown driver values instead of silently falling back to D1', () => {
    expect(() => resolveW03PublicMediaReferenceDriver({
      W03_PUBLIC_MEDIA_REFERENCE_DRIVER: 'postgres',
    })).toThrow('W03_PUBLIC_MEDIA_REFERENCE_DRIVER_UNSUPPORTED')
  })

  it('requires the D1-02 Hyperdrive binding when Neon is explicitly selected', () => {
    const env = { W03_PUBLIC_MEDIA_REFERENCE_DRIVER: 'neon' }
    expect(resolveW03PublicMediaReferenceDriver(env)).toBe('neon')
    expect(() => getW03PublishedMediaReferenceReadStore(env))
      .toThrow('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  })

  it('rejects invalid Hyperdrive connection strings', () => {
    expect(() => getW03PublicMediaReferencePostgresPool({
      W03_PUBLIC_MEDIA_REFERENCE_DRIVER: 'neon',
      HYPERDRIVE_D1_02: { connectionString: 'https://example.invalid/database' },
    })).toThrow('W03_HYPERDRIVE_D1_02_CONNECTION_STRING_INVALID')
  })

  it('reuses one lazy Pool and PostgreSQL read store for the same Hyperdrive binding', async () => {
    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_PUBLIC_MEDIA_REFERENCE_DRIVER: 'neon',
      HYPERDRIVE_D1_02: binding,
    }

    const firstPool = getW03PublicMediaReferencePostgresPool(env)
    const secondPool = getW03PublicMediaReferencePostgresPool(env)
    const firstStore = getW03PublishedMediaReferenceReadStore(env)
    const secondStore = getW03PublishedMediaReferenceReadStore(env)

    expect(firstPool).toBe(secondPool)
    expect(firstStore).toBe(secondStore)
    await expect(firstStore.listPublishedMediaReferences([], 51)).resolves.toEqual([])
    await firstPool.end()
  })
})
