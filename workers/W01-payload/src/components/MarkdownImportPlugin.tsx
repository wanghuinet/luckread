'use client'

import { useState } from 'react'
import type {
  ArticleEditorPlugin,
  ArticleEditorPluginContext,
} from './ArticleEditorPlugin.js'
import {
  markdownToArticleDocument,
  type MarkdownImportResult,
} from '../lib/markdown-to-article-document.js'

function MarkdownImportPanel({
  value,
  disabled,
  updateDocument,
}: ArticleEditorPluginContext) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [source, setSource] = useState('')
  const [result, setResult] = useState<MarkdownImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function preview() {
    try {
      const next = markdownToArticleDocument(source)
      setResult(next)
      setError(null)
    } catch (cause) {
      setResult(null)
      setError(
        cause instanceof Error && cause.message === 'ARTICLE_MARKDOWN_TOO_LARGE'
          ? 'Markdown 内容超过 100,000 字符限制。'
          : 'Markdown 解析失败，请检查输入内容。',
      )
    }
  }

  function apply() {
    if (!result || result.unsupported.length) return

    if (mode === 'append' && value.blocks.length + result.document.blocks.length > 200) {
      setError('追加后正文区块将超过 200 个，本次不会导入。')
      return
    }

    const next = mode === 'replace'
      ? result.document
      : {
          ...value,
          blocks: [...value.blocks, ...result.document.blocks].slice(0, 200),
        }

    updateDocument(next)
    setOpen(false)
    setSource('')
    setResult(null)
    setError(null)
  }

  return (
    <>
      <button
        className="lr-editor-plugin-button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        Markdown
      </button>

      {open ? (
        <div className="lr-editor-plugin-panel lr-editor-markdown-panel">
          <div className="lr-editor-plugin-panel-head">
            <div>
              <strong>Markdown 导入</strong>
              <span>
                使用开源 marked 解析，导入后仍保存为标准 ArticleDocument。
              </span>
            </div>
            <button
              aria-label="关闭 Markdown 导入"
              className="lr-editor-plugin-close"
              onClick={() => setOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>

          <div
            className="lr-editor-markdown-mode"
            role="radiogroup"
            aria-label="导入方式"
          >
            <label>
              <input
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
                type="radio"
              />
              替换当前正文
            </label>
            <label>
              <input
                checked={mode === 'append'}
                onChange={() => setMode('append')}
                type="radio"
              />
              追加到正文末尾
            </label>
          </div>

          <textarea
            aria-label="Markdown 内容"
            className="lr-editor-markdown-input"
            disabled={disabled}
            onChange={(event) => {
              setSource(event.target.value)
              setResult(null)
              setError(null)
            }}
            placeholder="# 标题\n\n正文 **加粗**\n\n> 引用\n\n- 列表\n- 第二项\n\n---"
            rows={12}
            value={source}
          />

          <div className="lr-editor-plugin-actions">
            <button
              className="secondary"
              disabled={disabled || !source.trim()}
              onClick={preview}
              type="button"
            >
              解析预览
            </button>
            <button
              className="primary"
              disabled={disabled || !result || result.unsupported.length > 0}
              onClick={apply}
              type="button"
            >
              导入正文
            </button>
          </div>

          {error ? (
            <div className="lr-editor-plugin-error" role="alert">
              {error}
            </div>
          ) : null}

          {result ? (
            <div className="lr-editor-markdown-result" aria-live="polite">
              <div>
                <strong>解析结果</strong>
                <span>{result.importedBlocks} 个正文区块</span>
              </div>
              {result.unsupported.length ? (
                <p>
                  当前编辑器暂不接收：{result.unsupported.join('、')}。
                  本次不会导入，避免静默丢失内容。
                </p>
              ) : (
                <p>检查通过，可以安全写入标准 ArticleDocument。</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

export const markdownImportPlugin: ArticleEditorPlugin = {
  id: 'content.markdown-import',
  label: 'Markdown 导入',
  order: 100,
  Panel: MarkdownImportPanel,
}
