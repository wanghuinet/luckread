'use client'

import { useMemo, useState } from 'react'
import type { ArticleEditorPluginContext } from './ArticleEditorPlugin.js'

const blockDomId = (id: string): string => 'lr-article-block-' + encodeURIComponent(id)

function ArticleOutlinePanel({ value, disabled }: ArticleEditorPluginContext) {
  const [open, setOpen] = useState(false)
  const headings = useMemo(
    () => value.blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.type === 'heading' && Boolean(block.text.trim())),
    [value],
  )

  if (!open) {
    return (
      <button
        className="lr-editor-plugin-button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="查看文章目录"
        type="button"
      >
        目录
      </button>
    )
  }

  return (
    <aside className="lr-editor-outline-panel lr-editor-plugin-panel" aria-label="文章目录">
      <div className="lr-editor-plugin-panel-head">
        <div>
          <strong>文章目录</strong>
          <span>{headings.length ? '点击标题跳转到对应区块。' : '当前文章还没有标题区块。'}</span>
        </div>
        <button
          aria-label="关闭文章目录"
          className="lr-editor-plugin-close"
          onClick={() => setOpen(false)}
          type="button"
        >
          ×
        </button>
      </div>

      {headings.length ? (
        <nav className="lr-editor-outline-list" aria-label="文章标题导航">
          {headings.map(({ block, index }) => (
            <button
              className={block.level === 3 ? 'lr-editor-outline-item is-level-3' : 'lr-editor-outline-item'}
              key={block.id}
              type="button"
              onClick={() => {
                const target = window.document.getElementById(blockDomId(block.id))
                target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
            >
              <span>{index + 1}</span>
              <strong>{block.text}</strong>
            </button>
          ))}
        </nav>
      ) : null}
    </aside>
  )
}

export const articleOutlinePlugin = {
  id: 'content.outline',
  label: '文章目录',
  order: 150,
  Panel: ArticleOutlinePanel,
}
