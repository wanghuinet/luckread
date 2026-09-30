import { describe, expect, it } from 'vitest'

import { preflightContent } from './publish-preflight.js'

describe('W03 publish preflight', () => {
  const base = {
    contentType: 'article' as const,
    title: '我实测一周后得出的内容创作结论',
    body: '我实测了一个完整周期，并记录了过程、数据和结果。我把操作步骤逐项记录下来，并在第二天重新核验样本，确认数据没有因为操作差异而失真。测试过程中我记录了设备版本、时间、地点和关键配置，也把异常情况单独写进笔记。最后我把优点、缺点、适用范围和限制条件逐项整理，并给出自己的结论。文章还补充了一个真实案例，说明在什么情况下结果会明显变化，以及读者复现时最容易踩到的坑。整个过程都由我亲自执行、复核和修改。',
    aiMode: 'outline' as const,
    humanContribution: 'substantial' as const,
    mediaRefs: [],
  }

  it('does not treat a normal Chinese title as title noise', () => {
    const result = preflightContent(base)
    expect(result.findings.some(item => item.id === 'SEO-TITLE-NOISE')).toBe(false)
  })

  it('passes a human-finished, structured article without obvious spam signals', () => {
    const result = preflightContent(base)
    expect(result.verdict).toBe('PASS')
    expect(result.seoReadiness).toBe('READY')
    expect(result.positiveSignals.some(value => value.includes('第一手'))).toBe(true)
  })

  it('blocks full-AI article generation under LuckRead creator policy', () => {
    const result = preflightContent({ ...base, aiMode: 'full' })
    expect(result.verdict).toBe('RED')
    expect(result.findings.some(item => item.id === 'AI-FULL-AUTO')).toBe(true)
  })

  it('blocks articles without substantial creator contribution', () => {
    const result = preflightContent({ ...base, humanContribution: 'light' })
    expect(result.verdict).toBe('RED')
    expect(result.findings.some(item => item.id === 'AI-HUMAN-CONTRIBUTION')).toBe(true)
  })

  it('blocks combined contact and promotion signals', () => {
    const result = preflightContent({
      ...base,
      body: '欢迎扫码添加微信购买课程，联系电话 13812345678，更多信息 https://example.com',
    })
    expect(result.verdict).toBe('RED')
    expect(result.findings.some(item => item.category === 'CONTACT')).toBe(true)
    expect(result.findings.some(item => item.category === 'LINK')).toBe(true)
  })

  it('warns about keyword stuffing instead of treating every keyword as spam', () => {
    const result = preflightContent({
      ...base,
      title: 'AI 创作指南',
      body: Array.from({ length: 9 }, () => 'AI 创作指南帮助你理解 AI 创作指南的核心方法。').join('\n'),
    })
    expect(result.findings.some(item => item.id === 'SEO-KEYWORD-STUFFING')).toBe(true)
  })

  it('blocks hidden HTML/script or CSS injection signals', () => {
    const result = preflightContent({
      ...base,
      body: '正常内容<script>alert(1)</script><span style="display:none">关键词</span>',
    })
    expect(result.verdict).toBe('RED')
    expect(result.findings.some(item => item.id === 'SEC-HTML-HIDDEN')).toBe(true)
  })

  it('recognizes QR/contact hints but avoids claiming pixel-level image OCR', () => {
    const result = preflightContent({
      ...base,
      body: '请扫码联系我了解更多',
      mediaRefs: ['https://cdn.example.com/wechat-qrcode.png'],
    })
    expect(result.findings.some(item => item.id === 'MEDIA-QR')).toBe(true)
  })


  it('detects phone candidates across Americas, Europe, East Asia and Southeast Asia without claiming current carrier ownership', () => {
    const result = preflightContent({
      ...base,
      body: [
        'China +86 138 1234 5678',
        'United States +1 202-555-0123',
        'United Kingdom +44 7700 900123',
        'France +33 6 12 34 56 78',
        'Germany +49 151 23456789',
        'Italy +39 312 345 6789',
        'Spain +34 612 345 678',
        'Japan +81 90 1234 5678',
        'South Korea +82 10 1234 5678',
        'India +91 98765 43210',
        'Australia +61 412 345 678',
        'Singapore +65 9123 4567',
        'Malaysia +60 12 345 6789',
        'Indonesia +62 812 3456 7890',
        'Thailand +66 81 234 5678',
        'Philippines +63 917 123 4567',
        'Vietnam +84 912 345 678',
      ].join('\n'),
    })
    expect(result.analyzed.phoneCount).toBeGreaterThanOrEqual(17)
    expect(result.analyzed.mobileNumberCount).toBeGreaterThanOrEqual(16)
    expect(result.analyzed.detectedMobileRegions).toEqual(expect.arrayContaining([
      'China (+86)',
      'United States/Canada (NANP)',
      'United Kingdom (+44)',
      'France (+33)',
      'Japan (+81)',
      'South Korea (+82)',
      'Singapore (+65)',
      'Malaysia (+60)',
      'Indonesia (+62)',
      'Thailand (+66)',
      'Philippines (+63)',
      'Vietnam (+84)',
    ]))
  })

  it('does not classify a bare numeric identifier as a phone without context or formatting', () => {
    const result = preflightContent({
      ...base,
      body: '版本号 9876543210，订单流水 123456789012。',
    })
    expect(result.analyzed.phoneCount).toBe(0)
    expect(result.findings.some(item => item.id === 'CONTACT-PHONE')).toBe(false)
  })

  it('detects expanded social, regional and enterprise contact channels', () => {
    const result = preflightContent({
      ...base,
      body: [
        'Instagram: https://instagram.com/luckread',
        'Snapchat username: luckread_snap',
        'Zalo ID: luckread_zalo',
        'Microsoft Teams invite: https://teams.microsoft.com/l/chat/0/0?users=test@example.com',
        'Slack invite: https://join.slack.com/t/luckread/shared_invite/test',
        'Google Chat: https://chat.google.com/room/test',
        '企业微信: work_contact_123',
        '钉钉 ID: luckread_ding',
        '飞书: https://feishu.cn/test',
        'Matrix: https://matrix.to/#/@luckread:example.org',
        'XMPP JID: user@example.org',
        'SimpleX: https://simplex.chat/contact/#test',
      ].join('\n'),
    })
    expect(result.analyzed.socialProfileCount).toBeGreaterThanOrEqual(2)
    expect(result.analyzed.messengerIdCount).toBeGreaterThanOrEqual(7)
    expect(result.analyzed.detectedMessengers).toEqual(expect.arrayContaining([
      'Zalo',
      'Microsoft Teams',
      'Slack',
      'Google Chat',
      'WeCom',
      'DingTalk',
      'Feishu/Lark',
      'Matrix/Element',
      'XMPP',
      'SimpleX',
    ]))
  })

  it('detects obfuscated platform labels while avoiding plain platform mentions', () => {
    const result = preflightContent({
      ...base,
      body: 'W e C h a t ID: luckread_news；本文只是介绍微信的发展历史。',
    })
    expect(result.analyzed.messengerIdCount).toBeGreaterThanOrEqual(1)
    expect(result.analyzed.detectedMessengers).toContain('WeChat')
    expect(result.positiveSignals.some(value => value.includes('Unicode'))).toBe(true)
  })

  it('detects national mobile numbers when explicit phone context exists', () => {
    const result = preflightContent({
      ...base,
      body: '联系电话 13812345678，韩国手机 01012345678，日本手机 09012345678。',
    })
    expect(result.analyzed.phoneCount).toBeGreaterThanOrEqual(3)
    expect(result.analyzed.mobileNumberCount).toBeGreaterThanOrEqual(3)
  })

  it('detects email addresses as contact signals', () => {
    const result = preflightContent({
      ...base,
      body: '联系邮箱 editor@luckread.com，购买课程请邮件联系。',
    })
    expect(result.analyzed.emailCount).toBe(1)
    expect(result.findings.some(item => item.id === 'CONTACT-EMAIL')).toBe(true)
  })

  it('detects representative top-tier messaging IDs and invite links', () => {
    const result = preflightContent({
      ...base,
      body: [
        'WhatsApp: https://wa.me/14155550123',
        'Telegram: @luckread_news',
        'Messenger: https://m.me/luckread.page',
        'WeChat ID: luckread_news',
        'LINE ID: luckread_line',
        'QQ号: 123456789',
        'Signal: https://signal.me/#p/+14155550123',
        'Viber: https://vb.me/luckread',
        'KakaoTalk: https://open.kakao.com/o/luckread',
        'Discord: https://discord.gg/luckread',
      ].join('\n'),
    })
    expect(result.analyzed.messengerIdCount).toBe(10)
    expect(result.analyzed.detectedMessengers).toEqual(expect.arrayContaining([
      'WhatsApp',
      'Telegram',
      'Facebook Messenger',
      'WeChat',
      'LINE',
      'QQ',
      'Signal',
      'Viber',
      'KakaoTalk',
      'Discord',
    ]))
    expect(result.findings.some(item => item.id === 'CONTACT-MESSENGER-ID')).toBe(true)
  })
})
