import { createW03ContentWorker } from './index.js'
import {
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
  getW03SeriesReadStore,
  getW03SeriesCreateStore,
  getW03SeriesUpdateStore,
  getW03SeriesDeleteStore,
  getW03SeriesMemberAttachStore,
  getW03SeriesMemberRemoveStore,
  getW03SeriesMemberReorderStore,
  getW03CollectionMemberAttachStore,
  getW03CollectionMemberRemoveStore,
  getW03CollectionMemberReorderStore,
  getW03MembersReadStore,
  getW03ContentDetailReadStore,
  getW03CreatorContentsReadStore,
} from './neon/runtime.js'

/**
 * Deployment entrypoint: keep the core router importable without pg so other
 * Workers' contract/type checks do not need W03 runtime dependencies installed.
 */
export default createW03ContentWorker({
  contentCreateStoreProvider: (env) =>
    getW03ContentCreateStore(env),
  contentMutationStoreProvider: (env) =>
    getW03ContentMutationStore(env),
  publishedMediaReferenceReadStoreProvider: (env) =>
    getW03PublishedMediaReferenceReadStore(env),
  publishedContentsByIdsReadStoreProvider: (env) =>
    getW03PublishedContentsByIdsReadStore(env),
  followingOwnerContentsReadStoreProvider: (env) =>
    getW03FollowingOwnerContentsReadStore(env),
  postThreadReadStoreProvider: (env) =>
    getW03PostThreadReadStore(env),
  contentRelationshipMutationStoreProvider: (env) =>
    getW03ContentRelationshipMutationStore(env),
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
  collectionMemberRemoveStoreProvider: (env) =>
    getW03CollectionMemberRemoveStore(env),
  collectionMemberReorderStoreProvider: (env) =>
    getW03CollectionMemberReorderStore(env),
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
  seriesMemberReorderStoreProvider: (env) =>
    getW03SeriesMemberReorderStore(env),
  membersReadStoreProvider: (env) =>
    getW03MembersReadStore(env),
  contentDetailReadStoreProvider: (env) =>
    getW03ContentDetailReadStore(env),
  creatorContentsReadStoreProvider: (env) =>
    getW03CreatorContentsReadStore(env),
})
