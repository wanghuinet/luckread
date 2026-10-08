'use client'

import { useMemo, useState } from 'react'
import type { ArticleEditorPluginContext } from './ArticleEditorPlugin.js'

export type WriterStats = {
  characters: number
  words: number
  headings: number
  lists: number
  media: number
}

export const getWriterStats = (
  plainText: string,
  value: ArticleEditorPluginContext['value'],
): WriterStats => ({
  characters: Array.from(plainText).length,
  words: plainText.trim() ? plainText.trim().split(/\s+/u).length : 0,
  headings: value.blocks.filter((block) => block.type === 'heading').length,
  lists: value.blocks.filter(
    (block) => block.type === 'bulletList' || block.type === 'orderedList',
  ).length,
  media: value.blocks.filter(
    (block) => block.type === 'image' || block.type === 'gallery',
  ).length,
})

function WriterStatsPanel({ plainText, value }: ArticleEditorPluginContext) {
  const stats = useMemo(
    () => getWriterStats(plainText, value),
    [plainText, value],
  )

  return (
    <section className="lr-editor-writer-stats lr-editor-plugin-panel" aria-label="写作统计">
      <div className="lr-editor-plugin-panel-head">
        <div>
          <strong>写作统计</strong>
          <span>统计当前文章，不发送正文内容。</span>
        </div>
      </div>
      <dl className="lr-editor-writer-stats-grid">
        <div><dt>字符</dt><dd>{stats.characters}</dd></div>
        <div><dt>空白分词</dt><dd>{stats.words}</dd></div>
        <div><dt>标题</dt><dd>{stats.headings}</dd></div>
        <div><dt>列表</dt><dd>{stats.lists}</dd></div>
        <div><dt>媒体区块</dt><dd>{stats.media}</dd></div>
      </dl>
    </section>
  )
}

function CopyPlainTextToolbar({ disabled, plainText }: ArticleEditorPluginContext) {
  const [message, setMessage] = useState('')

  async function copy() {
    setMessage('')
    try {
      await navigator.clipboard.writeText(plainText)
      setMessage('已复制纯文本。')
    } catch {
      setMessage('复制失败，请检查浏览器剪贴板权限。')
    }
  }

  return (
    <span className="lr-editor-copy-plain-text">
      <button
        className="lr-editor-plugin-button"
        disabled={disabled || !plainText}
        onClick={() => void copy()}
        title="复制当前文章纯文本"
        type="button"
      >
        复制纯文本
      </button>
      {message ? <span aria-live="polite" role="status">{message}</span> : null}
    </span>
  )
}

export const writerStatsPlugin = {
  id: 'content.writer-stats',
  label: '写作统计',
  order: 120,
  Panel: WriterStatsPanel,
}

export const copyPlainTextPlugin = {
  id: 'content.copy-plain-text',
  label: '复制纯文本',
  order: 110,
  Toolbar: CopyPlainTextToolbar,
}
