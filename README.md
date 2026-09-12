# LuckRead

LuckRead is bootstrapped from the official Payload Cloudflare D1 approach.

## Architecture

- Payload CMS on Cloudflare Workers via OpenNext
- Cloudflare D1 as the primary database
- Cloudflare D1 read replicas enabled through Payload's `first-primary` strategy
- Cloudflare R2 for media uploads
- GitHub Actions for build and deployment

## Required Cloudflare setup

1. Create a D1 database named `luckread` and replace `REPLACE_WITH_LUCKREAD_D1_DATABASE_ID` in `wrangler.jsonc` with its ID.
2. Create an R2 bucket named `luckread-media`, or change the bucket name in `wrangler.jsonc`.
3. Enable D1 read replicas for the database in Cloudflare.
4. Set the Worker secret `PAYLOAD_SECRET`.
5. Add GitHub repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Local

```bash
pnpm install
pnpm run generate:types:cloudflare
pnpm dev
```

## Deployment

Pushes to `main` run `.github/workflows/deploy-cloudflare.yml`.

The first production deployment runs Payload migrations against the remote D1 database before deploying the Worker.
