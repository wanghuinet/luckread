'use client'

import { useMemo, useState } from 'react'
import type { ArticleEditorPlugin, ArticleEditorPluginContext, EditorMediaAsset } from './ArticleEditorPlugin.js'
import {
  ARTICLE_MAX_BLOCKS,
  ARTICLE_CODE_LANGUAGES,
  ARTICLE_MAX_BLOCK_TEXT,
  ARTICLE_TABLE_MAX_COLUMNS,
  ARTICLE_TABLE_MAX_ROWS,
  ARTICLE_TABLE_MAX_CELL_TEXT,
  type ArticleBlock,
  type ArticleBlockType,
  type ArticleDocument,
  createArticleBlock,
  createArticleMediaBlock,
  createArticleTableBlock,
  normalizeArticleDocument,
  plainTextFromArticleDocument,
} from '../lib/article-document.js'

type Props = {
  value: ArticleDocument
  disabled?: boolean
  mediaAssets?: EditorMediaAsset[]
  onChange: (value: ArticleDocument, plainText: string) => void
  plugins?: readonly ArticleEditorPlugin[]
}

const blockLabels: Record<ArticleBlockType, string> = {
  paragraph: '正文',
  heading: '标题',
  quote: '引用',
  bulletList: '无序列表',
  orderedList: '有序列表',
  divider: '分隔线',
  image: '图片',
  gallery: '图库',
  code: '代码',
  table: '表格',
  math: '公式',
}

const blockDomId = (id: string): string => 'lr-article-block-' + encodeURIComponent(id)

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

export default function ArticleStructuredEditor({ value, disabled = false, mediaAssets = [], onChange, plugins = [] }: Props) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const imageAssets = useMemo(
    () => mediaAssets.filter((asset) => asset.mimeType.startsWith('image/')),
    [mediaAssets],
  )
  const characterCount = useMemo(() => Array.from(plainTextFromArticleDocument(value)).length, [value])

  function emit(next: ArticleDocument) {
    const normalized = normalizeArticleDocument(next)
    onChange(normalized, plainTextFromArticleDocument(normalized))
  }

  function addBlock(type: ArticleBlockType) {
    if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return
    if (type === 'table') {
      emit({
        ...value,
        blocks: [...value.blocks, createArticleTableBlock()],
      })
      return
    }
    if (type === 'image' || type === 'gallery') {
      const refs = mediaAssets.map((asset) => asset.url).filter(Boolean)
      if (type === 'image' && refs.length < 1) return
      if (type === 'gallery' && refs.length < 2) return
      emit({
        ...value,
        blocks: [...value.blocks, createArticleMediaBlock(type, type === 'image' ? refs.slice(0, 1) : refs.slice(0, 12))],
      })
      return
    }
    emit({
      ...value,
      blocks: [...value.blocks, createArticleBlock(type)],
    })
  }

  function insertMedia(type: 'image' | 'gallery', assetUrls?: string[]) {
    if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return
    const refs = (assetUrls ?? mediaAssets.map((asset) => asset.url)).filter(Boolean)
    if (type === 'image' && refs.length < 1) return
    if (type === 'gallery' && refs.length < 2) return
    emit({
      ...value,
      blocks: [...value.blocks, createArticleMediaBlock(type, type === 'image' ? refs.slice(0, 1) : refs.slice(0, 12))],
    })
  }

  function updateTable(index: number, table: NonNullable<ArticleBlock['table']>) {
    if (
      table.headers.length < 1 ||
      table.headers.length > ARTICLE_TABLE_MAX_COLUMNS ||
      table.rows.length > ARTICLE_TABLE_MAX_ROWS ||
      table.rows.some((row) => row.length !== table.headers.length)
    ) return

    emit(updateBlock(value, index, {
      table,
      text: table.rows.map((row) => row.join('\t')).join('\n'),
    }))
  }

  const orderedPlugins = useMemo(() => {
    const seen = new Set<string>()
    return plugins
      .filter((plugin) => {
        const id = plugin.id.trim()
        if (!id || seen.has(id)) return false
        seen.add(id)
        return true
      })
      .slice()
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id))
  }, [plugins])

  const pluginContext: ArticleEditorPluginContext = {
    value,
    disabled,
    plainText: plainTextFromArticleDocument(value),
    mediaAssets,
    updateDocument: emit,
    addBlock,
    insertMedia,
  }

  function duplicateBlock(index: number) {
    if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return
    const source = value.blocks[index]
    if (!source) return
    const clone: ArticleBlock = {
      ...source,
      id: crypto.randomUUID(),
      ...(source.mediaRefs ? { mediaRefs: [...source.mediaRefs] } : {}),
      ...(source.table
        ? {
            table: {
              headers: [...source.table.headers],
              rows: source.table.rows.map((row) => [...row]),
            },
          }
        : {}),
    }
    emit({
      ...value,
      blocks: [
        ...value.blocks.slice(0, index + 1),
        clone,
        ...value.blocks.slice(index + 1),
      ],
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

  function moveBlockTo(index: number, target: number) {
    if (index === target || index < 0 || target < 0 || index >= value.blocks.length || target >= value.blocks.length) {
      return
    }
    const blocks = [...value.blocks]
    const [moved] = blocks.splice(index, 1)
    if (!moved) return
    blocks.splice(target, 0, moved)
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
          {orderedPlugins.map((plugin) => {
            const Toolbar = plugin.Toolbar
            return Toolbar ? <Toolbar key={plugin.id + ':toolbar'} {...pluginContext} /> : null
          })}
        </div>
      </div>

      <div className="lr-article-media-picker" aria-label="插入图片和图库">
        <div className="lr-article-media-picker-head">
          <strong>正文媒体</strong>
          <span>{imageAssets.length ? imageAssets.length + ' 个可插入图片' : '请先上传图片'}</span>
        </div>
        {imageAssets.length ? (
          <div className="lr-article-media-picker-grid">
            {imageAssets.map((asset) => (
              <div className="lr-article-media-picker-item" key={asset.id}>
                <img alt={asset.filename ?? ''} loading="lazy" src={asset.url} />
                <div>
                  <button disabled={disabled} onClick={() => insertMedia('image', [asset.url])} type="button">插入图片</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <button
          className="lr-article-gallery-button"
          disabled={disabled || imageAssets.length < 2}
          onClick={() => insertMedia('gallery', imageAssets.map((asset) => asset.url))}
          type="button"
        >
          插入全部图库（最多 12 个）
        </button>
        {orderedPlugins.map((plugin) => {
          const Panel = plugin.Panel
          return Panel ? <Panel key={plugin.id + ':panel'} {...pluginContext} /> : null
        })}
      </div>

      <div className="lr-article-editor-hint">
        每个区块可以独立调整顺序和类型。列表区块使用换行分隔条目；正文内容最终会以版本化 JSON 资产保存，发布前检查仍使用纯文本抽取结果。
      </div>

      <div className="lr-article-blocks">
        {value.blocks.map((block, index) => (
          <article
            className={
              'lr-article-block lr-article-block-' + block.type +
              (dragOverIndex === index ? ' lr-article-block-drag-over' : '')
            }
            draggable={!disabled}
            id={blockDomId(block.id)}
            key={block.id}
            onDragEnd={() => {
              setDraggingIndex(null)
              setDragOverIndex(null)
            }}
            onDragOver={(event) => {
              if (disabled || draggingIndex === null || draggingIndex === index) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDragOverIndex(index)
            }}
            onDrop={(event) => {
              if (disabled) return
              event.preventDefault()
              const sourceIndex = Number(event.dataTransfer.getData('text/plain'))
              if (Number.isInteger(sourceIndex)) moveBlockTo(sourceIndex, index)
              setDraggingIndex(null)
              setDragOverIndex(null)
            }}
            onDragStart={(event) => {
              if (disabled) {
                event.preventDefault()
                return
              }
              setDraggingIndex(index)
              setDragOverIndex(null)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', String(index))
            }}
          >
            <div className="lr-article-block-head">
              <span>{blockLabels[block.type]}</span>
              <div>
                <span
                  aria-hidden="true"
                  className="lr-article-drag-handle"
                  draggable={!disabled}
                  title="拖动重新排序"
                  onDragEnd={() => {
                    setDraggingIndex(null)
                    setDragOverIndex(null)
                  }}
                  onDragStart={(event) => {
                    if (disabled) {
                      event.preventDefault()
                      return
                    }
                    setDraggingIndex(index)
                    setDragOverIndex(null)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', String(index))
                  }}
                >
                  ⋮⋮
                </span>
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
                  aria-label="复制区块"
                  disabled={disabled || value.blocks.length >= ARTICLE_MAX_BLOCKS}
                  onClick={() => duplicateBlock(index)}
                  type="button"
                >
                  复制
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
            ) : block.type === 'code' ? (
              <div className="lr-article-code-editor">
                <label className="lr-article-code-language">
                  <span>语言</span>
                  <select
                    aria-label="代码语言"
                    disabled={disabled}
                    onChange={(event) => {
                      const language = ARTICLE_CODE_LANGUAGES.includes(
                        event.target.value as typeof ARTICLE_CODE_LANGUAGES[number],
                      )
                        ? event.target.value as typeof ARTICLE_CODE_LANGUAGES[number]
                        : 'plaintext'
                      emit(updateBlock(value, index, { language }))
                    }}
                    value={block.language ?? 'plaintext'}
                  >
                    {ARTICLE_CODE_LANGUAGES.map((language) => (
                      <option key={language} value={language}>{language}</option>
                    ))}
                  </select>
                </label>
                <textarea
                  aria-label="代码内容"
                  disabled={disabled}
                  maxLength={ARTICLE_MAX_BLOCK_TEXT}
                  onChange={(event) => {
                    const next = updateBlock(value, index, {
                      text: event.target.value.slice(0, ARTICLE_MAX_BLOCK_TEXT),
                    })
                    emit(next)
                  }}
                  placeholder="输入代码…"
                  rows={10}
                  value={block.text}
                />
              </div>
            ) : block.type === 'table' ? (
              <div className="lr-article-table-editor">
                <table>
                  <thead>
                    <tr>
                      {block.table?.headers.map((header, columnIndex) => (
                        <th key={block.id + ':head:' + columnIndex}>
                          <input
                            aria-label={'表头第 ' + (columnIndex + 1) + ' 列'}
                            disabled={disabled}
                            maxLength={ARTICLE_TABLE_MAX_CELL_TEXT}
                            onChange={(event) => {
                              const table = block.table
                              if (!table) return
                              const headers = table.headers.map((cell, index) =>
                                index === columnIndex ? event.target.value : cell,
                              )
                              updateTable(index, { ...table, headers })
                            }}
                            value={header}
                          />
                          <button
                            aria-label={'删除第 ' + (columnIndex + 1) + ' 列'}
                            disabled={disabled || !block.table || block.table.headers.length <= 1}
                            onClick={() => {
                              const table = block.table
                              if (!table || table.headers.length <= 1) return
                              updateTable(index, {
                                headers: table.headers.filter((_, currentColumnIndex) => currentColumnIndex !== columnIndex),
                                rows: table.rows.map((row) =>
                                  row.filter((_, currentColumnIndex) => currentColumnIndex !== columnIndex),
                                ),
                              })
                            }}
                            type="button"
                          >
                            删列
                          </button>
                        </th>
                      ))}
                      <th aria-label="表格操作">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.table?.rows.map((row, rowIndex) => (
                      <tr key={block.id + ':row:' + rowIndex}>
                        {row.map((cell, columnIndex) => (
                          <td key={block.id + ':cell:' + rowIndex + ':' + columnIndex}>
                            <input
                              aria-label={'第 ' + (rowIndex + 1) + ' 行第 ' + (columnIndex + 1) + ' 列'}
                              disabled={disabled}
                              maxLength={ARTICLE_TABLE_MAX_CELL_TEXT}
                              onChange={(event) => {
                                const table = block.table
                                if (!table) return
                                const rows = table.rows.map((currentRow, currentRowIndex) =>
                                  currentRowIndex === rowIndex
                                    ? currentRow.map((currentCell, currentColumnIndex) =>
                                        currentColumnIndex === columnIndex ? event.target.value : currentCell,
                                      )
                                    : currentRow,
                                )
                                updateTable(index, { ...table, rows })
                              }}
                              value={cell}
                            />
                          </td>
                        ))}
                        <td className="lr-article-table-row-actions">
                          <button
                            aria-label={'删除第 ' + (rowIndex + 1) + ' 行'}
                            disabled={disabled}
                            onClick={() => {
                              const table = block.table
                              if (!table) return
                              updateTable(index, {
                                headers: [...table.headers],
                                rows: table.rows.filter((_, currentRowIndex) => currentRowIndex !== rowIndex),
                              })
                            }}
                            type="button"
                          >
                            删行
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="lr-article-table-actions">
                  <button
                    disabled={disabled || !block.table || block.table.headers.length >= ARTICLE_TABLE_MAX_COLUMNS}
                    onClick={() => {
                      const table = block.table
                      if (!table || table.headers.length >= ARTICLE_TABLE_MAX_COLUMNS) return
                      updateTable(index, {
                        headers: [...table.headers, '新列'],
                        rows: table.rows.map((row) => [...row, '']),
                      })
                    }}
                    type="button"
                  >
                    加一列
                  </button>
                  <button
                    disabled={disabled || !block.table || block.table.rows.length >= ARTICLE_TABLE_MAX_ROWS}
                    onClick={() => {
                      const table = block.table
                      if (!table || table.rows.length >= ARTICLE_TABLE_MAX_ROWS) return
                      updateTable(index, {
                        headers: [...table.headers],
                        rows: [...table.rows, table.headers.map(() => '')],
                      })
                    }}
                    type="button"
                  >
                    加一行
                  </button>
                </div>
              </div>
            ) : block.type === 'image' || block.type === 'gallery' ? (
              <div className="lr-article-media-block">
                <div className={block.type === 'gallery' ? 'lr-article-gallery-grid' : 'lr-article-image-single'}>
                  {(block.mediaRefs ?? []).map((ref) => (
                    <img alt={block.text || '文章图片'} key={ref} loading="lazy" src={ref} />
                  ))}
                </div>
                <textarea
                  aria-label="媒体说明"
                  disabled={disabled}
                  maxLength={ARTICLE_MAX_BLOCK_TEXT}
                  onChange={(event) => emit(updateBlock(value, index, { text: event.target.value.slice(0, ARTICLE_MAX_BLOCK_TEXT) }))}
                  placeholder="可选：添加图片说明…"
                  rows={2}
                  value={block.text}
                />
              </div>
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
                        : block.type === 'math'
                          ? '输入 LaTeX，例如 \\frac{a}{b}…'
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
