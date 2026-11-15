import { describe, expect, it } from 'vitest'

import {
  getW03PublicMediaReferencePostgresPool,
  getW03PublishedMediaReferenceReadStore,
  getW03PublishedContentsByIdsReadStore,
  getW03FollowingOwnerContentsReadStore,
  getW03PostThreadReadStore,
  getW03ContentContextReadStore,
  getW03CollectionListReadStore,
  getW03SeriesReadStore,
  getW03MembersReadStore,
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

  it('caches the Neon following-feed read store on the shared Hyperdrive pool', async () => {
    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_D1_02: binding,
    }
    const first = getW03FollowingOwnerContentsReadStore(env)
    const second = getW03FollowingOwnerContentsReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await expect(first?.list([], null, 1)).resolves.toEqual([])
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('reuses the same Hyperdrive pool for the separate bookmark-content read store', async () => {
    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_PUBLIC_MEDIA_REFERENCE_DRIVER: 'neon',
      HYPERDRIVE_D1_02: binding,
    }
    const pool = getW03PublicMediaReferencePostgresPool(env)
    const store = getW03PublishedContentsByIdsReadStore(env)

    expect(store).toBeDefined()
    await expect(store?.list([])).resolves.toEqual([])
    await pool.end()
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
  it('requires the existing D1-02 Hyperdrive binding for explicit Neon thread reads', () => {
    expect(() => getW03PostThreadReadStore({ W03_CONTENT_READ_DRIVER: 'neon' }))
      .toThrow('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  })

  it('caches the Neon post-thread reader on the shared D1-02 pool while keeping D1 as default', async () => {
    expect(getW03PostThreadReadStore({ D1_02: { prepare() { throw new Error('D1 should not be queried') } } }))
      .toBeUndefined()

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_D1_02: binding,
    }
    const first = getW03PostThreadReadStore(env)
    const second = getW03PostThreadReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon creator-collection list reader while keeping D1 as default', async () => {
    expect(getW03CollectionListReadStore({
      D1_02: { prepare() { throw new Error('D1 should not be queried') } },
    })).toBeUndefined()

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_D1_02: binding,
    }
    const first = getW03CollectionListReadStore(env)
    const second = getW03CollectionListReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon creator-series reader while keeping D1 as default', async () => {
    expect(getW03SeriesReadStore({
      D1_02: { prepare() { throw new Error('D1 should not be queried') } },
    })).toBeUndefined()

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_D1_02: binding,
    }
    const first = getW03SeriesReadStore(env)
    const second = getW03SeriesReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches Neon membership list readers while keeping D1 as default', async () => {
    expect(getW03MembersReadStore({
      D1_02: { prepare() { throw new Error('D1 should not be queried') } },
    })).toBeUndefined()

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_D1_02: binding,
    }
    const first = getW03MembersReadStore(env)
    const second = getW03MembersReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('reuses the shared D1-02 Hyperdrive pool for W01/W05 content context reads and keeps D1 as default', async () => {
    expect(getW03ContentContextReadStore({
      D1_02: { prepare() { throw new Error('D1 should not be queried') } },
    })).toBeUndefined()

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_D1_02: binding,
    }
    const first = getW03ContentContextReadStore(env)
    const second = getW03ContentContextReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })
})
