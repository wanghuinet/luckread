import { describe, expect, it } from 'vitest'

import {
  getW03PublicMediaReferencePostgresPool,
  getW03PublishedMediaReferenceReadStore,
  getW03PublishedContentsByIdsReadStore,
  getW03FollowingOwnerContentsReadStore,
  getW03PostThreadReadStore,
  getW03ContentRelationshipMutationStore,
  getW03ContentContextReadStore,
  getW03CollectionListReadStore,
  getW03CollectionCreateStore,
  getW03ContentCreateStore,
  getW03ContentMutationStore,
  getW03CollectionUpdateStore,
  getW03CollectionDeleteStore,
  getW03SeriesCreateStore,
  getW03SeriesUpdateStore,
  getW03SeriesDeleteStore,
  getW03SeriesMemberAttachStore,
  getW03CollectionMemberAttachStore,
  getW03CollectionMemberRemoveStore,
  getW03CollectionMemberReorderStore,
  getW03SeriesMemberRemoveStore,
  getW03SeriesMemberReorderStore,
  getW03SeriesReadStore,
  getW03MembersReadStore,
  getW03ContentDetailReadStore,
  getW03CreatorContentsReadStore,
  getW03PublicContentListReadStore,
  getW03ContentRevisionReadStore,
  resolveW03PublicMediaReferenceDriver,
} from './runtime.js'

describe('W03 Neon-only content database driver', () => {
  it('requires the Neon driver instead of defaulting to D1', () => {
    expect(() => resolveW03PublicMediaReferenceDriver({})).toThrow('W03_NEON_DRIVER_REQUIRED')
    expect(resolveW03PublicMediaReferenceDriver({ W03_CONTENT_READ_DRIVER: 'neon' })).toBe('neon')
  })

  it('rejects unknown driver values and legacy D1 mode', () => {
    expect(() => resolveW03PublicMediaReferenceDriver({
      W03_PUBLIC_MEDIA_REFERENCE_DRIVER: 'postgres',
    })).toThrow('W03_NEON_DRIVER_REQUIRED')
    expect(() => resolveW03PublicMediaReferenceDriver({
      W03_CONTENT_READ_DRIVER: 'd1',
    })).toThrow('W03_NEON_DRIVER_REQUIRED')
  })

  it('requires the existing D1-02 Hyperdrive binding', () => {
    const env = { W03_PUBLIC_MEDIA_REFERENCE_DRIVER: 'neon' }
    expect(resolveW03PublicMediaReferenceDriver(env)).toBe('neon')
    expect(() => getW03PublishedMediaReferenceReadStore(env))
      .toThrow('W03_HYPERDRIVE_CONTENT_PG_BINDING_REQUIRED')
  })

  it('rejects invalid Hyperdrive connection strings', () => {
    expect(() => getW03PublicMediaReferencePostgresPool({
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: { connectionString: 'https://example.invalid/database' },
    })).toThrow('W03_HYPERDRIVE_CONTENT_PG_CONNECTION_STRING_INVALID')
  })

  it('caches the Neon following-feed read store on the shared Hyperdrive pool', async () => {
    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
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
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const pool = getW03PublicMediaReferencePostgresPool(env)
    const store = getW03PublishedContentsByIdsReadStore(env)

    expect(store).toBeDefined()
    await expect(store?.list([])).resolves.toEqual([])
    await pool.end()
  })

  it('provides and caches the Neon reference relationship writer on Neon-only runtime', async () => {
    expect(() => getW03ContentRelationshipMutationStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03ContentRelationshipMutationStore(env)
    const second = getW03ContentRelationshipMutationStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('reuses one lazy Pool and PostgreSQL read store for the same Hyperdrive binding', async () => {
    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_PUBLIC_MEDIA_REFERENCE_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
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
  it('caches the Neon public content search/list read store on the shared Hyperdrive pool', async () => {
    expect(() => getW03PublicContentListReadStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03PublicContentListReadStore(env)
    const second = getW03PublicContentListReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('requires the existing D1-02 Hyperdrive binding for explicit Neon thread reads', () => {
    expect(() => getW03PostThreadReadStore({ W03_CONTENT_READ_DRIVER: 'neon' }))
      .toThrow('W03_HYPERDRIVE_CONTENT_PG_BINDING_REQUIRED')
  })

  it('caches the Neon post-thread reader on the shared Neon pool with Neon-only runtime', async () => {
    expect(() => getW03PostThreadReadStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03PostThreadReadStore(env)
    const second = getW03PostThreadReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon creator-collection list reader with Neon-only runtime', async () => {
    expect(() => getW03CollectionListReadStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03CollectionListReadStore(env)
    const second = getW03CollectionListReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon collection-create writer with Neon-only runtime', async () => {
    expect(() => getW03CollectionCreateStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03CollectionCreateStore(env)
    const second = getW03CollectionCreateStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon collection-update writer with Neon-only runtime', async () => {
    expect(() => getW03CollectionUpdateStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03CollectionUpdateStore(env)
    const second = getW03CollectionUpdateStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon creator-series reader with Neon-only runtime', async () => {
    expect(() => getW03SeriesReadStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03SeriesReadStore(env)
    const second = getW03SeriesReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches Neon membership list readers with Neon-only runtime', async () => {
    expect(() => getW03MembersReadStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03MembersReadStore(env)
    const second = getW03MembersReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon content-detail reader with Neon-only runtime', async () => {
    expect(() => getW03ContentDetailReadStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03ContentDetailReadStore(env)
    const second = getW03ContentDetailReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon creator-content list reader with Neon-only runtime', async () => {
    expect(() => getW03CreatorContentsReadStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03CreatorContentsReadStore(env)
    const second = getW03CreatorContentsReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('reuses the shared D1-02 Hyperdrive pool for W01/W05 content context reads', async () => {
    expect(() => getW03ContentContextReadStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03ContentContextReadStore(env)
    const second = getW03ContentContextReadStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })
  it('provides and caches the Neon collection-delete writer with Neon-only runtime', async () => {
    expect(() => getW03CollectionDeleteStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03CollectionDeleteStore(env)
    const second = getW03CollectionDeleteStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon series-create writer with Neon-only runtime', async () => {
    expect(() => getW03SeriesCreateStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03SeriesCreateStore(env)
    const second = getW03SeriesCreateStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon series-update writer with Neon-only runtime', async () => {
    expect(() => getW03SeriesUpdateStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03SeriesUpdateStore(env)
    const second = getW03SeriesUpdateStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon series-delete writer with Neon-only runtime', async () => {
    expect(() => getW03SeriesDeleteStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03SeriesDeleteStore(env)
    const second = getW03SeriesDeleteStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

  it('provides and caches the Neon Series member-attach writer with Neon-only runtime', async () => {
    expect(() => getW03SeriesMemberAttachStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
    }
    const env = {
      W03_CONTENT_READ_DRIVER: 'neon',
      HYPERDRIVE_CONTENT_PG: binding,
    }
    const first = getW03SeriesMemberAttachStore(env)
    const second = getW03SeriesMemberAttachStore(env)

    expect(first).toBeDefined()
    expect(first).toBe(second)
    await getW03PublicMediaReferencePostgresPool(env).end()
  })

})

it('provides and caches the Neon Series member removal writer with Neon-only runtime', async () => {
  expect(() => getW03SeriesMemberRemoveStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

  const binding = {
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
  }
  const env = { W03_CONTENT_READ_DRIVER: 'neon', HYPERDRIVE_CONTENT_PG: binding }
  const first = getW03SeriesMemberRemoveStore(env)
  const second = getW03SeriesMemberRemoveStore(env)

  expect(first).toBeDefined()
  expect(first).toBe(second)
  await getW03PublicMediaReferencePostgresPool(env).end()
})


it('provides and caches the Neon Collection member-attach writer with Neon-only runtime', async () => {
  expect(() => getW03CollectionMemberAttachStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

  const binding = {
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
  }
  const env = { W03_CONTENT_READ_DRIVER: 'neon', HYPERDRIVE_CONTENT_PG: binding }
  const first = getW03CollectionMemberAttachStore(env)
  const second = getW03CollectionMemberAttachStore(env)

  expect(first).toBeDefined()
  expect(first).toBe(second)
  await getW03PublicMediaReferencePostgresPool(env).end()
})


it('provides and caches the Neon Collection member-remove writer with Neon-only runtime', async () => {
  expect(() => getW03CollectionMemberRemoveStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')
  const binding = { connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread' }
  const env = { W03_CONTENT_READ_DRIVER: 'neon', HYPERDRIVE_CONTENT_PG: binding }
  const first = getW03CollectionMemberRemoveStore(env)
  const second = getW03CollectionMemberRemoveStore(env)
  expect(first).toBeDefined()
  expect(first).toBe(second)
  await getW03PublicMediaReferencePostgresPool(env).end()
})


it('provides and caches the Neon Collection member-reorder writer with Neon-only runtime', async () => {
  expect(() => getW03CollectionMemberReorderStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')
  const binding = { connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread' }
  const env = { W03_CONTENT_READ_DRIVER: 'neon', HYPERDRIVE_CONTENT_PG: binding }
  const first = getW03CollectionMemberReorderStore(env)
  const second = getW03CollectionMemberReorderStore(env)
  expect(first).toBeDefined()
  expect(first).toBe(second)
  await getW03PublicMediaReferencePostgresPool(env).end()
})


it('provides and caches the Neon content-create writer on the existing D1-02 Hyperdrive pool', async () => {
  expect(() => getW03ContentCreateStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

  const binding = {
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
  }
  const env = {
    W03_CONTENT_READ_DRIVER: 'neon',
    HYPERDRIVE_CONTENT_PG: binding,
  }
  const first = getW03ContentCreateStore(env)
  const second = getW03ContentCreateStore(env)

  expect(first).toBeDefined()
  expect(first).toBe(second)
  await getW03PublicMediaReferencePostgresPool(env).end()
})

it('provides and caches the Neon Series member-reorder writer with Neon-only runtime', async () => {
  expect(() => getW03SeriesMemberReorderStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')
  const binding = { connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread' }
  const env = { W03_CONTENT_READ_DRIVER: 'neon', HYPERDRIVE_CONTENT_PG: binding }
  const first = getW03SeriesMemberReorderStore(env)
  const second = getW03SeriesMemberReorderStore(env)
  expect(first).toBeDefined()
  expect(first).toBe(second)
  await getW03PublicMediaReferencePostgresPool(env).end()
})



it('provides and caches the Neon owner-scoped content revision reader on D1-02 Hyperdrive', async () => {
  expect(() => getW03ContentRevisionReadStore({})).toThrow('W03_NEON_DRIVER_REQUIRED')

  const binding = {
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread',
  }
  const env = { W03_CONTENT_READ_DRIVER: 'neon', HYPERDRIVE_CONTENT_PG: binding }
  const first = getW03ContentRevisionReadStore(env)
  const second = getW03ContentRevisionReadStore(env)

  expect(first).toBeDefined()
  expect(first).toBe(second)
  await getW03PublicMediaReferencePostgresPool(env).end()
})
