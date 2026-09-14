import { APIError, type PayloadRequest } from 'payload'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export type PaywallMode = 'FREE' | 'SUBSCRIPTION_PREVIEW'

type ArticleBody = unknown

type SplitResult = { preview: ArticleBody; premium: ArticleBody }

function splitText(value: string, percent: number): SplitResult {
  const cut = Math.max(1, Math.min(value.length - 1, Math.floor(value.length * (percent / 100))))
  return { preview: value.slice(0, cut), premium: value.slice(cut) }
}

function splitLexicalBody(body: Record<string, unknown>, percent: number): SplitResult {
  const root = body.root
  if (!root || typeof root !== 'object') throw new APIError('Unsupported article body format', 422)
  const children = (root as { children?: unknown }).children
  if (!Array.isArray(children) || children.length < 2) throw new APIError('Subscription preview requires at least two article blocks', 422)
  const total = children.reduce((sum, child) => sum + JSON.stringify(child).length, 0)
  const target = total * (percent / 100)
  let running = 0
  let cut = 1
  for (let index = 0; index < children.length - 1; index += 1) {
    running += JSON.stringify(children[index]).length
    cut = index + 1
    if (running >= target) break
  }
  return {
    preview: { ...body, root: { ...root, children: children.slice(0, cut) } },
    premium: { ...body, root: { ...root, children: children.slice(cut) } },
  }
}

function splitBody(body: ArticleBody, percent: number): SplitResult {
  if (typeof body === 'string') return splitText(body, percent)
  if (body && typeof body === 'object' && !Array.isArray(body)) return splitLexicalBody(body as Record<string, unknown>, percent)
  throw new APIError('Unsupported article body format', 422)
}

function contentKey(contentId: string, version: number, kind: 'preview' | 'premium'): string {
  return `content/${contentId}/paywall/v${version}/${kind}.json`
}

async function getR2Bucket(): Promise<R2Bucket> {
  const cloudflare = await getCloudflareContext({ async: true })
  const bucket = cloudflare.env.R2 as R2Bucket | undefined
  if (!bucket) throw new APIError('R2 binding is unavailable', 503)
  return bucket
}

async function readR2Json(bucket: R2Bucket, key: string): Promise<unknown> {
  const object = await bucket.get(key)
  if (!object) throw new APIError('Article body object was not found', 404)
  const raw = await object.text()
  try { return JSON.parse(raw) as unknown } catch { return raw }
}

export async function readContentBody(key: string): Promise<unknown> {
  if (!key) throw new APIError('Article body key is unavailable', 404)
  return readR2Json(await getR2Bucket(), key)
}

export async function generateContentPaywall(req: PayloadRequest, content: Record<string, unknown>): Promise<{ previewBodyR2Key: string; premiumBodyR2Key: string }> {
  if (content.paywallMode !== 'SUBSCRIPTION_PREVIEW') throw new APIError('Paywall generation requires SUBSCRIPTION_PREVIEW', 400)
  const sourceKey = String(content.bodyR2Key ?? '')
  const contentId = String(content.id ?? '')
  const percent = Number(content.paywallPreviewPercent)
  const version = Number(content.version)
  if (!sourceKey || !contentId || !Number.isInteger(version) || version < 1) throw new APIError('Paywall source metadata is incomplete', 422)
  if (!Number.isFinite(percent) || percent < 1 || percent > 99) throw new APIError('paywallPreviewPercent must be between 1 and 99', 422)

  const bucket = await getR2Bucket()
  const source = await bucket.get(sourceKey)
  if (!source) throw new APIError('Article body object was not found', 422)
  const raw = await source.text()
  let body: ArticleBody
  try { body = JSON.parse(raw) as ArticleBody } catch { body = raw }

  const split = splitBody(body, percent)
  const previewBodyR2Key = contentKey(contentId, version, 'preview')
  const premiumBodyR2Key = contentKey(contentId, version, 'premium')
  const headers = { httpMetadata: { contentType: 'application/json; charset=utf-8' } }
  await Promise.all([
    bucket.put(previewBodyR2Key, JSON.stringify(split.preview), headers),
    bucket.put(premiumBodyR2Key, JSON.stringify(split.premium), headers),
  ])

  await req.payload.update({
    collection: 'content',
    id: contentId,
    data: { previewBodyR2Key, premiumBodyR2Key },
    context: { allowContentStateTransition: true, skipContentRevision: true, systemJob: true },
    overrideAccess: true,
    req,
  })

  return { previewBodyR2Key, premiumBodyR2Key }
}
