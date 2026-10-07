import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

if (process.env.NODE_ENV === 'development') {
  initOpenNextCloudflareForDev()
}

const nextConfig: NextConfig = {
  images: {
    // W01 currently uses raw media URLs rather than next/image. Keep the
    // Next Image Optimization API disabled so the vulnerable pre-16.3.3
    // AVIF optimizer path cannot be reached while the runtime baseline stays pinned.
    unoptimized: true,
  },
  serverExternalPackages: ['jose', 'pg-cloudflare'],
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }
    return webpackConfig
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
