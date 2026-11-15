import { Pool, type PoolConfig } from 'pg'

import type { W05SocialWorkerDependencies } from '../index.js'
import { createPostgresFollowListReadStore } from '../follow-list-read-store-postgres.js'
import { createPostgresFollowStore } from '../follow-store-postgres.js'
import { createPostgresReplyAudienceStore } from '../reply-audience-store-postgres.js'
import { createPostgresRelationshipGraphReadStore } from '../relationship-graph-store-postgres.js'
import { createPostgresFollowingAuthorIdsReadStore } from '../following-author-ids-read-store-postgres.js'
import { createPostgresCommentListReadStore } from '../comment-list-read-store-postgres.js'
import { createPostgresBlockMuteListReadStore } from '../block-mute-list-read-store-postgres.js'
import { createPostgresBlockMuteRelationStore } from '../block-mute-relation-store-postgres.js'
import { createPostgresProfileChannelReadStore } from '../profile-channel-read-store-postgres.js'
import { createPostgresProfilePinStore } from '../profile-pin-store-postgres.js'
import { createPostgresRepostStore } from '../repost-store-postgres.js'
import { createPostgresShareStore } from '../share-store-postgres.js'
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
import { createPostgresNotificationPreferencesStore } from '../notification-preferences-store-postgres.js'
import { createPostgresSocialTargetsReadStore } from '../social-targets-read-store-postgres.js'
import { createPostgresSocialClosureReadStore } from '../social-closure-read-store-postgres.js'
import { createPostgresSocialTokenSyncStore } from '../social-token-sync-store-postgres.js'
import { createPostgresPollConfigurationStore } from '../poll-configuration-store-postgres.js'
import { createPostgresPollDeleteStore } from '../poll-delete-store-postgres.js'
import { createPostgresPollReadStore } from '../poll-read-store-postgres.js'
import { createPostgresPollVoteStore } from '../poll-vote-store-postgres.js'
import { createPostgresNotificationPushFanoutStore } from '../notification-push-fanout-store-postgres.js'
import { createPostgresNotificationPushDeliveryClaimStore } from '../notification-push-delivery-claim-store-postgres.js'
import { createPostgresNotificationPushSendResultStore } from '../notification-push-send-result-store-postgres.js'
import { createPostgresNotificationPushReceiptStore } from '../notification-push-receipt-store-postgres.js'
import type { NotificationPushDeliveryRuntimeDependencies } from '../notification-push-delivery-runtime.js'
import { createPostgresNotificationPushEndpointAccessStore } from '../notification-push-endpoint-access-store-postgres.js'
import type { PushEndpointPostgresExecutor } from '../push-endpoint-runtime.js'

export type W05SocialDatabaseDriver = 'd1' | 'neon'

export interface W05SocialRuntimeEnv {
  W05_DATABASE_DRIVER?: string
  HYPERDRIVE_D1_02?: { connectionString?: string }
  W05_PUSH_ENDPOINT_DATABASE_DRIVER?: string
  HYPERDRIVE_D1_03?: { connectionString?: string }
}

type W05PoolFactory = (config: PoolConfig) => Pool

const pools = new WeakMap<object, Pool>()
const compositions = new WeakMap<object, W05SocialWorkerDependencies>()
const pushCompositions = new WeakMap<object, NotificationPushDeliveryRuntimeDependencies>()
const EMPTY_DEPENDENCIES: W05SocialWorkerDependencies = Object.freeze({})
const EMPTY_PUSH_DEPENDENCIES: NotificationPushDeliveryRuntimeDependencies = Object.freeze({})

export function resolveW05PushEndpointDatabaseDriver(
  env: W05SocialRuntimeEnv,
): W05SocialDatabaseDriver {
  const configured = env.W05_PUSH_ENDPOINT_DATABASE_DRIVER?.trim().toLowerCase() || 'd1'
  if (configured === 'd1' || configured === 'neon') return configured
  throw new Error('W05_PUSH_ENDPOINT_DATABASE_DRIVER_UNSUPPORTED')
}

function validateD103HyperdriveConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('W05_HYPERDRIVE_D1_03_CONNECTION_STRING_REQUIRED')
  }
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new Error('W05_HYPERDRIVE_D1_03_CONNECTION_STRING_INVALID')
  }
  let databaseName = ''
  try {
    databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ''))
  } catch {
    throw new Error('W05_HYPERDRIVE_D1_03_CONNECTION_STRING_INVALID')
  }
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !target.hostname ||
    databaseName !== 'luckread_governance'
  ) {
    throw new Error('W05_HYPERDRIVE_D1_03_CONNECTION_STRING_INVALID')
  }
  return value
}

/**
 * W05 is only a delegated writer for W09's endpoint registry in D1-03.
 * This pool is cached separately by its own Hyperdrive binding and never
 * reuses the D1-02 social pool.
 */
export function getW05PushEndpointPostgresDatabase(
  env: W05SocialRuntimeEnv,
  poolFactory: W05PoolFactory = (config) => new Pool(config),
): PushEndpointPostgresExecutor | undefined {
  if (resolveW05PushEndpointDatabaseDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_03
  if (!binding || typeof binding !== 'object') {
    throw new Error('W05_HYPERDRIVE_D1_03_BINDING_REQUIRED')
  }
  const connectionString = validateD103HyperdriveConnectionString(binding.connectionString)
  const pool = getPool(binding, connectionString, poolFactory)
  return asExecutor<PushEndpointPostgresExecutor>(pool)
}

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
 * Compose all W05 social-route PostgreSQL Stores with explicit injection ports,
 * including reply-audience policy and the full comment write/notification path.
 * W09-owned D1-03 push endpoint state remains on its separately scoped binding.
 * D1 remains the default; Neon is opt-in through the existing D1-02 Hyperdrive.
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
    replyAudienceStore: createPostgresReplyAudienceStore(
      asExecutor<Parameters<typeof createPostgresReplyAudienceStore>[0]>(pool),
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
    blockMuteRelationStore: createPostgresBlockMuteRelationStore(
      asExecutor<Parameters<typeof createPostgresBlockMuteRelationStore>[0]>(pool),
    ),
    profileChannelReadStore: createPostgresProfileChannelReadStore(
      asExecutor<Parameters<typeof createPostgresProfileChannelReadStore>[0]>(pool),
    ),
    profilePinStore: createPostgresProfilePinStore(
      asExecutor<Parameters<typeof createPostgresProfilePinStore>[0]>(pool),
    ),
    repostStore: createPostgresRepostStore(
      asExecutor<Parameters<typeof createPostgresRepostStore>[0]>(pool),
    ),
    shareStore: createPostgresShareStore(
      asExecutor<Parameters<typeof createPostgresShareStore>[0]>(pool),
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
    notificationPreferencesStore: createPostgresNotificationPreferencesStore(
      asExecutor<Parameters<typeof createPostgresNotificationPreferencesStore>[0]>(pool),
    ),
    socialTargetsReadStore: createPostgresSocialTargetsReadStore(
      asExecutor<Parameters<typeof createPostgresSocialTargetsReadStore>[0]>(pool),
    ),
    socialClosureReadStore: createPostgresSocialClosureReadStore(
      asExecutor<Parameters<typeof createPostgresSocialClosureReadStore>[0]>(pool),
    ),
    socialTokenSyncStore: createPostgresSocialTokenSyncStore(
      asExecutor<Parameters<typeof createPostgresSocialTokenSyncStore>[0]>(pool),
    ),
    pollConfigurationStore: createPostgresPollConfigurationStore(
      asExecutor<Parameters<typeof createPostgresPollConfigurationStore>[0]>(pool),
    ),
    pollDeleteStore: createPostgresPollDeleteStore(
      asExecutor<Parameters<typeof createPostgresPollDeleteStore>[0]>(pool),
    ),
    pollReadStore: createPostgresPollReadStore(
      asExecutor<Parameters<typeof createPostgresPollReadStore>[0]>(pool),
    ),
    pollVoteStore: createPostgresPollVoteStore(
      asExecutor<Parameters<typeof createPostgresPollVoteStore>[0]>(pool),
    ),
  }

  compositions.set(binding, dependencies)
  return dependencies
}

// Compose only W05-owned push delivery state over D1-02. The endpoint registry
// remains W09-owned in D1-03 and is deliberately supplied by the scoped
// D1_03 binding at execution time; it must never use the D1-02 pool.
export function getW05NotificationPushDeliveryDependencies(
  env: W05SocialRuntimeEnv,
  poolFactory: W05PoolFactory = (config) => new Pool(config),
): NotificationPushDeliveryRuntimeDependencies {
  if (resolveW05SocialDatabaseDriver(env) === 'd1') return EMPTY_PUSH_DEPENDENCIES

  const binding = env.HYPERDRIVE_D1_02
  if (!binding || typeof binding !== 'object') {
    throw new Error('W05_HYPERDRIVE_D1_02_BINDING_REQUIRED')
  }

  const cached = pushCompositions.get(binding)
  if (cached) return cached

  const connectionString = validateHyperdriveConnectionString(binding.connectionString)
  const pool = getPool(binding, connectionString, poolFactory)
  const endpointDatabase = getW05PushEndpointPostgresDatabase(env, poolFactory)
  const dependencies: NotificationPushDeliveryRuntimeDependencies = {
    ...(endpointDatabase
      ? { endpointAccessStore: createPostgresNotificationPushEndpointAccessStore(endpointDatabase) }
      : {}),
    fanoutStore: createPostgresNotificationPushFanoutStore(
      asExecutor<Parameters<typeof createPostgresNotificationPushFanoutStore>[0]>(pool),
    ),
    deliveryClaimStore: createPostgresNotificationPushDeliveryClaimStore(
      asExecutor<Parameters<typeof createPostgresNotificationPushDeliveryClaimStore>[0]>(pool),
    ),
    sendResultStore: createPostgresNotificationPushSendResultStore(
      asExecutor<Parameters<typeof createPostgresNotificationPushSendResultStore>[0]>(pool),
    ),
    receiptStore: createPostgresNotificationPushReceiptStore(
      asExecutor<Parameters<typeof createPostgresNotificationPushReceiptStore>[0]>(pool),
    ),
  }
  pushCompositions.set(binding, dependencies)
  return dependencies
}
