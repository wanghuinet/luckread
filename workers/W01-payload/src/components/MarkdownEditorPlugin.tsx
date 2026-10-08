'use client'

import { useState } from 'react'
import {
  hasArticleDocumentContent,
  type ArticleDocument,
} from '../lib/article-document.js'
import { markdownToArticleDocument } from '../lib/markdown-to-article-document.js'
import { articleDocumentToMarkdown } from '../lib/article-document-to-markdown.js'
import type { ArticleEditorPluginContext } from './ArticleEditorPlugin.js'

function MarkdownPanel({ disabled, value, updateDocument }: ArticleEditorPluginContext) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const [message, setMessage] = useState('')

  function importMarkdown() {
    setMessage('')
    let result: ReturnType<typeof markdownToArticleDocument>
    try {
      result = markdownToArticleDocument(raw)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setMessage(
        code === 'MARKDOWN_TOO_MANY_BLOCKS'
          ? 'Markdown 导入结果超过 200 个区块，请拆分文档后再导入。'
          : code === 'MARKDOWN_BLOCK_TOO_LARGE'
            ? 'Markdown 导入存在超过单区块长度限制的内容，请拆分段落后再导入。'
            : 'Markdown 导入内容无法在当前文章结构中安全表示，未执行导入。',
      )
      return
    }

    if (result.unsupported.length) {
      setMessage(
        '当前 Markdown 包含暂不支持的语义：' +
        result.unsupported.join('、') +
        '。为避免静默丢失内容，本次未执行导入。',
      )
      return
    }

    if (hasArticleDocumentContent(value)) {
      const confirmed = window.confirm('导入 Markdown 将替换当前文章正文结构。当前修改不会被保留，确定继续吗？')
      if (!confirmed) return
    }

    updateDocument(result.document)
    setRaw('')
    setMessage('Markdown 导入完成。')
  }

  function exportMarkdown() {
    setMessage('')
    try {
      const markdown = articleDocumentToMarkdown(value)
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = 'luckread-article.md'
      window.document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setMessage('Markdown 已导出。')
    } catch {
      setMessage('Markdown 导出失败。')
    }
  }

  if (!open) {
    return (
      <span className="lr-editor-markdown-actions">
        <button
          className="lr-editor-plugin-button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          title="导入或导出 Markdown"
          type="button"
        >
          Markdown
        </button>
        <button
          className="lr-editor-plugin-button"
          disabled={disabled || !hasArticleDocumentContent(value)}
          onClick={exportMarkdown}
          title="导出当前文章为 Markdown"
          type="button"
        >
          导出 MD
        </button>
      </span>
    )
  }

  return (
    <section className="lr-editor-markdown lr-editor-plugin-panel" aria-label="Markdown 导入和导出">
      <div className="lr-editor-plugin-panel-head">
        <div>
          <strong>Markdown</strong>
          <span>仅转换当前 ArticleDocument 支持的结构；不支持的语义会拒绝导入，避免静默丢失。</span>
        </div>
        <button
          aria-label="关闭 Markdown 工具"
          className="lr-editor-plugin-close"
          onClick={() => setOpen(false)}
          type="button"
        >
          ×
        </button>
      </div>

      <textarea
        aria-label="Markdown 内容"
        className="lr-editor-markdown-input"
        disabled={disabled}
        onChange={(event) => setRaw(event.target.value)}
        placeholder={'在这里粘贴 Markdown…\n\n支持 H2/H3、段落、引用、列表、分隔线和图片。'}
        rows={12}
        value={raw}
      />

      <div className="lr-editor-plugin-actions">
        <button
          className="primary"
          disabled={disabled || !raw.trim()}
          onClick={importMarkdown}
          type="button"
        >
          导入 Markdown
        </button>
        <button
          className="secondary"
          disabled={disabled || !hasArticleDocumentContent(value)}
          onClick={exportMarkdown}
          type="button"
        >
          导出 Markdown
        </button>
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => {
            setRaw('')
            setMessage('')
          }}
          type="button"
        >
          清空
        </button>
      </div>

      {message ? <div className="lr-editor-plugin-status" role="status">{message}</div> : null}
    </section>
  )
}

export const markdownImportPlugin = {
  id: 'content.markdown-import',
  label: 'Markdown 导入',
  order: 150,
  Panel: MarkdownPanel,
}

export const markdownExportPlugin = {
  id: 'content.markdown-export',
  label: 'Markdown 导出',
  order: 151,
  Toolbar: MarkdownPanel,
}
