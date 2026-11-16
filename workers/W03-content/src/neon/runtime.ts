import { Pool } from 'pg'

import {
  createD1PublishedMediaReferenceReadStore,
  type PublishedMediaReferenceReadStore,
} from '../published-media-reference-read-store.js'
import type {
  FollowingOwnerContentsReadStore,
  ContentDetailReadStore,
  CreatorContentsReadStore,
  PublishedContentsByIdsReadStore,
  ContentCreateStore,
  ContentMutationStore,
} from '../content-runtime.js'
import { createPostgresPublishedMediaReferenceReadStore } from '../published-media-reference-read-store-postgres.js'
import { createPostgresPublishedContentsByIdsReadStore } from '../published-contents-by-ids-read-store-postgres.js'
import { createPostgresFollowingOwnerContentsReadStore } from '../following-owner-contents-read-store-postgres.js'
import { createPostgresPostThreadReadStore } from '../post-thread-read-store-postgres.js'
import { createPostgresContentContextReadStore, type ContentContextReadStore } from '../content-context-read-store-postgres.js'
import type { ContentRelationshipMutationStore, PostThreadReadStore } from '../content-relationships.js'
import { createPostgresContentRelationshipMutationStore, type ContentRelationshipPostgresDatabase } from '../content-relationship-mutation-store-postgres.js'
import {
  createPostgresCollectionListReadStore,
} from '../content-collections-read-store-postgres.js'
import type { CollectionListReadStore } from '../content-collections.js'
import { createPostgresCollectionCreateStore, type CollectionCreatePostgresDatabase } from '../content-collections-create-store-postgres.js'
import { createPostgresContentCreateStore, type ContentCreatePostgresDatabase } from '../content-create-store-postgres.js'
import { createPostgresContentMutationStore, type ContentMutationPostgresDatabase } from '../content-mutation-store-postgres.js'
import { createPostgresCollectionUpdateStore, type CollectionUpdatePostgresDatabase } from '../content-collections-update-store-postgres.js'
import { createPostgresCollectionDeleteStore } from '../content-collections-delete-store-postgres.js'
import type { CollectionCreateStore, CollectionUpdateStore, CollectionDeleteStore } from '../content-collections.js'
import {
  createPostgresSeriesReadStore,
} from '../content-series-read-store-postgres.js'
import { createPostgresSeriesCreateStore } from '../content-series-create-store-postgres.js'
import type { SeriesCreatePostgresDatabase } from '../content-series-create-store-postgres.js'
import type { SeriesReadStore, SeriesCreateStore, SeriesUpdateStore, SeriesDeleteStore } from '../content-series.js'
import { createPostgresSeriesUpdateStore } from '../content-series-update-store-postgres.js'
import type { SeriesUpdatePostgresDatabase } from '../content-series-update-store-postgres.js'
import { createPostgresSeriesDeleteStore } from '../content-series-delete-store-postgres.js'
import {
  createPostgresMembersReadStore,
} from '../content-members-read-store-postgres.js'
import { createPostgresContentDetailReadStore } from '../content-detail-read-store-postgres.js'
import { createPostgresCreatorContentsReadStore } from '../creator-contents-read-store-postgres.js'
import type {
  SeriesMembersReadStore,
  SeriesMemberAttachStore,
  SeriesMemberRemoveStore,
} from '../content-series-members.js'
import { createPostgresSeriesMemberAttachStore } from '../content-series-member-attach-store-postgres.js'
import type { SeriesMemberAttachPostgresDatabase } from '../content-series-member-attach-store-postgres.js'
import { createPostgresSeriesMemberRemoveStore } from '../content-series-member-remove-store-postgres.js'
import type { SeriesMemberRemovePostgresDatabase } from '../content-series-member-remove-store-postgres.js'
import type {
  CollectionMemberAttachStore,
  CollectionMemberRemoveStore,
  CollectionMemberReorderStore,
  CollectionMembersReadStore,
} from '../content-collection-members.js'
import { createPostgresCollectionMemberAttachStore } from '../content-collection-member-attach-store-postgres.js'
import type { CollectionMemberAttachPostgresDatabase } from '../content-collection-member-attach-store-postgres.js'
import { createPostgresCollectionMemberRemoveStore } from '../content-collection-member-remove-store-postgres.js'
import type { CollectionMemberRemovePostgresDatabase } from '../content-collection-member-remove-store-postgres.js'
import { createPostgresCollectionMemberReorderStore } from '../content-collection-member-reorder-store-postgres.js'
import type { CollectionMemberReorderPostgresDatabase } from '../content-collection-member-reorder-store-postgres.js'
import type { W03PublishedMediaReferenceRuntimeEnv } from '../published-media-reference-read-store.js'

export type W03PublicMediaReferenceDriver = 'd1' | 'neon'

export type W03PublicMediaReferenceRuntimeEnv = W03PublishedMediaReferenceRuntimeEnv

const pools = new WeakMap<object, Pool>()
const stores = new WeakMap<object, PublishedMediaReferenceReadStore>()
const bookmarkedContentsStores = new WeakMap<object, PublishedContentsByIdsReadStore>()
const followingContentsStores = new WeakMap<object, FollowingOwnerContentsReadStore>()
const postThreadStores = new WeakMap<object, PostThreadReadStore>()
const contentRelationshipMutationStores = new WeakMap<object, ContentRelationshipMutationStore>()
const contentContextStores = new WeakMap<object, ContentContextReadStore>()
const collectionListStores = new WeakMap<object, CollectionListReadStore>()
const collectionCreateStores = new WeakMap<object, CollectionCreateStore>()
const contentCreateStores = new WeakMap<object, ContentCreateStore>()
const contentMutationStores = new WeakMap<object, ContentMutationStore>()
const collectionUpdateStores = new WeakMap<object, CollectionUpdateStore>()
const collectionDeleteStores = new WeakMap<object, CollectionDeleteStore>()
const seriesStores = new WeakMap<object, SeriesReadStore>()
const seriesCreateStores = new WeakMap<object, SeriesCreateStore>()
const seriesUpdateStores = new WeakMap<object, SeriesUpdateStore>()
const seriesDeleteStores = new WeakMap<object, SeriesDeleteStore>()
const seriesMemberAttachStores = new WeakMap<object, SeriesMemberAttachStore>()
const seriesMemberRemoveStores = new WeakMap<object, SeriesMemberRemoveStore>()
const collectionMemberAttachStores = new WeakMap<object, CollectionMemberAttachStore>()
const collectionMemberRemoveStores = new WeakMap<object, CollectionMemberRemoveStore>()
const collectionMemberReorderStores = new WeakMap<object, CollectionMemberReorderStore>()
const membersStores = new WeakMap<object, {
  series: SeriesMembersReadStore
  collections: CollectionMembersReadStore
}>()
const contentDetailStores = new WeakMap<object, ContentDetailReadStore>()
const creatorContentsStores = new WeakMap<object, CreatorContentsReadStore>()

/**
 * The explicit D1-02 content read driver controls only the PostgreSQL read
 * projections wired from the W03 entrypoint: public media references, bookmark
 * batch projection, W04-authorized following-feed content, native post-thread
 * projection, canonical content context and detail reads, creator-owned
 * content lists, series and collection reads, and series/collection membership
 * lists. Content creation, update, delete, owner-authorized state transitions, W06 moderation decisions, owner-authorized revision rollback, scheduled publication candidate reads/commits, and content reference create/revoke and native post-thread append plus Collection creation, update, delete, member attachment, member removal, and member reorder plus Series creation, update, delete, member attachment, and member removal are the only Neon-backed mutations in these slices; all other W03 reads and mutations remain on D1_02. D1 is the safe
 * default and unknown values fail closed.
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


/** PostgreSQL provider for content reference create and revoke mutations. */
export function getW03ContentRelationshipMutationStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): ContentRelationshipMutationStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = contentRelationshipMutationStores.get(binding)
  if (cached) return cached
  const store = createPostgresContentRelationshipMutationStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as ContentRelationshipPostgresDatabase,
  )
  contentRelationshipMutationStores.set(binding, store)
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

/** PostgreSQL writer for the existing creator-owned collection create operation. */
/** PostgreSQL writer for canonical W03 content creation. */
/** PostgreSQL writer for canonical content update, soft-delete, and state-transition mutations. */
export function getW03ContentMutationStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): ContentMutationStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined
  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = contentMutationStores.get(binding)
  if (cached) return cached
  const store = createPostgresContentMutationStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as ContentMutationPostgresDatabase,
  )
  contentMutationStores.set(binding, store)
  return store
}

export function getW03ContentCreateStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): ContentCreateStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined
  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = contentCreateStores.get(binding)
  if (cached) return cached
  const store = createPostgresContentCreateStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as ContentCreatePostgresDatabase,
  )
  contentCreateStores.set(binding, store)
  return store
}

export function getW03CollectionCreateStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): CollectionCreateStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = collectionCreateStores.get(binding)
  if (cached) return cached

  const store = createPostgresCollectionCreateStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as CollectionCreatePostgresDatabase,
  )
  collectionCreateStores.set(binding, store)
  return store
}

/** PostgreSQL writer for the existing creator-owned collection update operation. */
export function getW03CollectionUpdateStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): CollectionUpdateStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = collectionUpdateStores.get(binding)
  if (cached) return cached

  const store = createPostgresCollectionUpdateStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as CollectionUpdatePostgresDatabase,
  )
  collectionUpdateStores.set(binding, store)
  return store
}

/** PostgreSQL writer for the existing creator-owned collection delete operation. */
export function getW03CollectionDeleteStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): CollectionDeleteStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = collectionDeleteStores.get(binding)
  if (cached) return cached

  const store = createPostgresCollectionDeleteStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as CollectionUpdatePostgresDatabase,
  )
  collectionDeleteStores.set(binding, store)
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

/** PostgreSQL writer for the existing creator-owned series create operation. */
export function getW03SeriesCreateStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): SeriesCreateStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = seriesCreateStores.get(binding)
  if (cached) return cached

  const store = createPostgresSeriesCreateStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as SeriesCreatePostgresDatabase,
  )
  seriesCreateStores.set(binding, store)
  return store
}

/** PostgreSQL writer for the existing creator-owned Series update operation. */
export function getW03SeriesUpdateStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): SeriesUpdateStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = seriesUpdateStores.get(binding)
  if (cached) return cached

  const store = createPostgresSeriesUpdateStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as SeriesUpdatePostgresDatabase,
  )
  seriesUpdateStores.set(binding, store)
  return store
}

/** PostgreSQL writer for the existing creator-owned Series soft-delete operation. */
export function getW03SeriesDeleteStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): SeriesDeleteStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = seriesDeleteStores.get(binding)
  if (cached) return cached

  const store = createPostgresSeriesDeleteStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as SeriesUpdatePostgresDatabase,
  )
  seriesDeleteStores.set(binding, store)
  return store
}

/** PostgreSQL writer for attaching a creator-owned Series member. */
export function getW03SeriesMemberAttachStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): SeriesMemberAttachStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = seriesMemberAttachStores.get(binding)
  if (cached) return cached

  const store = createPostgresSeriesMemberAttachStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as SeriesMemberAttachPostgresDatabase,
  )
  seriesMemberAttachStores.set(binding, store)
  return store
}

/** PostgreSQL writer for removing a creator-owned Series member. */
export function getW03SeriesMemberRemoveStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): SeriesMemberRemoveStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = seriesMemberRemoveStores.get(binding)
  if (cached) return cached

  const store = createPostgresSeriesMemberRemoveStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as SeriesMemberRemovePostgresDatabase,
  )
  seriesMemberRemoveStores.set(binding, store)
  return store
}

/** PostgreSQL writer for attaching a creator-owned Collection member. */
export function getW03CollectionMemberAttachStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): CollectionMemberAttachStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = collectionMemberAttachStores.get(binding)
  if (cached) return cached

  const store = createPostgresCollectionMemberAttachStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as CollectionMemberAttachPostgresDatabase,
  )
  collectionMemberAttachStores.set(binding, store)
  return store
}

/** PostgreSQL writer for removing a creator-owned Collection member. */
export function getW03CollectionMemberRemoveStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): CollectionMemberRemoveStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = collectionMemberRemoveStores.get(binding)
  if (cached) return cached

  const store = createPostgresCollectionMemberRemoveStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as CollectionMemberRemovePostgresDatabase,
  )
  collectionMemberRemoveStores.set(binding, store)
  return store
}


/** PostgreSQL writer for reordering a creator-owned Collection member. */
export function getW03CollectionMemberReorderStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): CollectionMemberReorderStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined
  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  const cached = collectionMemberReorderStores.get(binding)
  if (cached) return cached
  const store = createPostgresCollectionMemberReorderStore(
    getW03PublicMediaReferencePostgresPool(env) as unknown as CollectionMemberReorderPostgresDatabase,
  )
  collectionMemberReorderStores.set(binding, store)
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

/** PostgreSQL provider for owner-scoped creator content lists with optional filters. */
export function getW03CreatorContentsReadStore(
  env: W03PublicMediaReferenceRuntimeEnv,
): CreatorContentsReadStore | undefined {
  if (resolveW03PublicMediaReferenceDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W03_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }
  const cached = creatorContentsStores.get(binding)
  if (cached) return cached

  const store = createPostgresCreatorContentsReadStore(
    getW03PublicMediaReferencePostgresPool(env),
  )
  creatorContentsStores.set(binding, store)
  return store
}
