interface CloudflareEnv {
  D1: D1Database
  R2: R2Bucket
  ASSETS: Fetcher
  PAYLOAD_SECRET: string
}

declare namespace NodeJS {
  interface ProcessEnv {
    CLOUDFLARE_ENV?: string
    PAYLOAD_SECRET?: string
  }
}
