'use client'

import { useState } from 'react'
import type {
  ArticleEditorPlugin,
  ArticleEditorPluginContext,
} from './ArticleEditorPlugin.js'
import { articleDocumentToMarkdown } from '../lib/article-document-to-markdown.js'

function MarkdownExportPanel({
  value,
  disabled,
}: ArticleEditorPluginContext) {
  const [open, setOpen] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [copied, setCopied] = useState(false)

  function generate() {
    setMarkdown(articleDocumentToMarkdown(value))
    setCopied(false)
    setOpen(true)
  }

  async function copy() {
    if (!markdown || typeof navigator === 'undefined' || !navigator.clipboard) return
    await navigator.clipboard.writeText(markdown)
    setCopied(true)
  }

  return (
    <div className="lr-editor-markdown-export">
      <div className="lr-editor-plugin-actions">
        <button
          className="secondary"
          disabled={disabled}
          onClick={generate}
          type="button"
        >
          导出 Markdown
        </button>
        {open ? (
          <button
            className="primary"
            disabled={disabled || !markdown}
            onClick={() => void copy()}
            type="button"
          >
            {copied ? '已复制' : '复制 Markdown'}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="lr-editor-plugin-panel">
          <div className="lr-editor-plugin-panel-head">
            <div>
              <strong>Markdown 导出</strong>
              <span>由标准 ArticleDocument 生成，不直接读取编辑器 DOM。</span>
            </div>
            <button
              aria-label="关闭 Markdown 导出"
              className="lr-editor-plugin-close"
              onClick={() => setOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>
          <textarea
            aria-label="Markdown 导出内容"
            className="lr-editor-markdown-input"
            readOnly
            rows={16}
            value={markdown}
          />
        </div>
      ) : null}
    </div>
  )
}

export const markdownExportPlugin: ArticleEditorPlugin = {
  id: 'content.markdown-export',
  label: 'Markdown 导出',
  order: 130,
  Panel: MarkdownExportPanel,
}
