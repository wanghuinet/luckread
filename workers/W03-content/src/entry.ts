import { createW03ContentWorker } from './index.js'
import {
  getW03PublishedMediaReferenceReadStore,
  getW03PublishedContentsByIdsReadStore,
  getW03FollowingOwnerContentsReadStore,
  getW03PostThreadReadStore,
  getW03ContentContextReadStore,
  getW03CollectionListReadStore,
  getW03CollectionCreateStore,
  getW03CollectionUpdateStore,
  getW03CollectionDeleteStore,
  getW03SeriesReadStore,
  getW03SeriesCreateStore,
  getW03SeriesUpdateStore,
  getW03SeriesDeleteStore,
  getW03SeriesMemberAttachStore,
  getW03SeriesMemberRemoveStore,
  getW03CollectionMemberAttachStore,
  getW03MembersReadStore,
  getW03ContentDetailReadStore,
  getW03CreatorContentsReadStore,
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
  collectionCreateStoreProvider: (env) =>
    getW03CollectionCreateStore(env),
  collectionUpdateStoreProvider: (env) =>
    getW03CollectionUpdateStore(env),
  collectionDeleteStoreProvider: (env) =>
    getW03CollectionDeleteStore(env),
  collectionMemberAttachStoreProvider: (env) =>
    getW03CollectionMemberAttachStore(env),
  seriesReadStoreProvider: (env) =>
    getW03SeriesReadStore(env),
  seriesCreateStoreProvider: (env) =>
    getW03SeriesCreateStore(env),
  seriesUpdateStoreProvider: (env) =>
    getW03SeriesUpdateStore(env),
  seriesDeleteStoreProvider: (env) =>
    getW03SeriesDeleteStore(env),
  seriesMemberAttachStoreProvider: (env) =>
    getW03SeriesMemberAttachStore(env),
  seriesMemberRemoveStoreProvider: (env) =>
    getW03SeriesMemberRemoveStore(env),
  membersReadStoreProvider: (env) =>
    getW03MembersReadStore(env),
  contentDetailReadStoreProvider: (env) =>
    getW03ContentDetailReadStore(env),
  creatorContentsReadStoreProvider: (env) =>
    getW03CreatorContentsReadStore(env),
})
