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
  async headers() {
    const corsHeaders = (origin: string) => [
      { key: 'Access-Control-Allow-Origin', value: origin },
      { key: 'Access-Control-Allow-Credentials', value: 'true' },
      { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
      { key: 'Access-Control-Allow-Headers', value: 'Accept, Authorization, Content-Type, Idempotency-Key, If-Match, If-None-Match, X-LuckRead-Upload-Fingerprint, X-LuckRead-Transport-Version, X-LuckRead-Correlation-Id, X-Requested-With' },
      { key: 'Access-Control-Expose-Headers', value: 'ETag, Retry-After, X-Request-Id, X-LuckRead-Cache, X-LuckRead-Session-Token' },
      { key: 'Access-Control-Max-Age', value: '600' },
      { key: 'Vary', value: 'Origin' },
    ]
    return [
      {
        source: '/v1/:path*',
        has: [{ type: 'host', value: 'api.luckread.com' }, { type: 'header', key: 'origin', value: 'https://luckread.com' }],
        headers: corsHeaders('https://luckread.com'),
      },
      {
        source: '/v1/:path*',
        has: [{ type: 'host', value: 'api.luckread.com' }, { type: 'header', key: 'origin', value: 'https://www.luckread.com' }],
        headers: corsHeaders('https://www.luckread.com'),
      },
      {
        source: '/v1/:path*',
        has: [{ type: 'host', value: 'api.luckread.com' }, { type: 'header', key: 'origin', value: 'https://mp.luckread.com' }],
        headers: corsHeaders('https://mp.luckread.com'),
      },
      {
        source: '/v1/:path*',
        has: [{ type: 'host', value: 'api.luckread.com' }, { type: 'header', key: 'origin', value: 'https://sso.luckread.com' }],
        headers: corsHeaders('https://sso.luckread.com'),
      },
    ]
  },
  async rewrites() {
    return [
      { source: '/v1/:path*', has: [{ type: 'host', value: 'api.luckread.com' }], destination: '/api/v1/:path*' },
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
