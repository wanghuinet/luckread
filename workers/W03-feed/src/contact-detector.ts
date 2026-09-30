/// <reference types="@cloudflare/workers-types" />

import { parsePhoneNumberFromString } from 'libphonenumber-js/mobile'
import { parse as parseDomain } from 'tldts'

export type ContactSignalKind = 'PHONE' | 'MESSENGER' | 'SOCIAL' | 'EMAIL' | 'URL'
export type ContactSignalConfidence = 'HIGH' | 'MEDIUM'

export type ContactSignal = {
  kind: ContactSignalKind
  platform?: string
  region?: string
  phoneKind?: 'MOBILE' | 'LANDLINE' | 'UNKNOWN'
  confidence: ContactSignalConfidence
  reasonCode:
    | 'PHONE_VALID'
    | 'PHONE_POSSIBLE'
    | 'PHONE_NATIONAL_CONTEXT'
    | 'MESSENGER_INVITE_URL'
    | 'MESSENGER_LABELED_ID'
    | 'SOCIAL_PROFILE_URL'
    | 'EMAIL_ADDRESS'
    | 'CONTACT_KEYWORD'
  maskedValue: string
}

export type ContactDetectionResult = {
  signals: ContactSignal[]
  phoneCount: number
  mobileNumberCount: number
  detectedMobileRegions: string[]
  messengerIdCount: number
  detectedMessengers: string[]
  socialProfileCount: number
  emailCount: number
  urlCount: number
  detectedDomains: string[]
  leadGenerationSignals: string[]
  obfuscationDetected: boolean
}

type MobileNumberRule = {
  region: string
  countryCode: string
  international: RegExp
  national?: RegExp
  mobileSpecific: boolean
}

type MessengerRule = {
  platform: string
  domains: string[]
  patterns: RegExp[]
  profileKind: 'messenger' | 'social' | 'enterprise' | 'community'
}

const ZERO_WIDTH_RE = /[\u200B-\u200D\u061C\u180E\u200E\u200F\u2060-\u2064\u2066-\u206F\uFEFF]/g
const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069]/g
const CONFUSABLES: Record<string, string> = {
  '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c', '\u0445': 'x',
  '\u0410': 'A', '\u0415': 'E', '\u041E': 'O', '\u0420': 'P', '\u0421': 'C', '\u0425': 'X',
  '\u03B1': 'a', '\u03BF': 'o', '\u03C1': 'p', '\u03C7': 'x', '\u0391': 'A', '\u039F': 'O',
  '\u0399': 'I', '\u03B9': 'i', '\u0131': 'i', '\u0130': 'I',
}

const MOBILE_NUMBER_RULES: MobileNumberRule[] = [
  { region: 'China (+86)', countryCode: '86', international: /^1[3-9]\d{9}$/, national: /^1[3-9]\d{9}$/, mobileSpecific: true },
  { region: 'Hong Kong (+852)', countryCode: '852', international: /^[569]\d{7}$/, national: /^[569]\d{7}$/, mobileSpecific: true },
  { region: 'Macao (+853)', countryCode: '853', international: /^6\d{7}$/, national: /^6\d{7}$/, mobileSpecific: true },
  { region: 'Taiwan (+886)', countryCode: '886', international: /^9\d{8}$/, national: /^09\d{8}$/, mobileSpecific: true },
  { region: 'Japan (+81)', countryCode: '81', international: /^(70|80|90)\d{8}$/, national: /^0(70|80|90)\d{8}$/, mobileSpecific: true },
  { region: 'South Korea (+82)', countryCode: '82', international: /^10\d{8}$/, national: /^010\d{8}$/, mobileSpecific: true },
  { region: 'United Kingdom (+44)', countryCode: '44', international: /^7(?:1|2|3|4|5|7|8|9)\d{8}$/, national: /^07(?:1|2|3|4|5|7|8|9)\d{8}$/, mobileSpecific: true },
  { region: 'France (+33)', countryCode: '33', international: /^[67]\d{8}$/, national: /^0[67]\d{8}$/, mobileSpecific: true },
  { region: 'Germany (+49)', countryCode: '49', international: /^1[5-7]\d{8,9}$/, national: /^01[5-7]\d{8,9}$/, mobileSpecific: true },
  { region: 'Italy (+39)', countryCode: '39', international: /^3\d{9}$/, national: /^3\d{9}$/, mobileSpecific: true },
  { region: 'Spain (+34)', countryCode: '34', international: /^[67]\d{8}$/, national: /^[67]\d{8}$/, mobileSpecific: true },
  { region: 'Portugal (+351)', countryCode: '351', international: /^9\d{8}$/, national: /^9\d{8}$/, mobileSpecific: true },
  { region: 'Netherlands (+31)', countryCode: '31', international: /^6\d{8}$/, national: /^06\d{8}$/, mobileSpecific: true },
  { region: 'Belgium (+32)', countryCode: '32', international: /^4\d{8}$/, national: /^04\d{8}$/, mobileSpecific: true },
  { region: 'Switzerland (+41)', countryCode: '41', international: /^7[5-9]\d{7}$/, national: /^07[5-9]\d{7}$/, mobileSpecific: true },
  { region: 'Ireland (+353)', countryCode: '353', international: /^8[3-9]\d{7}$/, national: /^08[3-9]\d{7}$/, mobileSpecific: true },
  { region: 'Poland (+48)', countryCode: '48', international: /^[5-8]\d{8}$/, national: /^[5-8]\d{8}$/, mobileSpecific: true },
  { region: 'Czechia (+420)', countryCode: '420', international: /^[67]\d{8}$/, national: /^[67]\d{8}$/, mobileSpecific: true },
  { region: 'Hungary (+36)', countryCode: '36', international: /^(20|30|31|50|70)\d{7}$/, national: /^(20|30|31|50|70)\d{7}$/, mobileSpecific: true },
  { region: 'Romania (+40)', countryCode: '40', international: /^7\d{8}$/, national: /^07\d{8}$/, mobileSpecific: true },
  { region: 'Greece (+30)', countryCode: '30', international: /^69\d{8}$/, national: /^069\d{8}$/, mobileSpecific: true },
  { region: 'Türkiye (+90)', countryCode: '90', international: /^5\d{9}$/, national: /^05\d{9}$/, mobileSpecific: true },
  { region: 'Russia/Kazakhstan (+7)', countryCode: '7', international: /^9\d{9}$/, national: /^8(?:9\d{9})$/, mobileSpecific: true },
  { region: 'Ukraine (+380)', countryCode: '380', international: /^(50|63|66|67|68|73|91|93|95|96|97|98|99)\d{7}$/, national: /^0(?:50|63|66|67|68|73|91|93|95|96|97|98|99)\d{7}$/, mobileSpecific: true },
  { region: 'Israel (+972)', countryCode: '972', international: /^5\d{8}$/, national: /^05\d{8}$/, mobileSpecific: true },
  { region: 'United Arab Emirates (+971)', countryCode: '971', international: /^5\d{8}$/, national: /^05\d{8}$/, mobileSpecific: true },
  { region: 'Saudi Arabia (+966)', countryCode: '966', international: /^5\d{8}$/, national: /^05\d{8}$/, mobileSpecific: true },
  { region: 'South Africa (+27)', countryCode: '27', international: /^[6-8]\d{8}$/, national: /^0[6-8]\d{8}$/, mobileSpecific: true },
  { region: 'United States/Canada (NANP)', countryCode: '1', international: /^[2-9]\d{9}$/, national: /^[2-9]\d{9}$/, mobileSpecific: false },
  { region: 'Mexico (+52)', countryCode: '52', international: /^[2-9]\d{9}$/, mobileSpecific: false },
  { region: 'Brazil (+55)', countryCode: '55', international: /^\d{2}9\d{8}$/, national: /^\d{2}9\d{8}$/, mobileSpecific: true },
  { region: 'Australia (+61)', countryCode: '61', international: /^4\d{8}$/, national: /^04\d{8}$/, mobileSpecific: true },
  { region: 'New Zealand (+64)', countryCode: '64', international: /^2\d{7,9}$/, national: /^02\d{7,9}$/, mobileSpecific: true },
  { region: 'India (+91)', countryCode: '91', international: /^[6-9]\d{9}$/, national: /^[6-9]\d{9}$/, mobileSpecific: true },
  { region: 'Pakistan (+92)', countryCode: '92', international: /^3\d{9}$/, national: /^03\d{9}$/, mobileSpecific: true },
  { region: 'Bangladesh (+880)', countryCode: '880', international: /^1[3-9]\d{8}$/, national: /^01[3-9]\d{8}$/, mobileSpecific: true },
  { region: 'Indonesia (+62)', countryCode: '62', international: /^8\d{8,11}$/, national: /^08\d{8,11}$/, mobileSpecific: true },
  { region: 'Malaysia (+60)', countryCode: '60', international: /^1\d{8,9}$/, national: /^01\d{8,9}$/, mobileSpecific: true },
  { region: 'Singapore (+65)', countryCode: '65', international: /^[89]\d{7}$/, national: /^[89]\d{7}$/, mobileSpecific: true },
  { region: 'Thailand (+66)', countryCode: '66', international: /^[689]\d{8}$/, national: /^0[689]\d{8}$/, mobileSpecific: true },
  { region: 'Philippines (+63)', countryCode: '63', international: /^9\d{9}$/, national: /^09\d{9}$/, mobileSpecific: true },
  { region: 'Vietnam (+84)', countryCode: '84', international: /^[35789]\d{8}$/, national: /^0[35789]\d{8}$/, mobileSpecific: true },
  { region: 'Cambodia (+855)', countryCode: '855', international: /^[1-9]\d{7,8}$/, national: /^0[1-9]\d{7,8}$/, mobileSpecific: true },
  { region: 'Laos (+856)', countryCode: '856', international: /^20\d{8}$/, national: /^020\d{8}$/, mobileSpecific: true },
  { region: 'Myanmar (+95)', countryCode: '95', international: /^9\d{7,9}$/, national: /^09\d{7,9}$/, mobileSpecific: true },
  { region: 'Brunei (+673)', countryCode: '673', international: /^[78]\d{6}$/, national: /^[78]\d{6}$/, mobileSpecific: true },
]

const MESSENGER_RULES: MessengerRule[] = [
  { platform: 'WhatsApp', domains: ['wa.me', 'whatsapp.com'], patterns: [
    /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send(?:\?phone=)?)[^\s<>"')]+/gi,
    /\bWhatsApp\s*(?:ID|账号|号码|number)?\s*[:：=]?\s*(?:\+?\d[\d\s().-]{7,}\d)\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'Telegram', domains: ['t.me', 'telegram.me'], patterns: [
    /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/[A-Za-z0-9_]{3,64}\b/gi,
    /\bTelegram\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*@?[A-Za-z][A-Za-z0-9_]{3,31}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'Facebook Messenger', domains: ['m.me', 'messenger.com', 'facebook.com'], patterns: [
    /(?:https?:\/\/)?m\.me\/[A-Za-z0-9._-]{2,64}\b/gi,
    /(?:https?:\/\/)?(?:messenger\.com\/t|facebook\.com\/messages\/t)\/[A-Za-z0-9._-]{2,64}\b/gi,
    /\bMessenger\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*@?[A-Za-z0-9._-]{3,64}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'WeChat', domains: ['weixin.qq.com', 'wechat.com'], patterns: [
    /(?:https?:\/\/)?(?:weixin\.qq\.com|wechat\.com)\/[^\s<>"')]+/gi,
    /(?:微信号|WeChat\s*(?:ID|username)?|weixin)\s*[:：=]?\s*[A-Za-z][A-Za-z0-9_-]{3,19}\b/gi,
    /\bwxid_[A-Za-z0-9_-]{4,32}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'LINE', domains: ['line.me'], patterns: [
    /(?:https?:\/\/)?line\.me\/(?:R\/ti\/p\/|ti\/p\/~?)[^\s<>"')]+/gi,
    /\bLINE\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*@?[A-Za-z0-9._-]{3,32}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'QQ', domains: ['qq.com'], patterns: [
    /(?:QQ(?:号|账号|ID)?|扣扣)\s*[:：=]?\s*\d{5,12}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'Signal', domains: ['signal.me'], patterns: [
    /(?:https?:\/\/)?signal\.me\/[^\s<>"')]+/gi,
    /\bSignal\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*@?[A-Za-z0-9._-]{3,64}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'Viber', domains: ['vb.me', 'viber.com'], patterns: [
    /(?:https?:\/\/)?(?:vb\.me|viber\.com)\/[^\s<>"')]+/gi,
    /\bViber\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*@?[A-Za-z0-9._+-]{3,32}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'KakaoTalk', domains: ['open.kakao.com'], patterns: [
    /(?:https?:\/\/)?open\.kakao\.com\/[^\s<>"')]+/gi,
    /\bKakao(?:Talk)?\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*@?[A-Za-z0-9._-]{3,32}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'Discord', domains: ['discord.gg', 'discord.com'], patterns: [
    /(?:https?:\/\/)?(?:discord\.gg|discord\.com\/users|discordapp\.com\/users)\/[^\s<>"')]+/gi,
    /\bDiscord\s*(?:ID|username|用户名|账号)?\s*[:：=]?\s*@?[A-Za-z0-9._-]{2,64}(?:#\d{4})?\b/gi,
  ], profileKind: 'community' },

  { platform: 'Instagram', domains: ['instagram.com'], patterns: [
    /(?:https?:\/\/)?instagram\.com\/[A-Za-z0-9._]{1,30}(?:\/)?/gi,
    /\bInstagram\s*(?:ID|username|用户名|账号)\s*[:：=]?\s*@?[A-Za-z0-9._]{2,30}\b/gi,
  ], profileKind: 'social' },
  { platform: 'Snapchat', domains: ['snapchat.com'], patterns: [
    /(?:https?:\/\/)?snapchat\.com\/add\/[A-Za-z0-9._-]{2,32}\b/gi,
    /\bSnapchat\s*(?:ID|username|用户名|账号)\s*[:：=]?\s*@?[A-Za-z0-9._-]{2,32}\b/gi,
  ], profileKind: 'social' },
  { platform: 'TikTok', domains: ['tiktok.com'], patterns: [
    /(?:https?:\/\/)?tiktok\.com\/@?[A-Za-z0-9._-]{2,32}\b/gi,
    /\bTikTok\s*(?:ID|username|用户名|账号)\s*[:：=]?\s*@?[A-Za-z0-9._-]{2,32}\b/gi,
  ], profileKind: 'social' },
  { platform: 'X', domains: ['x.com', 'twitter.com'], patterns: [
    /(?:https?:\/\/)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{2,20}\b/gi,
    /\b(?:X|Twitter)\s*(?:ID|username|用户名|账号)\s*[:：=]?\s*@?[A-Za-z0-9_]{2,20}\b/gi,
  ], profileKind: 'social' },
  { platform: 'Reddit', domains: ['reddit.com'], patterns: [
    /(?:https?:\/\/)?reddit\.com\/u\/[A-Za-z0-9_-]{2,30}\b/gi,
    /\bReddit\s*(?:ID|username|用户名|账号)\s*[:：=]?\s*u?\/?[A-Za-z0-9_-]{2,30}\b/gi,
  ], profileKind: 'social' },

  { platform: 'Zalo', domains: ['zalo.me'], patterns: [
    /(?:https?:\/\/)?zalo\.me\/[^\s<>"')]+/gi,
    /\bZalo\s*(?:ID|username|用户名|账号|号码)\s*[:：=]?\s*@?[A-Za-z0-9._+-]{3,40}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'imo', domains: ['imo.im'], patterns: [
    /(?:https?:\/\/)?imo\.im\/[^\s<>"')]+/gi,
    /\bimo\s*(?:ID|username|用户名|账号)\s*[:：=]?\s*@?[A-Za-z0-9._-]{3,40}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'BiP', domains: ['bip.com'], patterns: [
    /\bBiP\s*(?:ID|username|用户名|账号|号码)\s*[:：=]?\s*@?[A-Za-z0-9._+-]{3,40}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'Kik', domains: ['kik.com', 'kik.me'], patterns: [
    /(?:https?:\/\/)?kik\.me\/[A-Za-z0-9._-]{2,32}\b/gi,
    /\bKik\s*(?:ID|username|用户名|账号)\s*[:：=]?\s*@?[A-Za-z0-9._-]{3,32}\b/gi,
  ], profileKind: 'messenger' },

  { platform: 'Microsoft Teams', domains: ['teams.microsoft.com'], patterns: [
    /(?:https?:\/\/)?teams\.microsoft\.com\/[^\s<>"')]+/gi,
    /\bMicrosoft\s+Teams\s*(?:ID|账号|邀请链接|invite)\s*[:：=]?\s*[A-Za-z0-9@._:/?=&%-]{3,120}/gi,
  ], profileKind: 'enterprise' },
  { platform: 'Slack', domains: ['slack.com', 'join.slack.com'], patterns: [
    /(?:https?:\/\/)?join\.slack\.com\/[^\s<>"')]+/gi,
    /\bSlack\s*(?:workspace|ID|账号|邀请|invite)\s*[:：=]?\s*[A-Za-z0-9._-]{3,80}/gi,
  ], profileKind: 'enterprise' },
  { platform: 'Google Chat', domains: ['chat.google.com'], patterns: [
    /(?:https?:\/\/)?chat\.google\.com\/[^\s<>"')]+/gi,
    /\bGoogle\s+Chat\s*(?:ID|账号|邀请|invite)\s*[:：=]?\s*[A-Za-z0-9._:/?=&%-]{3,120}/gi,
  ], profileKind: 'enterprise' },
  { platform: 'WeCom', domains: ['work.weixin.qq.com'], patterns: [
    /(?:https?:\/\/)?work\.weixin\.qq\.com\/[^\s<>"')]+/gi,
    /\b(?:企业微信|WeCom)\s*(?:ID|账号|username|邀请)\s*[:：=]?\s*[A-Za-z0-9._-]{3,40}\b/gi,
  ], profileKind: 'enterprise' },
  { platform: 'DingTalk', domains: ['dingtalk.com'], patterns: [
    /\b(?:钉钉|DingTalk)\s*(?:ID|账号|username|邀请)\s*[:：=]?\s*[A-Za-z0-9._-]{3,40}\b/gi,
  ], profileKind: 'enterprise' },
  { platform: 'Feishu/Lark', domains: ['feishu.cn', 'larksuite.com'], patterns: [
    /(?:https?:\/\/)?(?:feishu\.cn|larksuite\.com)\/[^\s<>"')]+/gi,
    /\b(?:飞书|Lark|Feishu)\s*(?:ID|账号|username|邀请)\s*[:：=]?\s*[A-Za-z0-9._-]{3,40}\b/gi,
  ], profileKind: 'enterprise' },
  { platform: 'Threema', domains: ['threema.ch'], patterns: [
    /\bThreema\s*(?:ID|账号|username)\s*[:：=]?\s*[A-Za-z0-9*]{5,20}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'Matrix/Element', domains: ['matrix.to', 'element.io', 'app.element.io'], patterns: [
    /(?:https?:\/\/)?matrix\.to\/#[^\\s<>"')]+/gi,
    /(?:https?:\/\/)?app\.element\.io\/[^\s<>"')]+/gi,
    /\b(?:Matrix|Element)\s*(?:ID|账号|username)\s*[:：=]?\s*@?[A-Za-z0-9._=-]{3,64}/gi,
  ], profileKind: 'community' },
  { platform: 'XMPP', domains: [], patterns: [
    /\bxmpp:[^\s<>"')]+/gi,
    /\bXMPP\s*(?:ID|账号|JID)\s*[:：=]?\s*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\b/gi,
  ], profileKind: 'community' },
  { platform: 'Session', domains: [], patterns: [
    /\bSession\s*(?:ID|账号|ID\s*字符串)\s*[:：=]?\s*[A-Za-z0-9_-]{20,100}\b/gi,
  ], profileKind: 'messenger' },
  { platform: 'SimpleX', domains: ['simplex.chat'], patterns: [
    /(?:https?:\/\/)?simplex\.chat\/[^\s<>"')]+/gi,
    /\bSimpleX\s*(?:ID|账号|邀请)\s*[:：=]?\s*[A-Za-z0-9._:/?=&%-]{6,120}/gi,
  ], profileKind: 'messenger' },
]

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_CANDIDATE_RE = /(?<![\d+])(?:\+?\d[\d\s().-]{6,}\d)(?!\d)/g
const PHONE_CONTEXT_RE = /(?:phone|telephone|mobile|cell|call|tel|contact|whatsapp|number|联系电话|电话|手机|手机号|移动电话|联系号码|联系方式|客服热线)/i
const LEAD_GENERATION_RE = /(?:加我|加v|加vx|加微信|加好友|扫码|私聊|联系我|添加好友|加群|入群|下单|购买|付款|优惠|折扣|促销|代理|加盟|招商|返利|赚钱|课程|咨询|推广|引流|私域|dm me|message me|contact me|book now|buy now|order now|join my group|join us)/gi

const firstMatches = (value: string, pattern: RegExp, max = 6): string[] =>
  Array.from(value.matchAll(pattern)).slice(0, max).map(match => match[0])

const compactContactLabels = (value: string): string => value.replace(/[\s\u00A0·•]+/g, '')

const normalizeContactText = (value: string): { normalized: string; hadObfuscation: boolean } => {
  const nfkc = value.normalize('NFKC')
  const stripped = nfkc.replace(ZERO_WIDTH_RE, '').replace(BIDI_CONTROL_RE, '')
  let normalized = ''
  let hadConfusable = false
  for (const char of stripped) {
    const replacement = CONFUSABLES[char]
    if (replacement) {
      normalized += replacement
      hadConfusable = true
    } else {
      normalized += char
    }
  }
  return {
    normalized,
    hadObfuscation: hadConfusable || stripped !== nfkc,
  }
}

const maskValue = (value: string): string => {
  const clean = value.trim()
  if (clean.length <= 4) return '***'
  if (/\d/.test(clean) && clean.replace(/\D/g, '').length >= 7) {
    const digits = clean.replace(/\D/g, '')
    return clean.replace(digits, digits.slice(0, 2) + '****' + digits.slice(-2))
  }
  return clean.slice(0, 2) + '***' + clean.slice(-2)
}

const regionLabel = (country?: string, callingCode?: string): string => {
  const callingCodeLabels: Record<string, string> = {
    '1': 'United States/Canada (NANP)', '33': 'France (+33)', '34': 'Spain (+34)', '39': 'Italy (+39)',
    '44': 'United Kingdom (+44)', '49': 'Germany (+49)', '52': 'Mexico (+52)', '55': 'Brazil (+55)',
    '60': 'Malaysia (+60)', '61': 'Australia (+61)', '62': 'Indonesia (+62)', '63': 'Philippines (+63)',
    '64': 'New Zealand (+64)', '65': 'Singapore (+65)', '66': 'Thailand (+66)', '81': 'Japan (+81)',
    '82': 'South Korea (+82)', '84': 'Vietnam (+84)', '86': 'China (+86)', '90': 'Türkiye (+90)',
    '91': 'India (+91)', '92': 'Pakistan (+92)', '95': 'Myanmar (+95)', '351': 'Portugal (+351)',
    '353': 'Ireland (+353)', '380': 'Ukraine (+380)', '420': 'Czechia (+420)', '40': 'Romania (+40)',
    '41': 'Switzerland (+41)', '43': 'Austria (+43)', '45': 'Denmark (+45)', '46': 'Sweden (+46)',
    '47': 'Norway (+47)', '48': 'Poland (+48)', '852': 'Hong Kong (+852)', '853': 'Macao (+853)',
    '855': 'Cambodia (+855)', '856': 'Laos (+856)', '880': 'Bangladesh (+880)', '886': 'Taiwan (+886)',
    '966': 'Saudi Arabia (+966)', '971': 'United Arab Emirates (+971)', '972': 'Israel (+972)',
  }
  if (callingCode && callingCodeLabels[callingCode]) return callingCodeLabels[callingCode]
  if (!country) return callingCode ? '国际号码 (+' + callingCode + ')' : '未知地区'
  const labels: Record<string, string> = {
    CN: 'China (+86)', HK: 'Hong Kong (+852)', MO: 'Macao (+853)', TW: 'Taiwan (+886)',
    JP: 'Japan (+81)', KR: 'South Korea (+82)', US: 'United States (+1)', CA: 'Canada (+1)',
    GB: 'United Kingdom (+44)', FR: 'France (+33)', DE: 'Germany (+49)', IT: 'Italy (+39)',
    ES: 'Spain (+34)', PT: 'Portugal (+351)', NL: 'Netherlands (+31)', BE: 'Belgium (+32)',
    CH: 'Switzerland (+41)', IE: 'Ireland (+353)', PL: 'Poland (+48)', CZ: 'Czechia (+420)',
    HU: 'Hungary (+36)', RO: 'Romania (+40)', GR: 'Greece (+30)', TR: 'Türkiye (+90)',
    RU: 'Russia (+7)', KZ: 'Kazakhstan (+7)', UA: 'Ukraine (+380)', IL: 'Israel (+972)',
    AE: 'United Arab Emirates (+971)', SA: 'Saudi Arabia (+966)', ZA: 'South Africa (+27)',
    MX: 'Mexico (+52)', BR: 'Brazil (+55)', AU: 'Australia (+61)', NZ: 'New Zealand (+64)',
    IN: 'India (+91)', PK: 'Pakistan (+92)', BD: 'Bangladesh (+880)', ID: 'Indonesia (+62)',
    MY: 'Malaysia (+60)', SG: 'Singapore (+65)', TH: 'Thailand (+66)', PH: 'Philippines (+63)',
    VN: 'Vietnam (+84)', KH: 'Cambodia (+855)', LA: 'Laos (+856)', MM: 'Myanmar (+95)',
    BN: 'Brunei (+673)',
  }
  return labels[country] ?? country + (callingCode ? ' (+' + callingCode + ')' : '')
}

const detectInternationalPhonesWithLibrary = (value: string): DetectedMobileNumber[] => {
  const matches: DetectedMobileNumber[] = []
  const seen = new Set<string>()
  for (const match of value.matchAll(PHONE_CANDIDATE_RE)) {
    const raw = match[0].trim()
    if (!/^(?:\+|00)/.test(raw)) continue
    const candidate = raw.replace(/^00/, '+')
    try {
      const number = parsePhoneNumberFromString(candidate)
      if (!number) continue
      const valid = number.isValid()
      const possible = number.isPossible()
      if (!valid && !possible) continue
      const key = number.number
      if (seen.has(key)) continue
      seen.add(key)
      const type = number.getType()
      matches.push({
        raw,
        region: regionLabel(number.country, number.countryCallingCode),
        mobileSpecific: type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE',
        confidence: valid ? 'HIGH' : 'MEDIUM',
        source: 'library',
      })
      if (matches.length >= 30) break
    } catch {
      // Invalid individual candidates do not invalidate the rest of the scan.
    }
  }
  return matches
}

type DetectedMobileNumber = {
  raw: string
  region: string
  mobileSpecific: boolean
  confidence: ContactSignalConfidence
  source: 'library' | 'national'
}

const detectNationalPhones = (value: string): DetectedMobileNumber[] => {
  const output: DetectedMobileNumber[] = []
  const dedupe = new Map<string, DetectedMobileNumber>()
  for (const match of value.matchAll(PHONE_CANDIDATE_RE)) {
    const raw = match[0]
    if (/^\+?\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(raw.trim())) continue
    const digits = raw.replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) continue
    const start = Math.max(0, (match.index ?? 0) - 36)
    const end = Math.min(value.length, (match.index ?? 0) + raw.length + 36)
    const context = value.slice(start, end)
    const hasContext = PHONE_CONTEXT_RE.test(context)
    const hasFormatting = /[+\s().-]/.test(raw)
    const hasExplicitInternationalPrefix = /^\s*(?:\+|00)/.test(raw)

    for (const rule of MOBILE_NUMBER_RULES) {
      const internationalMatch = digits.startsWith(rule.countryCode) && rule.international.test(digits.slice(rule.countryCode.length))
      const nationalMatch = rule.national?.test(digits) ?? false
      if (!internationalMatch && !nationalMatch) continue
      if (sourceIsInternationalCandidate(raw, hasExplicitInternationalPrefix)) continue
      if (!hasContext && !hasFormatting) continue
      if (!rule.mobileSpecific && !hasContext) continue

      const key = rule.region + '|' + digits
      if (!dedupe.has(key)) {
        dedupe.set(key, {
          raw,
          region: rule.region,
          mobileSpecific: rule.mobileSpecific,
          confidence: hasContext && rule.mobileSpecific ? 'HIGH' : 'MEDIUM',
          source: 'national',
        })
      }
      break
    }
  }
  return Array.from(dedupe.values()).slice(0, 30)
}

const sourceIsInternationalCandidate = (_raw: string, hasExplicitInternationalPrefix: boolean): boolean =>
  hasExplicitInternationalPrefix

const dedupeSignals = (signals: ContactSignal[]): ContactSignal[] => {
  const seen = new Set<string>()
  return signals.filter(signal => {
    const key = [
      signal.kind,
      signal.platform ?? '',
      signal.region ?? '',
      signal.maskedValue,
    ].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const detectPhones = (value: string): ContactSignal[] => {
  const signals: ContactSignal[] = []
  for (const found of [...detectInternationalPhonesWithLibrary(value), ...detectNationalPhones(value)]) {
    const phoneKind = found.source === 'library'
      ? found.mobileSpecific ? 'MOBILE' : 'LANDLINE'
      : found.mobileSpecific ? 'MOBILE' : 'UNKNOWN'
    signals.push({
      kind: 'PHONE',
      region: found.region,
      phoneKind,
      confidence: found.confidence,
      reasonCode: found.source === 'library'
        ? found.confidence === 'HIGH' ? 'PHONE_VALID' : 'PHONE_POSSIBLE'
        : 'PHONE_NATIONAL_CONTEXT',
      maskedValue: maskValue(found.raw),
    })
  }
  return dedupeSignals(signals)
}

const detectMessengers = (value: string): ContactSignal[] => {
  const signals: ContactSignal[] = []
  const variants = Array.from(new Set([value, normalizeContactText(value).normalized, compactContactLabels(normalizeContactText(value).normalized)]))
  for (const rule of MESSENGER_RULES) {
    for (const pattern of rule.patterns) {
      for (const variant of variants) {
        for (const match of variant.matchAll(pattern)) {
          const raw = match[0]
          const isUrl = /(?:^|\b)(?:https?:\/\/)?(?:wa\.me|t\.me|telegram\.me|m\.me|messenger\.com|facebook\.com|weixin\.qq\.com|wechat\.com|line\.me|signal\.me|vb\.me|viber\.com|open\.kakao\.com|discord\.gg|discord\.com|instagram\.com|snapchat\.com|tiktok\.com|x\.com|twitter\.com|reddit\.com|zalo\.me|imo\.im|kik\.me|teams\.microsoft\.com|join\.slack\.com|chat\.google\.com|work\.weixin\.qq\.com|feishu\.cn|larksuite\.com|matrix\.to|app\.element\.io|simplex\.chat)/i.test(raw)
          signals.push({
            kind: rule.profileKind === 'social' ? 'SOCIAL' : 'MESSENGER',
            platform: rule.platform,
            confidence: isUrl ? 'HIGH' : 'MEDIUM',
            reasonCode: isUrl ? 'MESSENGER_INVITE_URL' : 'MESSENGER_LABELED_ID',
            maskedValue: maskValue(raw),
          })
          if (signals.length >= 80) return dedupeSignals(signals)
        }
      }
    }
  }
  return dedupeSignals(signals)
}

const detectSocialProfileUrls = (value: string): ContactSignal[] => {
  const signals: ContactSignal[] = []
  for (const rule of MESSENGER_RULES.filter(item => item.profileKind === 'social')) {
    for (const pattern of rule.patterns) {
      for (const match of firstMatches(value, pattern, 6)) {
        if (!/^https?:\/\//i.test(match)) continue
        signals.push({
          kind: 'SOCIAL',
          platform: rule.platform,
          confidence: 'HIGH',
          reasonCode: 'SOCIAL_PROFILE_URL',
          maskedValue: match.slice(0, 48) + (match.length > 48 ? '…' : ''),
        })
      }
    }
  }
  return dedupeSignals(signals)
}

const detectEmails = (value: string): ContactSignal[] =>
  firstMatches(value, EMAIL_RE, 12).map(raw => ({
    kind: 'EMAIL' as const,
    confidence: 'HIGH' as const,
    reasonCode: 'EMAIL_ADDRESS' as const,
    maskedValue: maskValue(raw),
  }))

const detectDomains = (value: string): { urls: string[]; domains: string[] } => {
  const urls = firstMatches(value, /(?:https?:\/\/|www\.)[^\s<>"')]+/gi, 20)
  const domains = Array.from(new Set(
    urls.map(url => {
      try {
        const parsed = parseDomain(url)
        return parsed.domain || parsed.hostname || ''
      } catch {
        return ''
      }
    }).filter(Boolean),
  ))
  return { urls, domains }
}

const detectLeadGeneration = (value: string): string[] => {
  const normalized = normalizeContactText(value).normalized
  const variants = Array.from(new Set([normalized, compactContactLabels(normalized)]))
  return Array.from(new Set(variants.flatMap(item => firstMatches(item, LEAD_GENERATION_RE, 20)).map(item => item.trim().toLowerCase())))
}

const containsSpacedPlatformLabel = (value: string, platform: string): boolean => {
  const letters = platform.replace(/[^A-Za-z]/g, '')
  if (letters.length < 3) return false
  const pattern = letters.split('').join('\\s+')
  return new RegExp(pattern, 'i').test(value)
}

export const detectContactSignals = (rawValue: string): ContactDetectionResult => {
')).join('\\s+')
  return new RegExp(pattern, 'i').test(value)
}

export const detectContactSignals = (rawValue: string): ContactDetectionResult => {
  const raw = String(rawValue ?? '')
  const { normalized, hadObfuscation } = normalizeContactText(raw)
  const compacted = compactContactLabels(normalized)
  const signals = dedupeSignals([
    ...detectPhones(raw),
    ...detectPhones(normalized),
    ...detectMessengers(raw),
    ...detectMessengers(normalized),
    ...detectMessengers(compacted),
    ...detectSocialProfileUrls(raw),
    ...detectEmails(raw),
  ])
  const domains = detectDomains(raw)
  const leadGenerationSignals = detectLeadGeneration(normalized)

  for (const domain of domains.domains) {
    const owner = MESSENGER_RULES.find(rule => rule.domains.some(item => item === domain))
    if (owner && !signals.some(signal => signal.platform === owner.platform && signal.reasonCode === 'MESSENGER_INVITE_URL')) {
      signals.push({
        kind: owner.profileKind === 'social' ? 'SOCIAL' : 'MESSENGER',
        platform: owner.platform,
        confidence: 'MEDIUM',
        reasonCode: owner.profileKind === 'social' ? 'SOCIAL_PROFILE_URL' : 'MESSENGER_INVITE_URL',
        maskedValue: domain,
      })
    }
  }

  const phoneSignals = signals.filter(item => item.kind === 'PHONE')
  const messengerSignals = signals.filter(item => item.kind === 'MESSENGER')
  const socialSignals = signals.filter(item => item.kind === 'SOCIAL')
  const emailSignals = signals.filter(item => item.kind === 'EMAIL')

  return {
    signals: dedupeSignals(signals).slice(0, 80),
    phoneCount: phoneSignals.length,
    mobileNumberCount: phoneSignals.filter(item => item.phoneKind === 'MOBILE').length,
    detectedMobileRegions: Array.from(new Set(phoneSignals.map(item => item.region).filter(Boolean))),
    messengerIdCount: messengerSignals.length,
    detectedMessengers: Array.from(new Set(messengerSignals.map(item => item.platform).filter(Boolean))),
    socialProfileCount: socialSignals.length,
    emailCount: emailSignals.length,
    urlCount: domains.urls.length,
    detectedDomains: domains.domains,
    leadGenerationSignals,
    obfuscationDetected: hadObfuscation || MESSENGER_RULES.some(rule => containsSpacedPlatformLabel(normalized, rule.platform)),
  }
}
