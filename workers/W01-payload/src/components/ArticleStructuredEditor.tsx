'use client'

import { useMemo } from 'react'
import {
  ARTICLE_MAX_BLOCKS,
  ARTICLE_MAX_BLOCK_TEXT,
  type ArticleBlock,
  type ArticleBlockType,
  type ArticleDocument,
  createArticleBlock,
  normalizeArticleDocument,
  plainTextFromArticleDocument,
} from '../lib/article-document.js'

type Props = {
  value: ArticleDocument
  disabled?: boolean
  onChange: (value: ArticleDocument, plainText: string) => void
}

const blockLabels: Record<ArticleBlockType, string> = {
  paragraph: '正文',
  heading: '标题',
  quote: '引用',
  bulletList: '无序列表',
  orderedList: '有序列表',
  divider: '分隔线',
}

const updateBlock = (
  document: ArticleDocument,
  index: number,
  patch: Partial<ArticleBlock>,
): ArticleDocument => ({
  ...document,
  blocks: document.blocks.map((block, blockIndex) =>
    blockIndex === index ? { ...block, ...patch } : block,
  ),
})

export default function ArticleStructuredEditor({ value, disabled = false, onChange }: Props) {
  const characterCount = useMemo(() => plainTextFromArticleDocument(value).length, [value])

  function emit(next: ArticleDocument) {
    const normalized = normalizeArticleDocument(next)
    onChange(normalized, plainTextFromArticleDocument(normalized))
  }

  function addBlock(type: ArticleBlockType) {
    if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return
    emit({
      ...value,
      blocks: [...value.blocks, createArticleBlock(type)],
    })
  }

  function removeBlock(index: number) {
    if (value.blocks.length === 1) return
    emit({
      ...value,
      blocks: value.blocks.filter((_, blockIndex) => blockIndex !== index),
    })
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= value.blocks.length) return
    const blocks = [...value.blocks]
    ;[blocks[index], blocks[target]] = [blocks[target], blocks[index]]
    emit({ ...value, blocks })
  }

  return (
    <section className="lr-article-editor" aria-label="文章结构化正文编辑器">
      <div className="lr-article-editor-toolbar">
        <div>
          <strong>结构化正文</strong>
          <span>{value.blocks.length} 个区块 · {characterCount} 字</span>
        </div>
        <div className="lr-article-editor-tools" role="toolbar" aria-label="添加正文区块">
          {([
            ['paragraph', '正文'],
            ['heading', '标题'],
            ['quote', '引用'],
            ['bulletList', '无序列表'],
            ['orderedList', '有序列表'],
            ['divider', '分隔线'],
          ] as const).map(([type, label]) => (
            <button
              key={type}
              disabled={disabled || value.blocks.length >= ARTICLE_MAX_BLOCKS}
              onClick={() => addBlock(type)}
              title={'添加' + label}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="lr-article-editor-hint">
        每个区块可以独立调整顺序和类型。列表区块使用换行分隔条目；正文内容最终会以版本化 JSON 资产保存，发布前检查仍使用纯文本抽取结果。
      </div>

      <div className="lr-article-blocks">
        {value.blocks.map((block, index) => (
          <article className={'lr-article-block lr-article-block-' + block.type} key={block.id}>
            <div className="lr-article-block-head">
              <span>{blockLabels[block.type]}</span>
              <div>
                <button
                  aria-label="上移区块"
                  disabled={disabled || index === 0}
                  onClick={() => moveBlock(index, -1)}
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label="下移区块"
                  disabled={disabled || index === value.blocks.length - 1}
                  onClick={() => moveBlock(index, 1)}
                  type="button"
                >
                  ↓
                </button>
                <button
                  aria-label="删除区块"
                  disabled={disabled || value.blocks.length === 1}
                  onClick={() => removeBlock(index)}
                  type="button"
                >
                  删除
                </button>
              </div>
            </div>

            {block.type === 'divider' ? (
              <hr aria-label="内容分隔线" />
            ) : (
              <textarea
                aria-label={blockLabels[block.type]}
                disabled={disabled}
                maxLength={ARTICLE_MAX_BLOCK_TEXT}
                onChange={(event) => {
                  const next = updateBlock(value, index, {
                    text: event.target.value.slice(0, ARTICLE_MAX_BLOCK_TEXT),
                  })
                  emit(next)
                }}
                placeholder={
                  block.type === 'heading' ? '输入小标题…'
                    : block.type === 'quote' ? '输入引用内容…'
                      : block.type === 'bulletList' || block.type === 'orderedList'
                        ? '每行一个列表条目…'
                        : '写下这一段内容…'
                }
                rows={block.type === 'heading' ? 2 : block.type === 'quote' ? 4 : 5}
                value={block.text}
              />
            )}

            {block.type === 'heading' ? (
              <label className="lr-article-heading-level">
                <span>层级</span>
                <select
                  aria-label="标题层级"
                  disabled={disabled}
                  onChange={(event) => emit(updateBlock(value, index, { level: event.target.value === '3' ? 3 : 2 }))}
                  value={block.level ?? 2}
                >
                  <option value="2">H2</option>
                  <option value="3">H3</option>
                </select>
              </label>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
