import { Pool, type PoolConfig } from 'pg'

import type { W05SocialWorkerDependencies } from '../index.js'
import { createPostgresFollowListReadStore } from '../follow-list-read-store-postgres.js'
import { createPostgresFollowStore } from '../follow-store-postgres.js'
import { createPostgresRelationshipGraphReadStore } from '../relationship-graph-store-postgres.js'
import { createPostgresFollowingAuthorIdsReadStore } from '../following-author-ids-read-store-postgres.js'
import { createPostgresCommentListReadStore } from '../comment-list-read-store-postgres.js'
import { createPostgresBlockMuteListReadStore } from '../block-mute-list-read-store-postgres.js'
import { createPostgresProfileChannelReadStore } from '../profile-channel-read-store-postgres.js'
import { createPostgresContentLikerReadStore } from '../like-list-read-store-postgres.js'
import { createPostgresFavoriteListReadStore } from '../favorite-list-read-store-postgres.js'
import { createPostgresFavoriteMutationStore } from '../favorite-mutation-store-postgres.js'
import { createPostgresFavoriteStatusReadStore } from '../favorite-status-read-store-postgres.js'
import { createPostgresLikeStatusReadStore } from '../like-status-read-store-postgres.js'
import { createPostgresLikeMutationStore } from '../like-mutation-store-postgres.js'
import { createPostgresLikeTargetContextReadStore } from '../like-target-context-read-store-postgres.js'
import { createPostgresCommentCreateStore } from '../comment-create-store-postgres.js'
import { createPostgresCommentMutationStore } from '../comment-mutation-store-postgres.js'
import { createPostgresCommentNotificationContextStore } from '../comment-notification-context-store-postgres.js'
import { createPostgresNotificationEnqueueStore } from '../notification-enqueue-store-postgres.js'
import { createPostgresSocialTargetsReadStore } from '../social-targets-read-store-postgres.js'
import { createPostgresSocialTokenSyncStore } from '../social-token-sync-store-postgres.js'

export type W05SocialDatabaseDriver = 'd1' | 'neon'

export interface W05SocialRuntimeEnv {
  W05_DATABASE_DRIVER?: string
  HYPERDRIVE_D1_02?: { connectionString?: string }
}

type W05PoolFactory = (config: PoolConfig) => Pool

const pools = new WeakMap<object, Pool>()
const compositions = new WeakMap<object, W05SocialWorkerDependencies>()
const EMPTY_DEPENDENCIES: W05SocialWorkerDependencies = Object.freeze({})

export function resolveW05SocialDatabaseDriver(
  env: W05SocialRuntimeEnv,
): W05SocialDatabaseDriver {
  const configured = env.W05_DATABASE_DRIVER?.trim().toLowerCase() || 'd1'
  if (configured === 'd1' || configured === 'neon') return configured
  throw new Error('W05_DATABASE_DRIVER_UNSUPPORTED')
}

function validateHyperdriveConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('W05_HYPERDRIVE_D1_02_CONNECTION_STRING_REQUIRED')
  }
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new Error('W05_HYPERDRIVE_D1_02_CONNECTION_STRING_INVALID')
  }
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !target.hostname ||
    target.pathname.length < 2
  ) {
    throw new Error('W05_HYPERDRIVE_D1_02_CONNECTION_STRING_INVALID')
  }
  return value
}

function getPool(
  binding: object,
  connectionString: string,
  poolFactory: W05PoolFactory,
): Pool {
  const cached = pools.get(binding)
  if (cached) return cached

  const config: PoolConfig = {
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  }
  const pool = poolFactory(config)
  pool.on('error', (error) => {
    console.error(JSON.stringify({
      event: 'w05.social.postgres.pool_error',
      errorType: error instanceof Error ? error.name : 'UNKNOWN',
    }))
  })
  pools.set(binding, pool)
  return pool
}

const asExecutor = <T>(pool: Pool): T => pool as unknown as T

/**
 * Compose the W05 PostgreSQL Stores that have explicit worker injection ports,
 * including the full comment write path and its topic/mention/notification
 * side effects. Other W05 routes not yet adapted and the W09-owned D1-03 push
 * endpoint state remain on their existing D1/service-binding paths. D1 remains
 * the default; Neon is opt-in and requires the existing D1-02 Hyperdrive binding.
 */
export function getW05SocialWorkerDependencies(
  env: W05SocialRuntimeEnv,
  poolFactory: W05PoolFactory = (config) => new Pool(config),
): W05SocialWorkerDependencies {
  if (resolveW05SocialDatabaseDriver(env) === 'd1') return EMPTY_DEPENDENCIES

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W05_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }

  const cached = compositions.get(binding)
  if (cached) return cached

  const connectionString = validateHyperdriveConnectionString(binding.connectionString)
  const pool = getPool(binding, connectionString, poolFactory)

  const dependencies: W05SocialWorkerDependencies = {
    followListReadStore: createPostgresFollowListReadStore(
      asExecutor<Parameters<typeof createPostgresFollowListReadStore>[0]>(pool),
    ),
    followStore: createPostgresFollowStore(
      asExecutor<Parameters<typeof createPostgresFollowStore>[0]>(pool),
    ),
    relationshipGraphReadStore: createPostgresRelationshipGraphReadStore(
      asExecutor<Parameters<typeof createPostgresRelationshipGraphReadStore>[0]>(pool),
    ),
    followingAuthorIdsReadStore: createPostgresFollowingAuthorIdsReadStore(
      asExecutor<Parameters<typeof createPostgresFollowingAuthorIdsReadStore>[0]>(pool),
    ),
    commentListReadStore: createPostgresCommentListReadStore(
      asExecutor<Parameters<typeof createPostgresCommentListReadStore>[0]>(pool),
    ),
    blockMuteListReadStore: createPostgresBlockMuteListReadStore(
      asExecutor<Parameters<typeof createPostgresBlockMuteListReadStore>[0]>(pool),
    ),
    profileChannelReadStore: createPostgresProfileChannelReadStore(
      asExecutor<Parameters<typeof createPostgresProfileChannelReadStore>[0]>(pool),
    ),
    contentLikerReadStore: createPostgresContentLikerReadStore(
      asExecutor<Parameters<typeof createPostgresContentLikerReadStore>[0]>(pool),
    ),
    favoriteListReadStore: createPostgresFavoriteListReadStore(
      asExecutor<Parameters<typeof createPostgresFavoriteListReadStore>[0]>(pool),
    ),
    favoriteMutationStore: createPostgresFavoriteMutationStore(
      asExecutor<Parameters<typeof createPostgresFavoriteMutationStore>[0]>(pool),
    ),
    favoriteStatusReadStore: createPostgresFavoriteStatusReadStore(
      asExecutor<Parameters<typeof createPostgresFavoriteStatusReadStore>[0]>(pool),
    ),
    likeStatusReadStore: createPostgresLikeStatusReadStore(
      asExecutor<Parameters<typeof createPostgresLikeStatusReadStore>[0]>(pool),
    ),
    likeTargetContextReadStore: createPostgresLikeTargetContextReadStore(
      asExecutor<Parameters<typeof createPostgresLikeTargetContextReadStore>[0]>(pool),
    ),
    likeMutationStore: createPostgresLikeMutationStore(
      asExecutor<Parameters<typeof createPostgresLikeMutationStore>[0]>(pool),
    ),
    commentCreateStore: createPostgresCommentCreateStore(
      asExecutor<Parameters<typeof createPostgresCommentCreateStore>[0]>(pool),
    ),
    commentMutationStore: createPostgresCommentMutationStore(
      asExecutor<Parameters<typeof createPostgresCommentMutationStore>[0]>(pool),
    ),
    commentNotificationContextStore: createPostgresCommentNotificationContextStore(
      asExecutor<Parameters<typeof createPostgresCommentNotificationContextStore>[0]>(pool),
    ),
    notificationEnqueueStore: createPostgresNotificationEnqueueStore(
      asExecutor<Parameters<typeof createPostgresNotificationEnqueueStore>[0]>(pool),
    ),
    socialTargetsReadStore: createPostgresSocialTargetsReadStore(
      asExecutor<Parameters<typeof createPostgresSocialTargetsReadStore>[0]>(pool),
    ),
    socialTokenSyncStore: createPostgresSocialTokenSyncStore(
      asExecutor<Parameters<typeof createPostgresSocialTokenSyncStore>[0]>(pool),
    ),
  }

  compositions.set(binding, dependencies)
  return dependencies
}
