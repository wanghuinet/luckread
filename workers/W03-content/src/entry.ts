import { createW03ContentWorker } from './index.js'
import {
  getW03PublishedMediaReferenceReadStore,
  getW03PublishedContentsByIdsReadStore,
  getW03FollowingOwnerContentsReadStore,
  getW03PostThreadReadStore,
  getW03ContentContextReadStore,
  getW03CollectionListReadStore,
  getW03SeriesReadStore,
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
  postThreadReadStoreProvider: (env) =>
    getW03PostThreadReadStore(env),
  contentContextReadStoreProvider: (env) =>
    getW03ContentContextReadStore(env),
  collectionListReadStoreProvider: (env) =>
    getW03CollectionListReadStore(env),
  seriesReadStoreProvider: (env) =>
    getW03SeriesReadStore(env),
})
