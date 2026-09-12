import { withPayload } from '@payloadcms/next/withPayload'

const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@payloadcms/db-d1-sqlite', 'jose', '@next/env'],
}

export default withPayload(nextConfig)
