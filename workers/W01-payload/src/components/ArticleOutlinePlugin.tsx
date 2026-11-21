'use client'

import { useMemo } from 'react'
import type { ArticleBlock } from '../lib/article-document.js'
import type { ArticleEditorPluginContext } from './ArticleEditorPlugin.js'

export const articleBlockDomId = (id: string): string =>
  'lr-article-block-' + encodeURIComponent(id)

type OutlineItem = {
  id: string
  level: 2 | 3
  text: string
}

function ArticleOutlinePanel({ disabled, value }: ArticleEditorPluginContext) {
  const items = useMemo<OutlineItem[]>(
    () =>
      value.blocks
        .filter(
          (block): block is ArticleBlock & { level?: 2 | 3 } =>
            block.type === 'heading' && Boolean(block.text.trim()),
        )
        .map((block) => ({
          id: block.id,
          level: block.level === 3 ? 3 : 2,
          text: block.text.trim(),
        })),
    [value.blocks],
  )

  function navigate(item: OutlineItem) {
    const target = window.document.getElementById(articleBlockDomId(item.id))
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (target instanceof HTMLElement) {
      target.focus({ preventScroll: true })
    }
  }

  if (!items.length) {
    return (
      <section className="lr-editor-outline lr-editor-plugin-panel" aria-label="文章大纲">
        <div className="lr-editor-plugin-panel-head">
          <div>
            <strong>文章大纲</strong>
            <span>添加 H2/H3 标题后会自动生成导航。</span>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="lr-editor-outline lr-editor-plugin-panel" aria-label="文章大纲">
      <div className="lr-editor-plugin-panel-head">
        <div>
          <strong>文章大纲</strong>
          <span>{items.length} 个标题，点击即可定位。</span>
        </div>
      </div>
      <nav aria-label="文章标题导航">
        <ol className="lr-editor-outline-list">
          {items.map((item, index) => (
            <li
              className={item.level === 3 ? 'lr-editor-outline-item is-h3' : 'lr-editor-outline-item'}
              key={item.id}
            >
              <button
                aria-label={'定位到标题：' + item.text}
                disabled={disabled}
                onClick={() => navigate(item)}
                type="button"
              >
                <span>{index + 1}</span>
                <strong>{item.text}</strong>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </section>
  )
}

export const articleOutlinePlugin = {
  id: 'content.outline',
  label: '文章大纲',
  order: 130,
  Panel: ArticleOutlinePanel,
}
