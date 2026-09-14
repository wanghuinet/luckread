# Cloudflare Payload Baseline v1.0

Status: ADMISSION BASELINE

## Source of truth

Luckread Payload implementation MUST start from the official Payload `with-cloudflare-d1` template, not from the generic Payload starter followed by Cloudflare retrofitting.

Official baseline:
- https://github.com/payloadcms/payload/tree/main/templates/with-cloudflare-d1
- D1 adapter: `@payloadcms/db-d1-sqlite`
- R2 storage: `@payloadcms/storage-r2`
- Cloudflare runtime: Workers + OpenNext + Wrangler

## Required runtime bindings

- D1 binding: `D1`
- R2 binding: `R2`
- Payload secret: `PAYLOAD_SECRET`

## Required baseline capabilities

- Payload Admin authentication via Users collection
- Media collection
- D1 database adapter
- R2 media storage
- Cloudflare-compatible logger
- Wrangler local bindings
- OpenNext Cloudflare build/deploy path
- Payload migrations
- type generation for Payload and Cloudflare bindings

## Implementation rule

Historical Luckread Payload code may be reused only as a donor after compatibility review. It must not replace the official Cloudflare baseline.

## Verification gate

Before domain feature implementation is admitted:

1. package/dependency baseline matches the official Cloudflare template generation being used;
2. `src/payload.config.ts` uses `sqliteD1Adapter` with the Cloudflare D1 binding;
3. R2 storage uses the Cloudflare R2 binding;
4. Wrangler configuration exposes D1 and R2;
5. Payload migrations can be generated/executed;
6. Payload types and Cloudflare environment types can be generated;
7. build/typecheck/test evidence is green;
8. only then may RC-01 Block/Mute implementation proceed.

## Current decision

The old implementation at commit `62ce871003a12ca9195e604af4327a6af2253d12` was already Cloudflare-oriented, but it is not treated as the baseline. It is a donor/reference only because it contains project-specific history and known contract-era issues.
