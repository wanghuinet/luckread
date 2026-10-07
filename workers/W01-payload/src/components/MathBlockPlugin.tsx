'use client'

import { useState } from 'react'
import { createArticleBlock } from '../lib/article-document.js'
import type { ArticleEditorPluginContext } from './ArticleEditorPlugin.js'

function MathToolbar({ disabled, addBlock }: ArticleEditorPluginContext) {
  return (
    <button
      className="lr-editor-plugin-button"
      disabled={disabled}
      onClick={() => addBlock('math')}
      title="添加 LaTeX 公式"
      type="button"
    >
      公式
    </button>
  )
}

function MathPanel({ disabled, value, updateDocument }: ArticleEditorPluginContext) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        className="lr-editor-plugin-button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        type="button"
      >
        公式模板
      </button>
    )
  }

  const examples = [
    ['二次公式', 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}'],
    ['积分', '\\int_0^1 x^2 \\, dx = \\frac{1}{3}'],
    ['矩阵', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}'],
  ] as const

  return (
    <div className="lr-editor-math-panel lr-editor-plugin-panel">
      <div className="lr-editor-plugin-panel-head">
        <div>
          <strong>LaTeX 公式</strong>
          <span>公式作为独立区块保存，发布时由 KaTeX 渲染。</span>
        </div>
        <button
          aria-label="关闭公式模板"
          className="lr-editor-plugin-close"
          onClick={() => setOpen(false)}
          type="button"
        >
          ×
        </button>
      </div>
      <div className="lr-editor-math-examples">
        {examples.map(([label, expression]) => (
          <button
            key={label}
            disabled={disabled}
            onClick={() => {
              const block = createArticleBlock('math', expression)
              const next = value.blocks.length
                ? { ...value, blocks: [...value.blocks, block] }
                : { ...value, blocks: [block] }
              updateDocument(next)
              setOpen(false)
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

export const mathBlockPlugin = {
  id: 'content.math-block',
  label: 'LaTeX 公式',
  order: 125,
  Toolbar: MathToolbar,
  Panel: MathPanel,
}
