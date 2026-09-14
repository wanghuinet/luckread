import fs from 'fs'
import path from 'path'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import { CloudflareContext, getCloudflareContext } from '@opennextjs/cloudflare'
import { GetPlatformProxyOptions } from 'wrangler'
import { r2Storage } from '@payloadcms/storage-r2'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Content } from './collections/Content'
import { Taxonomies } from './collections/Taxonomies'
import { ContentSeries } from './collections/ContentSeries'
import { ContentMetadata } from './collections/ContentMetadata'
import { ContentEvents } from './collections/ContentEvents'
import { ContentEventEffects } from './collections/ContentEventEffects'
import { AccountStateEvents } from './collections/AccountStateEvents'
import { Entitlements } from './collections/Entitlements'
import { EntitlementGrants } from './collections/EntitlementGrants'
import { SubscriptionPlans } from './collections/SubscriptionPlans'
import { Subscriptions } from './collections/Subscriptions'
import { Organizations } from './collections/Organizations'
import { OrganizationMemberships } from './collections/OrganizationMemberships'
import { IPs } from './collections/IPs'
import { ContentRevisions } from './collections/ContentRevisions'
import { Reports } from './collections/Reports'
import { Appeals } from './collections/Appeals'
import { ContentShares } from './collections/ContentShares'
import { ModerationEvents } from './collections/ModerationEvents'
import { Follows } from './collections/Follows'
import { ContentLikes } from './collections/ContentLikes'
import { Comments } from './collections/Comments'
import { Notifications } from './collections/Notifications'
import { FeedItems } from './collections/FeedItems'
import { SocialBlocks } from './collections/SocialBlocks'
import { SocialMutes } from './collections/SocialMutes'
import { ContentFavorites } from './collections/ContentFavorites'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const realpath = (value: string) => (fs.existsSync(value) ? fs.realpathSync(value) : undefined)
const isCLI = process.argv.some((value) => realpath(value)?.endsWith(path.join('payload', 'bin.js')))
const isProduction = process.env.NODE_ENV === 'production'
const isNextBuild = process.env.NEXT_PHASE === 'phase-production-build'

const cloudflare =
  isCLI || isNextBuild || !isProduction
    ? await getCloudflareContextFromWrangler()
    : await getCloudflareContext({ async: true })

export default buildConfig({
  admin: { user: Users.slug, importMap: { baseDir: path.resolve(dirname) } },
  collections: [Users, Media, Content, Taxonomies, ContentSeries, ContentMetadata, ContentEvents, ContentEventEffects, AccountStateEvents, Entitlements, EntitlementGrants, SubscriptionPlans, Subscriptions, Organizations, OrganizationMemberships, IPs, ContentRevisions, Reports, Appeals, ContentShares, ModerationEvents, Follows, ContentLikes, Comments, Notifications, FeedItems, SocialBlocks, SocialMutes, ContentFavorites],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: sqliteD1Adapter({ binding: cloudflare.env.D1, transactionOptions: {} }),
  logger: isProduction ? { options: { level: process.env.PAYLOAD_LOG_LEVEL || 'info' } } : undefined,
  plugins: [r2Storage({ bucket: cloudflare.env.R2, collections: { media: true } })],
})

function getCloudflareContextFromWrangler(): Promise<CloudflareContext> {
  return import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`).then(
    ({ getPlatformProxy }) => getPlatformProxy({ environment: process.env.CLOUDFLARE_ENV, remoteBindings: isProduction && !isNextBuild } satisfies GetPlatformProxyOptions),
  )
}
