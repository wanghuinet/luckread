'use client'

import { useMemo, useState } from 'react'
import type { ArticleEditorPluginContext } from './ArticleEditorPlugin.js'

function WriterStatsPanel({ value, plainText, disabled }: ArticleEditorPluginContext) {
  const [open, setOpen] = useState(false)
  const stats = useMemo(() => {
    const characters = Array.from(plainText).length
    const lines = plainText ? plainText.split(/\r?\n/).length : 0
    const headings = value.blocks.filter((block) => block.type === 'heading').length
    const code = value.blocks.filter((block) => block.type === 'code').length
    const tables = value.blocks.filter((block) => block.type === 'table').length
    const math = value.blocks.filter((block) => block.type === 'math').length
    const media = value.blocks.filter((block) => block.type === 'image' || block.type === 'gallery').length

    return { characters, lines, headings, code, tables, math, media }
  }, [plainText, value])

  if (!open) {
    return (
      <button
        className="lr-editor-plugin-button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="查看文章统计"
        type="button"
      >
        统计
      </button>
    )
  }

  return (
    <aside className="lr-editor-writer-stats lr-editor-plugin-panel" aria-label="文章统计">
      <div className="lr-editor-plugin-panel-head">
        <div>
          <strong>写作统计</strong>
          <span>统计来自当前编辑器状态，不产生额外网络请求。</span>
        </div>
        <button
          aria-label="关闭写作统计"
          className="lr-editor-plugin-close"
          onClick={() => setOpen(false)}
          type="button"
        >
          ×
        </button>
      </div>
      <div className="lr-editor-writer-stats-grid">
        <strong><span>字符数</span>{stats.characters}</strong>
        <strong><span>正文行数</span>{stats.lines}</strong>
        <strong><span>标题</span>{stats.headings}</strong>
        <strong><span>代码块</span>{stats.code}</strong>
        <strong><span>表格</span>{stats.tables}</strong>
        <strong><span>公式</span>{stats.math}</strong>
        <strong><span>媒体区块</span>{stats.media}</strong>
        <strong><span>总区块</span>{value.blocks.length}</strong>
      </div>
    </aside>
  )
}

function CopyPlainTextButton({ plainText, disabled }: ArticleEditorPluginContext) {
  const [message, setMessage] = useState('')

  return (
    <button
      className="lr-editor-plugin-button"
      disabled={disabled}
      onClick={async () => {
        setMessage('')
        try {
          await navigator.clipboard.writeText(plainText)
          setMessage('已复制')
        } catch {
          setMessage('复制失败')
        }
        window.setTimeout(() => setMessage(''), 1400)
      }}
      title="复制文章纯文本"
      type="button"
    >
      {message || '复制纯文本'}
    </button>
  )
}

export const writerStatsPlugin = {
  id: 'content.writer-stats',
  label: '写作统计',
  order: 160,
  Panel: WriterStatsPanel,
}

export const copyPlainTextPlugin = {
  id: 'content.copy-plain-text',
  label: '复制纯文本',
  order: 170,
  Toolbar: CopyPlainTextButton,
}
