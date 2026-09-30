/// <reference types="@cloudflare/workers-types" />

import { findPhoneNumbersInText, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max'
import { parse as parseDomain } from 'tldts'
import { analyze as analyzeUnicodeSpoofing } from '@moderation-api/unicode-spoofing'

export type PreflightVerdict = 'PASS' | 'YELLOW' | 'RED'
export type PreflightSeverity = 'INFO' | 'WARN' | 'BLOCK'
export type AiMode = 'none' | 'outline' | 'assist' | 'full'
export type HumanContribution = 'substantial' | 'light' | 'none'

export interface PublishPreflightInput {
  contentType: 'article' | 'post' | 'video'
  title: string
  body: string
  mediaRefs?: string[]
  coverRef?: string | null
  aiMode?: AiMode
  humanContribution?: HumanContribution
}

export interface PreflightFinding {
  id: string
  severity: PreflightSeverity
  category: 'AI' | 'QUALITY' | 'SEO' | 'AD' | 'CONTACT' | 'LINK' | 'MEDIA' | 'SECURITY'
  title: string
  message: string
  fix: string
}

export interface PublishPreflightResult {
  policyVersion: 'luckread.publish-preflight.v1'
  verdict: PreflightVerdict
  score: number
  seoReadiness: 'READY' | 'IMPROVE' | 'BLOCKED'
  summary: string
  findings: PreflightFinding[]
  positiveSignals: string[]
  analyzed: {
    titleChars: number
    bodyChars: number
    paragraphCount: number
    headingCount: number
    externalUrlCount: number
    phoneCount: number
    mobileNumberCount: number
    detectedPhoneRegions: string[]
    messengerIdCount: number
    detectedMessengers: string[]
  }
}

const AI_MODES = new Set<AiMode>(['none', 'outline', 'assist', 'full'])
const HUMAN_LEVELS = new Set<HumanContribution>(['substantial', 'light', 'none'])

const normalize = (value: string): string =>
  value.normalize('NFKC').replace(/[\u200B-\u200F\u2060-\u2064\u2066-\u2069\u202A-\u202E\uFEFF]/g, '').replace(/\r\n?/g, '\n').trim()

const normalizeRiskText = (value: string): string => value.normalize('NFKC').replace(/\r\n?/g, '\n').trim()

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))

const count = (value: string, pattern: RegExp): number => value.match(pattern)?.length ?? 0

const firstMatches = (value: string, pattern: RegExp, max = 6): string[] =>
  Array.from(value.matchAll(pattern)).slice(0, max).map(match => match[0])


type DetectedPhoneNumber = {
  raw: string
  region: string
  mobileSpecific: boolean
  canonical: string
}

type MessengerRule = {
  platform: string
  patterns: RegExp[]
}

const PHONE_CANDIDATE_RE = /(?<![\d+])(?:\+?\d[\d\s().-]{6,}\d)(?!\d)/g
const PHONE_CONTEXT_RE = /(?:phone|telephone|mobile|cell|call|tel|contact|whatsapp|联系电话|电话|手机|手机号|移动电话|联系号码|联系方式)/i
const URL_CANDIDATE_RE = /(?:https?:\/\/|www\.)[^\s<>"')]+/giu
const BARE_DOMAIN_RE = /(?<![@\w])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63})(?:\/[^\s<>"')]+)?/giu

const COUNTRY_HINTS: ReadonlyArray<{ region: CountryCode; aliases: RegExp }> = [
  { region: 'CN', aliases: /(?:中国|中国大陆|大陆|china|prc)/i },
  { region: 'HK', aliases: /(?:香港|hong\s*kong)/i },
  { region: 'MO', aliases: /(?:澳门|macau|macao)/i },
  { region: 'TW', aliases: /(?:台湾|台灣|taiwan)/i },
  { region: 'JP', aliases: /(?:日本|japan)/i },
  { region: 'KR', aliases: /(?:韩国|韓國|south\s*korea|korea)/i },
  { region: 'GB', aliases: /(?:英国|英國|uk|united\s*kingdom|great\s*britain)/i },
  { region: 'FR', aliases: /(?:法国|法國|france)/i },
  { region: 'DE', aliases: /(?:德国|德國|germany)/i },
  { region: 'IT', aliases: /(?:意大利|italy)/i },
  { region: 'ES', aliases: /(?:西班牙|spain)/i },
  { region: 'PT', aliases: /(?:葡萄牙|portugal)/i },
  { region: 'NL', aliases: /(?:荷兰|荷蘭|netherlands|holland)/i },
  { region: 'BE', aliases: /(?:比利时|比利時|belgium)/i },
  { region: 'CH', aliases: /(?:瑞士|switzerland)/i },
  { region: 'IE', aliases: /(?:爱尔兰|愛爾蘭|ireland)/i },
  { region: 'PL', aliases: /(?:波兰|波蘭|poland)/i },
  { region: 'CZ', aliases: /(?:捷克|czechia|czech\s*republic)/i },
  { region: 'HU', aliases: /(?:匈牙利|hungary)/i },
  { region: 'RO', aliases: /(?:罗马尼亚|羅馬尼亞|romania)/i },
  { region: 'GR', aliases: /(?:希腊|希臘|greece)/i },
  { region: 'TR', aliases: /(?:土耳其|türkiye|turkey)/i },
  { region: 'RU', aliases: /(?:俄罗斯|俄羅斯|russia)/i },
  { region: 'UA', aliases: /(?:乌克兰|烏克蘭|ukraine)/i },
  { region: 'IL', aliases: /(?:以色列|israel)/i },
  { region: 'AE', aliases: /(?:阿联酋|阿聯酋|united\s*arab\s*emirates|uae)/i },
  { region: 'SA', aliases: /(?:沙特|saudi\s*arabia)/i },
  { region: 'ZA', aliases: /(?:南非|south\s*africa)/i },
  { region: 'US', aliases: /(?:美国|美國|usa|u\.s\.a?\.?|united\s*states)/i },
  { region: 'CA', aliases: /(?:加拿大|canada)/i },
  { region: 'MX', aliases: /(?:墨西哥|mexico)/i },
  { region: 'BR', aliases: /(?:巴西|brazil)/i },
  { region: 'AU', aliases: /(?:澳大利亚|澳洲|australia)/i },
  { region: 'NZ', aliases: /(?:新西兰|紐西蘭|new\s*zealand)/i },
  { region: 'IN', aliases: /(?:印度|india)/i },
  { region: 'PK', aliases: /(?:巴基斯坦|pakistan)/i },
  { region: 'BD', aliases: /(?:孟加拉国|孟加拉國|bangladesh)/i },
  { region: 'ID', aliases: /(?:印度尼西亚|印度尼西亞|indonesia)/i },
  { region: 'MY', aliases: /(?:马来西亚|馬來西亞|malaysia)/i },
  { region: 'SG', aliases: /(?:新加坡|singapore)/i },
  { region: 'TH', aliases: /(?:泰国|泰國|thailand)/i },
  { region: 'PH', aliases: /(?:菲律宾|菲律賓|philippines)/i },
  { region: 'VN', aliases: /(?:越南|vietnam)/i },
  { region: 'KH', aliases: /(?:柬埔寨|cambodia)/i },
  { region: 'LA', aliases: /(?:老挝|寮國|laos)/i },
  { region: 'MM', aliases: /(?:缅甸|緬甸|myanmar)/i },
  { region: 'BN', aliases: /(?:文莱|汶萊|brunei)/i },
]

const PHONE_REGION_LABELS: Record<string, string> = {
  CN: 'China (+86)', HK: 'Hong Kong (+852)', MO: 'Macao (+853)', TW: 'Taiwan (+886)',
  JP: 'Japan (+81)', KR: 'South Korea (+82)', GB: 'United Kingdom (+44)', FR: 'France (+33)',
  DE: 'Germany (+49)', IT: 'Italy (+39)', ES: 'Spain (+34)', PT: 'Portugal (+351)',
  NL: 'Netherlands (+31)', BE: 'Belgium (+32)', CH: 'Switzerland (+41)', IE: 'Ireland (+353)',
  PL: 'Poland (+48)', CZ: 'Czechia (+420)', HU: 'Hungary (+36)', RO: 'Romania (+40)',
  GR: 'Greece (+30)', TR: 'Türkiye (+90)', RU: 'Russia/Kazakhstan (+7)', KZ: 'Russia/Kazakhstan (+7)',
  UA: 'Ukraine (+380)', IL: 'Israel (+972)', AE: 'United Arab Emirates (+971)',
  SA: 'Saudi Arabia (+966)', ZA: 'South Africa (+27)', US: 'United States/Canada (NANP)',
  CA: 'United States/Canada (NANP)', MX: 'Mexico (+52)', BR: 'Brazil (+55)', AU: 'Australia (+61)',
  NZ: 'New Zealand (+64)', IN: 'India (+91)', PK: 'Pakistan (+92)', BD: 'Bangladesh (+880)',
  ID: 'Indonesia (+62)', MY: 'Malaysia (+60)', SG: 'Singapore (+65)', TH: 'Thailand (+66)',
  PH: 'Philippines (+63)', VN: 'Vietnam (+84)', KH: 'Cambodia (+855)', LA: 'Laos (+856)',
  MM: 'Myanmar (+95)', BN: 'Brunei (+673)',
}

const phoneRegionLabel = (country: string | undefined, countryCallingCode: string): string =>
  (country && PHONE_REGION_LABELS[country]) ?? 'International (+' + countryCallingCode + ')'

const isDateLike = (raw: string): boolean =>
  /^\+?\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(raw.trim())

const addPhoneDetection = (
  dedupe: Map<string, DetectedPhoneNumber>,
  raw: string,
  phone: ReturnType<typeof parsePhoneNumberFromString>,
): void => {
  if (!phone || !phone.isPossible()) return
  const canonical = phone.number
  const key = phoneRegionLabel(phone.country, phone.countryCallingCode) + '|' + canonical
  if (dedupe.has(key)) return
  dedupe.set(key, {
    raw,
    region: phoneRegionLabel(phone.country, phone.countryCallingCode),
    mobileSpecific: phone.getType() === 'MOBILE',
    canonical,
  })
}

const nearbyCountryHint = (value: string, index: number): CountryCode | null => {
  const start = Math.max(0, index - 72)
  const end = Math.min(value.length, index + 72)
  const context = value.slice(start, end)
  return COUNTRY_HINTS.find((hint) => hint.aliases.test(context))?.region ?? null
}

const detectPhoneNumbers = (value: string): {
  matches: DetectedPhoneNumber[]
  mobileCount: number
  phoneCount: number
  regions: string[]
} => {
  const dedupe = new Map<string, DetectedPhoneNumber>()

  for (const match of findPhoneNumbersInText(value)) {
    const raw = value.slice(match.startsAt, match.endsAt)
    if (!raw || isDateLike(raw)) continue
    if (!/^\s*(?:\+|00)/.test(raw)) continue
    addPhoneDetection(dedupe, raw, match.number)
  }

  for (const match of value.matchAll(PHONE_CANDIDATE_RE)) {
    const raw = match[0]
    if (isDateLike(raw)) continue
    const index = match.index ?? 0
    const hasExplicitInternationalPrefix = /^\s*(?:\+|00)/.test(raw)
    if (hasExplicitInternationalPrefix) {
      addPhoneDetection(dedupe, raw, parsePhoneNumberFromString(raw))
      continue
    }
    const context = value.slice(Math.max(0, index - 48), Math.min(value.length, index + raw.length + 48))
    if (!PHONE_CONTEXT_RE.test(context) && !/[().\s-]/.test(raw)) continue
    const hint = nearbyCountryHint(value, index)
    if (!hint) continue
    addPhoneDetection(dedupe, raw, parsePhoneNumberFromString(raw, hint))
  }

  const matches = Array.from(dedupe.values())
  return {
    matches,
    mobileCount: matches.filter((item) => item.mobileSpecific).length,
    phoneCount: matches.length,
    regions: Array.from(new Set(matches.map((item) => item.region))),
  }
}

const trimUrlPunctuation = (value: string): string =>
  value.replace(/[.,!?;:，。！？；：、）》】』」"']+$/u, '')

type ParsedLink = {
  raw: string
  hostname: string
  suspicious: boolean
}

const parseLinkCandidate = (raw: string): ParsedLink | null => {
  const candidate = trimUrlPunctuation(raw)
  const parseTarget = /^(?:https?:\/\/)/i.test(candidate) ? candidate : 'https://' + candidate
  const parsed = parseDomain(parseTarget)
  if (!parsed.hostname || (!parsed.domain && !parsed.isIp)) return null
  return {
    raw: candidate,
    hostname: parsed.hostname,
    suspicious: Boolean(parsed.isIp || parsed.hostname.includes('xn--')),
  }
}

const detectExternalLinks = (value: string): { links: ParsedLink[]; suspicious: string[] } => {
  const candidates = [
    ...firstMatches(value, URL_CANDIDATE_RE, 20),
    ...firstMatches(value, BARE_DOMAIN_RE, 20),
  ]
  const seen = new Set<string>()
  const links: ParsedLink[] = []
  const suspicious: string[] = []

  for (const raw of candidates) {
    const parsed = parseLinkCandidate(raw)
    if (!parsed || seen.has(parsed.raw.toLowerCase())) continue
    seen.add(parsed.raw.toLowerCase())
    links.push(parsed)
    if (parsed.suspicious) suspicious.push(parsed.raw)
  }

  return { links, suspicious }
}

const decodeCommonHtmlEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]{1,6});?/giu, (match, hex: string) => {
      const cp = Number.parseInt(hex, 16)
      return Number.isSafeInteger(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : match
    })
    .replace(/&#([0-9]{1,7});?/gu, (match, decimal: string) => {
      const cp = Number.parseInt(decimal, 10)
      return Number.isSafeInteger(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : match
    })
    .replace(/&(colon|semi|sol|equals|plus);/giu, (_match, name: string) => ({
      colon: ':',
      semi: ';',
      sol: '/',
      equals: '=',
      plus: '+',
    })[name.toLowerCase()] ?? _match)

const MESSENGER_RULES: MessengerRule[] = [
  { platform: 'WhatsApp', patterns: [
    /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send\?phone=)[^\s<>"')]+/gi,
    /\bWhatsApp\s*(?:ID|账号|号码|number)?\s*[:：=]?\s*(?!https?:\/\/|www\.)(\+?\d[\d\s().-]{7,}\d)\b/gi,
  ]},
  { platform: 'Telegram', patterns: [
    /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/[A-Za-z0-9_]{3,64}\b/gi,
    /\bTelegram\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*(?!https?:\/\/|www\.)@?[A-Za-z][A-Za-z0-9_]{3,31}\b/gi,
  ]},
  { platform: 'Facebook Messenger', patterns: [
    /(?:https?:\/\/)?m\.me\/[A-Za-z0-9._-]{2,64}\b/gi,
    /(?:https?:\/\/)?(?:messenger\.com\/t|facebook\.com\/messages\/t)\/[A-Za-z0-9._-]{2,64}\b/gi,
    /\bMessenger\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*(?!https?:\/\/|www\.)@?[A-Za-z0-9._-]{3,64}\b/gi,
  ]},
  { platform: 'WeChat', patterns: [
    /(?:https?:\/\/)?(?:weixin\.qq\.com|wechat\.com)\/[^\s<>"')]+/gi,
    /(?:微信号|WeChat\s*(?:ID|username)?|weixin)\s*[:：=]?\s*(?!https?:\/\/|www\.)[A-Za-z][A-Za-z0-9_-]{5,19}\b/gi,
  ]},
  { platform: 'LINE', patterns: [
    /(?:https?:\/\/)?line\.me\/(?:R\/ti\/p\/|ti\/p\/~?)[^\s<>"')]+/gi,
    /\bLINE\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*(?!https?:\/\/|www\.)@?[A-Za-z0-9._-]{3,32}\b/gi,
  ]},
  { platform: 'QQ', patterns: [
    /(?:QQ(?:号|账号|ID)?|扣扣)\s*[:：=]?\s*\d{5,12}\b/gi,
    /(?:https?:\/\/)?qq\.com\/[^\s<>"')]+/gi,
  ]},
  { platform: 'Signal', patterns: [
    /(?:https?:\/\/)?signal\.me\/[^\s<>"')]+/gi,
    /\bSignal\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*(?!https?:\/\/|www\.)@?[A-Za-z0-9._-]{3,64}\b/gi,
  ]},
  { platform: 'Viber', patterns: [
    /(?:https?:\/\/)?(?:vb\.me|viber\.com)\/[^\s<>"')]+/gi,
    /\bViber\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*(?!https?:\/\/|www\.)@?[A-Za-z0-9._-]{3,64}\b/gi,
  ]},
  { platform: 'KakaoTalk', patterns: [
    /(?:https?:\/\/)?open\.kakao\.com\/[^\s<>"')]+/gi,
    /\bKakao(?:Talk)?\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*(?!https?:\/\/|www\.)@?[A-Za-z0-9._-]{3,64}\b/gi,
  ]},
  { platform: 'Discord', patterns: [
    /(?:https?:\/\/)?(?:discord\.gg|discord\.com\/users|discordapp\.com\/users)\/[^\s<>"')]+/gi,
    /\bDiscord\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*(?!https?:\/\/|www\.)@?[A-Za-z0-9._-]{3,64}(?:#\d{4})?\b/gi,
  ]},
  { platform: 'Skype', patterns: [
    /(?:https?:\/\/)?join\.skype\.com\/[^\s<>"')]+/gi,
    /\bSkype\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*(?!https?:\/\/|www\.)[A-Za-z0-9._-]{3,64}\b/gi,
  ]},
  { platform: 'Zalo', patterns: [
    /(?:https?:\/\/)?zalo\.me\/[^\s<>"')]+/gi,
  ]},
  { platform: 'WeCom', patterns: [
    /(?:https?:\/\/)?work\.weixin\.qq\.com\/[^\s<>"')]+/gi,
  ]},
  { platform: 'DingTalk', patterns: [
    /(?:https?:\/\/)?(?:qr\.dingtalk\.com|c\.dingtalk\.com)\/[^\s<>"')]+/gi,
  ]},
  { platform: 'Snapchat', patterns: [
    /(?:https?:\/\/)?snapchat\.com\/add\/[A-Za-z0-9._-]{2,64}\b/gi,
  ]},
]

const detectMessengerIds = (value: string): { platform: string; match: string }[] => {
  const hits: { platform: string; match: string }[] = []
  const seen = new Set<string>()
  for (const rule of MESSENGER_RULES) {
    for (const pattern of rule.patterns) {
      for (const match of firstMatches(value, pattern, 6)) {
        const key = rule.platform + '|' + match.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        hits.push({ platform: rule.platform, match })
      }
    }
  }
  return hits
}

const titleSignals = (title: string): string[] =>
  Array.from(new Set(
    title
      .split(/[\s，。！？、：:；;,.!?()[\]{}《》“”"'‘’|/\\-]+/)
      .map(value => value.trim())
      .filter(value => value.length >= 2),
  )).slice(0, 8)

const sentenceList = (body: string): string[] =>
  body
    .split(/[。！？!?；;\n]+/)
    .map(value => value.replace(/^[\s#>*•·-]+/, '').trim())
    .filter(value => value.length >= 10)

const uniqueRepeatedSentences = (body: string): string[] => {
  const seen = new Map<string, number>()
  for (const sentence of sentenceList(body)) {
    const key = sentence.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()
    if (key.length >= 16) seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return Array.from(seen.entries()).filter(([, repeats]) => repeats >= 2).map(([sentence]) => sentence).slice(0, 4)
}

const repeatedTitlePhrases = (title: string, body: string): string[] => {
  const normalizedBody = body.toLowerCase()
  const repeated: string[] = []
  for (const signal of titleSignals(title)) {
    const hits = normalizedBody.split(signal.toLowerCase()).length - 1
    if (hits >= 8 && signal.length >= 3) repeated.push(signal)
  }
  return repeated.slice(0, 4)
}

const addFinding = (
  findings: PreflightFinding[],
  id: string,
  severity: PreflightSeverity,
  category: PreflightFinding['category'],
  title: string,
  message: string,
  fix: string,
): void => {
  findings.push({ id, severity, category, title, message, fix })
}

const normalizedMode = (value: unknown): AiMode => AI_MODES.has(value as AiMode) ? value as AiMode : 'assist'
const normalizedHumanContribution = (value: unknown): HumanContribution =>
  HUMAN_LEVELS.has(value as HumanContribution) ? value as HumanContribution : 'light'

export const normalizePreflightInput = (value: unknown): PublishPreflightInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PREFLIGHT_INPUT')
  const candidate = value as Record<string, unknown>
  const contentType = candidate.contentType
  const title = typeof candidate.title === 'string' ? normalize(candidate.title) : ''
  const body = typeof candidate.body === 'string' ? normalize(candidate.body) : ''
  const mediaRefs = Array.isArray(candidate.mediaRefs)
    ? candidate.mediaRefs.filter((item): item is string => typeof item === 'string').map(normalize)
    : []
  const coverRef = candidate.coverRef === null || candidate.coverRef === undefined
    ? null
    : typeof candidate.coverRef === 'string' ? normalize(candidate.coverRef) : null

  if (!['article', 'post', 'video'].includes(String(contentType))) throw new Error('INVALID_PREFLIGHT_INPUT')
  if (title.length === 0 || title.length > 512 || body.length === 0 || body.length > 160000) {
    throw new Error('INVALID_PREFLIGHT_INPUT')
  }
  if (mediaRefs.length > 20) throw new Error('INVALID_PREFLIGHT_INPUT')

  return {
    contentType: contentType as PublishPreflightInput['contentType'],
    title,
    body,
    mediaRefs,
    coverRef,
    aiMode: normalizedMode(candidate.aiMode),
    humanContribution: normalizedHumanContribution(candidate.humanContribution),
  }
}

export const preflightContent = (rawInput: unknown): PublishPreflightResult => {
  const input = normalizePreflightInput(rawInput)
  const findings: PreflightFinding[] = []
  const positiveSignals: string[] = []
  const title = input.title
  const body = input.body
  const titleLower = title.toLowerCase()
  const aiMode = normalizedMode(input.aiMode)
  const humanContribution = normalizedHumanContribution(input.humanContribution)
  const bodyLower = body.toLowerCase()
  const unicodeAnalysis = analyzeUnicodeSpoofing(body)
  const normalizedRiskBody = normalizeRiskText(decodeCommonHtmlEntities(unicodeAnalysis.normalized))
  const externalLinkDetection = detectExternalLinks(body)
  const externalUrls = externalLinkDetection.links
  const phoneDetections = detectPhoneNumbers(body)
  const phones = phoneDetections.matches
  const messengerIds = detectMessengerIds(normalizedRiskBody)
  const paragraphs = body.split(/\n\s*\n+/).map(value => value.trim()).filter(Boolean)
  const headingCount = count(body, /^(?:#{1,6}\s+|(?:第[一二三四五六七八九十百]+[章节条]\s*)|(?:[一二三四五六七八九十百]+[、.．]\s*).{2,60})$/gim)
  const repeatedSentences = uniqueRepeatedSentences(body)
  const repeatedPhrases = repeatedTitlePhrases(title, body)
  const boilerplateHits = firstMatches(
    body,
    /(?:在当今(?:社会|时代|世界)|随着.{0,18}(?:不断|快速|迅速)发展|总的来说|综上所述|毋庸置疑|不可否认|值得注意的是|在这个快速发展的时代)/gi,
    8,
  )
  const firstHandSignals = firstMatches(
    body,
    /(?:我实测|亲测|实测|我们测试|现场|采访|走访|实验|样本|测量|数据|截图|体验|案例|时间|地点|价格|版本|配置|日志|结果|来源|引用|参考|我认为|我的结论|我的建议|优点|缺点|适合|不适合)/gi,
    12,
  )
  const salesSignals = firstMatches(
    normalizedRiskBody,
    /(?:优惠|折扣|促销|下单|购买|付款|代理|加盟|招商|返利|赚钱|课程|咨询|推广|引流|私域|加V|加vx|加微信|扫码|私聊|联系我|添加好友|进群|领取优惠)/gi,
    15,
  )
  const contactSignals = firstMatches(
    normalizedRiskBody,
    /(?:微信|weixin|wx|威信|V信|vx|LINE|WhatsApp|Telegram|QQ|公众号|群聊|加群|邮箱|email|Skype|Zalo|WeCom|企业微信|钉钉|DingTalk|Snapchat)/gi,
    15,
  )
  const qrSignals = firstMatches(normalizedRiskBody, /(?:二维码|扫码|扫一扫|识别下方二维码)/gi, 8)
  const unicodeRiskSignals = unicodeAnalysis.spoofed || unicodeAnalysis.signals.invisible || unicodeAnalysis.signals.illegal || unicodeAnalysis.signals.confusable_word || unicodeAnalysis.signals.encoding_damage
  const concreteContactChannelCount = [
    phones.length > 0,
    messengerIds.length > 0,
    externalUrls.length > 0,
    qrSignals.length > 0,
  ].filter(Boolean).length
  const publicOrReferenceContext = /(?:官网|官方|客服|热线|售后|政府|学校|医院|银行|机构|使领馆|警方|来源|参考|报道|公告|documentation|official|support|source|reference)/i.test(normalizedRiskBody)
  const promotionalCombination =
    (salesSignals.length > 0 && concreteContactChannelCount > 0) ||
    (concreteContactChannelCount >= 2 && !publicOrReferenceContext)
  const rawContactSignalSet = new Set(firstMatches(body, /(?:微信|weixin|whatsapp|telegram|line|qq|discord|signal|viber|kakao|skype|zalo)/gi, 15).map(value => value.toLowerCase()))
  const obfuscatedRiskSignals = firstMatches(normalizedRiskBody, /(?:微信|weixin|whatsapp|telegram|line|qq|discord|signal|viber|kakao|skype|zalo|加微信|联系我|私聊|扫码|下单|购买)/gi, 20)
    .filter(value => !rawContactSignalSet.has(value.toLowerCase()) && !bodyLower.includes(value.toLowerCase()))
  if (unicodeRiskSignals) {
    const bypassedRisk = unicodeAnalysis.signals.invisible || unicodeAnalysis.signals.confusable_word || unicodeAnalysis.signals.mixed_script
    const unicodeSeverity = bypassedRisk && (promotionalCombination || obfuscatedRiskSignals.length > 0) ? 'BLOCK' : 'WARN'
    addFinding(
      findings,
      'SEC-UNICODE-OBFUSCATION',
      unicodeSeverity,
      'SECURITY',
      '发现 Unicode 变形/隐藏字符风险',
      unicodeAnalysis.signals.encoding_damage
        ? '正文出现编码损坏信号；该信号本身不代表恶意内容。'
        : obfuscatedRiskSignals.length > 0
          ? '检测到经过 Unicode 变形、隐藏字符或相似字符处理后才显现的联系方式/导流信号。'
          : '正文包含 Unicode 欺骗、混合脚本或不可见字符信号；当前只做安全审查，不把合法多语言文本本身判为违规。',
      '删除不必要的不可见/变形字符，保持联系方式、网址和重要文字使用正常字符；合法多语言内容无需为了通过检查而改写。',
    )
  }
  const htmlSignals = firstMatches(body, /<\/?(?:script|style|iframe|object|embed|img|a\b)[^>]*>/gi, 8)
  const hiddenTextSignals = firstMatches(body, /(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|opacity\s*:\s*0)/gi, 8)
  const mediaRiskRefs = (input.mediaRefs ?? []).filter(value => /(?:qrcode|qr-code|weixin|wechat|vx|contact|promo|ad\b)/i.test(value)).slice(0, 6)

  if (htmlSignals.length || hiddenTextSignals.length) {
    addFinding(findings, 'SEC-HTML-HIDDEN', 'BLOCK', 'SECURITY', '发现隐藏代码或隐藏文字风险', '正文包含可能影响渲染、导流或搜索引擎识别的 HTML/隐藏样式片段。', '删除 HTML/CSS 注入内容，仅保留真实可读正文。')
  }

  if (title.length < 8) {
    addFinding(findings, 'SEO-TITLE-SHORT', 'WARN', 'SEO', '标题信息量偏低', '标题过短，可能无法清楚表达主题。', '把核心主题、对象或结果写进标题，保持自然描述。')
  }
  if (title.length > 70) {
    addFinding(findings, 'SEO-TITLE-LONG', 'WARN', 'SEO', '标题偏长', '标题较长，搜索结果中的标题链接可能被截断。', '保留真正重要的信息，删除重复修饰词。')
  }
  if (!/[\p{L}\p{N}]/u.test(title) || /(.)\1{7,}/u.test(title)) {
    addFinding(findings, 'SEO-TITLE-NOISE', 'BLOCK', 'SEO', '标题含明显乱码/重复字符', '标题缺少可识别的文字或数字，或存在异常重复字符，影响可读性与可信度。', '重写为自然、明确、可理解的标题。')
  }

  const exactTitleHits = title.length >= 10
    ? count(bodyLower, new RegExp(titleLower.replace(/[.*+?^{}()|[\]\\]/g, '\\$&'), 'g'))
    : 0
  if (exactTitleHits >= 3) {
    addFinding(findings, 'SEO-TITLE-REPEAT', 'WARN', 'SEO', '标题在正文中重复过多', '正文多次机械重复完整标题，可能形成不自然的关键词堆砌。', '只在需要的位置自然提及主题，不要重复整句标题。')
  }
  if (repeatedPhrases.length) {
    addFinding(findings, 'SEO-KEYWORD-STUFFING', repeatedPhrases.length >= 2 ? 'BLOCK' : 'WARN', 'SEO', '疑似关键词堆砌', '检测到标题短语在正文中异常高频重复。', '减少重复关键词，改用自然表达并补充真正有用的信息。')
  }

  if (externalUrls.length) {
    const hasPromotion = promotionalCombination
    addFinding(
      findings,
      'LINK-EXTERNAL',
      hasPromotion ? 'BLOCK' : 'WARN',
      'LINK',
      hasPromotion ? '外链与导流信号组合出现' : '发现正文外部网址',
      hasPromotion ? '外部网址同时伴随联系方式、扫码或营销话术，存在明显导流风险。' : '正文包含第三方网址；请确认链接对读者有直接帮助。',
      hasPromotion ? '删除导流网址、联系方式或营销话术；保留与事实来源直接相关的必要引用。' : '仅保留有直接帮助的来源链接，并说明来源用途。',
    )
  }

  if (externalLinkDetection.suspicious.length) {
    addFinding(
      findings,
      'LINK-DOMAIN-RISK',
      promotionalCombination ? 'BLOCK' : 'WARN',
      'LINK',
      '发现高风险网址形态',
      '网址使用 IP 主机名或 IDN/Punycode 形式；这不是恶意网址的证明，但需要额外确认真实来源。',
      promotionalCombination ? '删除与营销导流组合出现的可疑网址。' : '确认网址属于可信来源；涉及 IDN 域名时优先使用官方原始链接。',
    )
  }

  if (phones.length) {
    const hasPromotion = promotionalCombination
    const mobileRegions = phoneDetections.regions.filter(region => !region.includes('NANP') && !region.includes('Mexico'))
    const regionHint = mobileRegions.length ? '（覆盖：' + mobileRegions.slice(0, 4).join('、') + (mobileRegions.length > 4 ? '等' : '') + '）' : ''
    addFinding(
      findings,
      'CONTACT-PHONE',
      hasPromotion ? 'BLOCK' : 'WARN',
      'CONTACT',
      phoneDetections.mobileCount > 0 ? '发现手机号/移动号码' : '发现电话号候选',
      hasPromotion ? '检测到电话/手机号，并与社交账号、网址或推广导流信号组合出现。' : '正文存在电话或手机号候选' + regionHint + '；请确认它是报道事实所必需，而不是引导联系。',
      '删除个人联系方式和导流号码；确有必要时仅保留公开机构联系方式，并注明来源。',
    )
  }

  if (messengerIds.length) {
    const hasIntent = promotionalCombination
    addFinding(
      findings,
      'CONTACT-MESSENGER-ID',
      hasIntent ? 'BLOCK' : 'WARN',
      'CONTACT',
      '发现即时通讯账号/邀请链接',
      hasIntent ? '检测到主流即时通讯账号、邀请链接或联系方式，并伴随导流/营销信号。' : '检测到主流即时通讯账号或邀请链接；请确认这是报道事实所必需，而不是引导私聊、加群或站外成交。',
      '删除私聊、加群、邀请链接和营销账号；确有必要时只保留公开机构联系信息并说明来源。',
    )
  } else if (contactSignals.length) {
    const hasIntent = promotionalCombination
    addFinding(findings, 'CONTACT-PLATFORM-ID', hasIntent ? 'BLOCK' : 'WARN', 'CONTACT', '发现社交账号/联系方式信号', hasIntent ? '社交账号或联系方式与导流/营销信号组合出现。' : '正文存在微信、LINE、QQ、Telegram 等联系方式相关词汇。', '仅保留报道对象所必需的公开联系方式，不要引导用户私聊或加群。')
  }

  if (qrSignals.length || mediaRiskRefs.length) {
    addFinding(
      findings,
      'MEDIA-QR',
      promotionalCombination ? 'BLOCK' : 'WARN',
      'MEDIA',
      '发现二维码/疑似推广媒体风险',
      '正文或媒体引用名出现二维码、扫码或疑似推广素材信号；当前版本不宣称已经完成图片像素级 OCR/二维码解码。',
      '删除营销二维码和联系方式图片；后续可接入图片 OCR/二维码识别做像素级复核。',
    )
  }

  if (paragraphs.some(value => value.length > 1000)) {
    addFinding(findings, 'QUALITY-PARAGRAPH', 'WARN', 'QUALITY', '存在超长段落', '部分段落超过 1000 字，移动端阅读和信息定位会比较困难。', '拆分段落，每段围绕一个明确观点或事实。')
  }
  if (paragraphs.length <= 1 && body.length > 1400) {
    addFinding(findings, 'QUALITY-STRUCTURE', 'WARN', 'QUALITY', '长文缺少清晰结构', '较长正文没有明显的小节结构。', '使用自然的小标题组织主题、事实、案例、结论。')
  }
  if (repeatedSentences.length) {
    addFinding(findings, 'QUALITY-DUPLICATE', repeatedSentences.length >= 2 ? 'BLOCK' : 'WARN', 'QUALITY', '发现重复句/机械扩写', '同一语义片段重复出现，可能降低内容独特性和阅读质量。', '删除重复段落，补充新的事实、案例、数据或分析。')
  }
  if (boilerplateHits.length >= 3) {
    addFinding(findings, 'QUALITY-BOILERPLATE', 'WARN', 'QUALITY', '模板化套话较多', '开头或结尾存在较多泛化套话，容易让文章缺少真实信息密度。', '直接进入事实、经验、数据和结论，减少空泛铺垫。')
  }

  if (title.length >= 2) {
    const relevant = titleSignals(title).some(signal => bodyLower.includes(signal.toLowerCase()))
    if (!relevant) {
      addFinding(findings, 'SEO-TOPIC-MISMATCH', 'WARN', 'SEO', '标题主题在正文中缺少对应信息', '标题中的主要词组在正文中几乎没有出现，存在题文相关性风险。', '确保正文真正回答标题所承诺的问题，不要为搜索词单独拼接标题。')
    }
  }

  if (input.contentType === 'article' && body.length < 320) {
    addFinding(findings, 'QUALITY-THIN', 'WARN', 'QUALITY', '正文信息量偏少', '正文较短，可能尚未提供足够的事实、经验或分析。这里不是按字数判定质量，而是提示检查内容是否完整。', '补充背景、过程、关键事实、个人经验、数据或结论。')
  }

  if (input.contentType === 'article' && body.length >= 700 && firstHandSignals.length === 0) {
    addFinding(findings, 'QUALITY-FIRSTHAND', 'WARN', 'QUALITY', '缺少明显的第一手信息信号', '较长文章未识别到实测、案例、数据、来源或个人判断等明显增值信号。', '加入你亲自验证的过程、数据、案例、观察、限制条件或明确观点。')
  }

  if (firstHandSignals.length) positiveSignals.push('检测到第一手经验/数据/来源/观点信号')
  if (headingCount > 0) positiveSignals.push('存在可识别的小节结构')
  if (input.contentType !== 'post' && body.length >= 800) positiveSignals.push('正文达到较完整的信息承载量')
  if (externalUrls.length === 0) positiveSignals.push('未发现外部网址')
  if (phones.length === 0) positiveSignals.push('未发现电话/手机号候选')
  if (messengerIds.length === 0) positiveSignals.push('未发现主流即时通讯账号/邀请链接')

  if (aiMode === 'full') {
    addFinding(findings, 'AI-FULL-AUTO', 'BLOCK', 'AI', '禁止整篇 AI 自动成稿直接发布', 'LuckRead 要求 AI 用于提纲、结构、整理或辅助润色，不能把整篇 AI 成稿不经创作者实质补充直接提交。', '回到草稿，加入你自己的事实、经历、数据、案例、判断和核验；再重新提交。')
  }
  if (input.contentType === 'article' && humanContribution !== 'substantial') {
    addFinding(findings, 'AI-HUMAN-CONTRIBUTION', 'BLOCK', 'AI', '创作者实质贡献不足', '文章发布要求作者本人完成实质性补充和事实核验；只生成框架或轻微改写不能替代创作者对正文负责。', '至少补充真实经验、独立观点、案例或数据，并逐项核验关键事实。')
  }
  if (aiMode === 'assist' && input.contentType === 'article' && firstHandSignals.length === 0 && boilerplateHits.length >= 2) {
    addFinding(findings, 'AI-GENERIC-RISK', 'WARN', 'AI', '存在较明显的 AI 模板化风险', '检测到模板化表达与缺少第一手信息同时出现。该结果不是 AI 作者身份鉴定，只是质量风险提示。', '把 AI 生成的泛化表述改成你自己的事实、观察、案例和判断。')
  }
  if (aiMode === 'outline') positiveSignals.push('AI 用于提纲/框架，符合 LuckRead 创作者规范')
  if (humanContribution === 'substantial') positiveSignals.push('已声明创作者完成实质性补充与核验')

  const blocks = findings.filter(item => item.severity === 'BLOCK').length
  const warns = findings.filter(item => item.severity === 'WARN').length
  const score = clampScore(100 - blocks * 35 - warns * 8 + Math.min(firstHandSignals.length * 2, 10) + Math.min(headingCount * 2, 6))
  const verdict: PreflightVerdict = blocks > 0 ? 'RED' : warns > 0 ? 'YELLOW' : 'PASS'

  return {
    policyVersion: 'luckread.publish-preflight.v1',
    verdict,
    score,
    seoReadiness: verdict === 'RED' ? 'BLOCKED' : verdict === 'YELLOW' ? 'IMPROVE' : 'READY',
    summary: verdict === 'RED'
      ? '发布前检查未通过：请先处理阻断项。'
      : verdict === 'YELLOW'
        ? '可以继续，但建议先处理提示项，提升内容质量与搜索友好性。'
        : '基础发布前检查通过，内容仍会进入 LuckRead 正式审核流程。',
    findings,
    positiveSignals: Array.from(new Set(positiveSignals)),
    analyzed: {
      titleChars: title.length,
      bodyChars: body.length,
      paragraphCount: paragraphs.length,
      headingCount,
      externalUrlCount: externalUrls.length,
      phoneCount: phoneDetections.phoneCount,
      mobileNumberCount: phoneDetections.mobileCount,
      detectedPhoneRegions: phoneDetections.regions,
      messengerIdCount: messengerIds.length,
      detectedMessengers: Array.from(new Set(messengerIds.map(item => item.platform))),
    },
  }
}
