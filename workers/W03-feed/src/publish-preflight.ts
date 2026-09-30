/// <reference types="@cloudflare/workers-types" />

import { detectContactSignals, type ContactSignal } from './contact-detector.js'

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
  contactSignals: ContactSignal[]
  analyzed: {
    titleChars: number
    bodyChars: number
    paragraphCount: number
    headingCount: number
    externalUrlCount: number
    phoneCount: number
    mobileNumberCount: number
    detectedMobileRegions: string[]
    messengerIdCount: number
    detectedMessengers: string[]
    socialProfileCount: number
    emailCount: number
    urlCount: number
    obfuscationDetected: boolean
  }
}

const AI_MODES = new Set<AiMode>(['none', 'outline', 'assist', 'full'])
const HUMAN_LEVELS = new Set<HumanContribution>(['substantial', 'light', 'none'])

const normalize = (value: string): string =>
  value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\r\n?/g, '\n').trim()

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))

const count = (value: string, pattern: RegExp): number => value.match(pattern)?.length ?? 0

const firstMatches = (value: string, pattern: RegExp, max = 6): string[] =>
  Array.from(value.matchAll(pattern)).slice(0, max).map(match => match[0])


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
  const bodyLower = body.toLowerCase()
  const aiMode = normalizedMode(input.aiMode)
  const humanContribution = normalizedHumanContribution(input.humanContribution)
  const titleLower = title.toLowerCase()
  const contactDetection = detectContactSignals(body)
  const externalUrls = firstMatches(body, /(?:https?:\/\/|www\.)[^\s<>"')]+/gi, 10)
  const phoneCount = contactDetection.phoneCount
  const messengerIdCount = contactDetection.messengerIdCount
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
    body,
    /(?:优惠|折扣|促销|下单|购买|付款|代理|加盟|招商|返利|赚钱|课程|咨询|推广|引流|私域|加V|加vx|加微信|扫码|私聊|联系我|添加好友)/gi,
    15,
  )
  const qrSignals = firstMatches(body, /(?:二维码|扫码|扫一扫|识别下方二维码)/gi, 8)
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
  if (/^[\s\W_]+$/u.test(title) || /(.)\1{7,}/u.test(title)) {
    addFinding(findings, 'SEO-TITLE-NOISE', 'BLOCK', 'SEO', '标题含明显乱码/重复字符', '标题存在异常符号或重复字符，影响可读性与可信度。', '重写为自然、明确、可理解的标题。')
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
    const hasPromotion = salesSignals.length > 0 || contactSignals.length > 0 || qrSignals.length > 0
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

  if (phoneCount > 0) {
    const hasPromotion = contactDetection.leadGenerationSignals.length > 0 || messengerIdCount > 0 || externalUrls.length > 0
    const regions = contactDetection.detectedMobileRegions.slice(0, 5)
    addFinding(
      findings,
      'CONTACT-PHONE',
      hasPromotion ? 'BLOCK' : 'WARN',
      'CONTACT',
      contactDetection.mobileNumberCount > 0 ? '发现手机号/移动号码' : '发现电话号候选',
      hasPromotion
        ? '检测到电话/手机号，并与即时通讯账号、网址或推广导流信号组合出现。'
        : '正文存在手机号候选' + (regions.length ? '（覆盖：' + regions.join('、') + (contactDetection.detectedMobileRegions.length > 5 ? '等' : '') + '）' : '') + '；第一层依据号码计划与格式做候选识别，不等同于实时运营商或号码存活核验。',
      '删除个人联系方式和导流号码；确有必要时仅保留公开机构联系方式，并注明来源。',
    )
  }

  if (messengerIdCount > 0) {
    const hasIntent = contactDetection.leadGenerationSignals.length > 0 || externalUrls.length > 0 || qrSignals.length > 0
    addFinding(
      findings,
      'CONTACT-MESSENGER-ID',
      hasIntent ? 'BLOCK' : 'WARN',
      'CONTACT',
      '发现即时通讯/社交账号或邀请链接',
      hasIntent
        ? '检测到即时通讯、社交账号或邀请链接，并伴随导流/营销信号。'
        : '检测到明确的即时通讯、社交账号或邀请链接格式；单独提及平台名称不会触发本项。',
      hasIntent ? '删除私聊、加群、邀请链接和营销账号；确有必要时只保留公开机构联系信息并说明来源。' : '确认该账号信息是报道事实所必需；否则删除或改为公开机构信息。',
    )
  }

  if (contactDetection.socialProfileCount > 0) {
    const hasIntent = contactDetection.leadGenerationSignals.length > 0 || externalUrls.length > 0 || qrSignals.length > 0
    addFinding(
      findings,
      'CONTACT-SOCIAL-PROFILE',
      hasIntent ? 'BLOCK' : 'WARN',
      'CONTACT',
      '发现社交平台个人主页链接',
      hasIntent ? '检测到 Instagram、TikTok、X、Snapchat 或 Reddit 等社交主页，并伴随导流信号。' : '检测到社交平台个人主页链接；确认它是否是报道事实所必需。',
      '删除站外导流主页；如属于信息来源，使用公开机构/原始来源并说明用途。',
    )
  }

  if (contactDetection.emailCount > 0) {
    const hasIntent = contactDetection.leadGenerationSignals.length > 0 || externalUrls.length > 0
    addFinding(
      findings,
      'CONTACT-EMAIL',
      hasIntent ? 'BLOCK' : 'WARN',
      'CONTACT',
      '发现电子邮箱地址',
      hasIntent ? '邮箱地址与网址或推广/导流语句组合出现。' : '正文存在电子邮箱，请确认公开邮箱属于报道事实所必需信息。',
      '删除个人邮箱和营销邮箱；确有必要时只保留公开机构邮箱并注明来源。',
    )
  }

  if (contactDetection.obfuscationDetected && (phoneCount > 0 || messengerIdCount > 0 || contactDetection.emailCount > 0)) {
    addFinding(
      findings,
      'SEC-CONTACT-OBFUSCATION',
      'WARN',
      'SECURITY',
      '发现可能的联系方式混淆写法',
      '文本包含零宽字符、同形 Unicode 或其他可能降低规则命中率的写法；系统已在内部做规范化后再次检测。',
      '恢复为正常、可读的文本；不要使用隐藏字符或故意拆分联系方式。',
    )
  }

  if (qrSignals.length || mediaRiskRefs.length) {
    addFinding(
      findings,
      'MEDIA-QR',
      qrSignals.length && (salesSignals.length || contactSignals.length) ? 'BLOCK' : 'WARN',
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
  if (phoneCount === 0) positiveSignals.push('未发现疑似手机号/电话候选')
  if (messengerIdCount === 0 && contactDetection.socialProfileCount === 0) positiveSignals.push('未发现明确的即时通讯/社交账号链接')
  if (contactDetection.obfuscationDetected) positiveSignals.push('已执行 Unicode/隐藏字符规范化检测')

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

  const contactSignals: ContactSignal[] = contactDetection.signals.slice(0, 24)

  return {
    policyVersion: 'luckread.publish-preflight.v1',
    contactSignals,
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
      phoneCount: contactDetection.phoneCount,
      mobileNumberCount: contactDetection.mobileNumberCount,
      detectedMobileRegions: contactDetection.detectedMobileRegions,
      messengerIdCount: contactDetection.messengerIdCount,
      detectedMessengers: contactDetection.detectedMessengers,
      socialProfileCount: contactDetection.socialProfileCount,
      emailCount: contactDetection.emailCount,
      urlCount: contactDetection.urlCount,
      obfuscationDetected: contactDetection.obfuscationDetected,
    },
  }
}
