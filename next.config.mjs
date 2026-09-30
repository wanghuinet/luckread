import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    webpackBuildWorker: true,
  },
}

export default withPayload(nextConfig)
