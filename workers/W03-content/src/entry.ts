import { createW03ContentWorker } from './index.js'
import {
  getW03PublishedMediaReferenceReadStore,
  getW03PublishedContentsByIdsReadStore,
  getW03FollowingOwnerContentsReadStore,
} from './neon/runtime.js'

/**
 * Deployment entrypoint: keep the core router importable without pg so other
 * Workers' contract/type checks do not need W03 runtime dependencies installed.
 */
export default createW03ContentWorker({
  publishedMediaReferenceReadStoreProvider: (env) =>
    getW03PublishedMediaReferenceReadStore(env),
  publishedContentsByIdsReadStoreProvider: (env) =>
    getW03PublishedContentsByIdsReadStore(env),
  followingOwnerContentsReadStoreProvider: (env) =>
    getW03FollowingOwnerContentsReadStore(env),
})
