import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

if (process.env.NODE_ENV === 'development') {
  initOpenNextCloudflareForDev()
}

const nextConfig: NextConfig = {
  images: {
    localPatterns: [{ pathname: '/api/media/file/**' }],
  },
  async rewrites() {
    return [
      { source: '/:path*', has: [{ type: 'host', value: 'img.luckread.com' }], destination: '/api/media-delivery/:path*' },
      { source: '/:path*', has: [{ type: 'host', value: 'video.luckread.com' }], destination: '/api/media-delivery/:path*' },
    ]
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
