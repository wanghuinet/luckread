import { Pool } from 'pg'

import {
  createD1PublishedMediaReferenceReadStore,
  type PublishedMediaReferenceReadStore,
} from '../published-media-reference-read-store.js'
import type {
  FollowingOwnerContentsReadStore,
  ContentDetailReadStore,
  PublishedContentsByIdsReadStore,
} from '../content-runtime.js'
import { createPostgresPublishedMediaReferenceReadStore } from '../published-media-reference-read-store-postgres.js'
import { createPostgresPublishedContentsByIdsReadStore } from '../published-contents-by-ids-read-store-postgres.js'
import { createPostgresFollowingOwnerContentsReadStore } from '../following-owner-contents-read-store-postgres.js'
import { createPostgresPostThreadReadStore } from '../post-thread-read-store-postgres.js'
import { createPostgresContentContextReadStore, type ContentContextReadStore } from '../content-context-read-store-postgres.js'
import type { PostThreadReadStore } from '../content-relationships.js'
import {
  createPostgresCollectionListReadStore,
} from '../content-collections-read-store-postgres.js'
import type { CollectionListReadStore } from '../content-collections.js'
import {
  createPostgresSeriesReadStore,
} from '../content-series-read-store-postgres.js'
import type { SeriesReadStore } from '../content-series.js'
import {
  createPostgresMembersReadStore,
} from '../content-members-read-store-postgres.js'
import type {
  SeriesMembersReadStore,
} from '../content-series-members.js'
import type {
  CollectionMembersReadStore,
} from '../content-collection-members.js'
import type { W03PublishedMediaReferenceRuntimeEnv } from '../published-media-reference-read-store.js'

export type W03PublicMediaReferenceDriver = 'd1' | 'neon'

export type W03PublicMediaReferenceRuntimeEnv = W03PublishedMediaReferenceRuntimeEnv

const pools = new WeakMap<object, Pool>()
const stores = new WeakMap<object, PublishedMediaReferenceReadStore>()
const bookmarkedContentsStores = new WeakMap<object, PublishedContentsByIdsReadStore>()
const followingContentsStores = new WeakMap<object, FollowingOwnerContentsReadStore>()
const postThreadStores = new WeakMap<object, PostThreadReadStore>()
const contentContextStores = new WeakMap<object, ContentContextReadStore>()
const collectionListStores = new WeakMap<object, CollectionListReadStore>()
const seriesStores = new WeakMap<object, SeriesReadStore>()
const membersStores = new WeakMap<object, {
  series: SeriesMembersReadStore
  collections: CollectionMembersReadStore
}>()
const contentDetailStores = new WeakMap<object, ContentDetailReadStore>()

/**
 * The explicit D1-02 content read driver controls only the PostgreSQL read
 * projections wired from the W03 entrypoint: public media references, bookmark
 * batch projection, W04-authorized following-feed content, native post-thread
 * projection, canonical content context, creator-owned series and collection
 * reads, and the series/collection membership lists. Other W03 reads and every
 * W03 mutation remain on D1_02. D1 is the safe default and unknown values fail closed.
 */
export function resolveW03PublicMediaReferenceDriver(
  env: W03PublicMediaReferenceRuntimeEnv,
): W03PublicMediaReferenceDriver {
  const configured = (env.W03_CONTENT_READ_DRIVER ?? env.W03_PUBLIC_MEDIA_REFERENCE_DRIVER)?.trim().toLowerCase() || 'd1'
  if (configured === 'd1' || configured === 'neon') return configured
  throw new Error('W03_PUBLIC_MEDIA_REFERENCE_DRIVER_UNSUPPORTED')
}

function validateHyperdriveConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('W03_HYPERDRIVE_D1_02_CONNECTION_STRING_REQUIRED')
  }
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new Error('W03_HYPERDRIVE_D1_02_CONNECTION_STRING_INVALID')
  }
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !target.hostname ||
    target.pathname.length < 2
  ) {
    throw new Error('W03_HYPERDRIVE_D1_02_CONNECTION_STRING_INVALID')
  }
  return value
}

export function getW03PublicMediaReferencePostgresPool(
  env: W03PublicMediaReferenceRuntimeEnv,
): Pool {
  if (resolveW03PublicMediaReferenceDriver(env) !== 'neon') {
    throw new Error('W03_POSTGRES_POOL_REQUIRES_NEON_DRIVER')
  }
  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = pools.get(binding)
  if (cached) return cached

  const pool = new Pool({
    connectionString: validateHyperdriveConnectionString(binding.connectionString),
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  })
  pool.on('error', (error) => {
    console.error(JSON.stringify({
      event: 'w03.public_media_reference.postgres.pool_error',
      errorType: error instanceof Error ? error.name : 'UNKNOWN',
    }))
  })
  pools.set(binding, pool)
  return pool
}

export function getW03PublishedMediaReferenceReadStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): PublishedMediaReferenceReadStore {
  const driver = resolveW03PublicMediaReferenceDriver(env)
  if (driver === 'd1') {
    if (!env.D1_02) throw new Error('W03_D1_02_BINDING_REQUIRED')
    return createD1PublishedMediaReferenceReadStore(env.D1_02)
  }

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = stores.get(binding)
  if (cached) return cached

  const store = createPostgresPublishedMediaReferenceReadStore(
    getW03PublicMediaReferencePostgresPool(env),
  )
  stores.set(binding, store)
  return store
}

/**
 * PostgreSQL provider for the bookmark projection read only. D1 mode keeps the
 * canonical D1 query in content-runtime.ts; no other W03 route is switched.
 */
export function getW03PublishedContentsByIdsReadStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): PublishedContentsByIdsReadStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = bookmarkedContentsStores.get(binding)
  if (cached) return cached

  const store = createPostgresPublishedContentsByIdsReadStore(
    getW03PublicMediaReferencePostgresPool(env),
  )
  bookmarkedContentsStores.set(binding, store)
  return store
}

/** PostgreSQL provider for the bounded W04-authorized following-feed projection. */
export function getW03FollowingOwnerContentsReadStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): FollowingOwnerContentsReadStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = followingContentsStores.get(binding)
  if (cached) return cached

  const store = createPostgresFollowingOwnerContentsReadStore(
    getW03PublicMediaReferencePostgresPool(env),
  )
  followingContentsStores.set(binding, store)
  return store
}


/** PostgreSQL provider for the native bounded post-thread projection only. */
export function getW03PostThreadReadStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): PostThreadReadStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = postThreadStores.get(binding)
  if (cached) return cached

  const store = createPostgresPostThreadReadStore(
    getW03PublicMediaReferencePostgresPool(env),
  )
  postThreadStores.set(binding, store)
  return store
}


/** PostgreSQL provider for the W01/W05 canonical content-context projections. */
export function getW03ContentContextReadStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): ContentContextReadStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = contentContextStores.get(binding)
  if (cached) return cached

  const store = createPostgresContentContextReadStore(
    getW03PublicMediaReferencePostgresPool(env),
  )
  contentContextStores.set(binding, store)
  return store
}

/** PostgreSQL provider for the bounded creator-owned collection list only. */
export function getW03CollectionListReadStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): CollectionListReadStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = collectionListStores.get(binding)
  if (cached) return cached

  const store = createPostgresCollectionListReadStore(
    getW03PublicMediaReferencePostgresPool(env),
  )
  collectionListStores.set(binding, store)
  return store
}

/** PostgreSQL provider for creator-owned series reads only. */
export function getW03SeriesReadStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): SeriesReadStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = seriesStores.get(binding)
  if (cached) return cached

  const store = createPostgresSeriesReadStore(
    getW03PublicMediaReferencePostgresPool(env),
  )
  seriesStores.set(binding, store)
  return store
}

/** PostgreSQL providers for read-only series and collection membership lists. */
export function getW03MembersReadStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): {
  series: SeriesMembersReadStore
  collections: CollectionMembersReadStore
} | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = membersStores.get(binding)
  if (cached) return cached

  const store = createPostgresMembersReadStore(
    getW03PublicMediaReferencePostgresPool(env),
  )
  membersStores.set(binding, store)
  return store
}

/** PostgreSQL provider for canonical content detail reads; W07 checks stay in W03. */
export function getW03ContentDetailReadStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): ContentDetailReadStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = contentDetailStores.get(binding)
  if (cached) return cached

  const store = createPostgresContentDetailReadStore(
    getW03PublicMediaReferencePostgresPool(env),
  )
  contentDetailStores.set(binding, store)
  return store
}
