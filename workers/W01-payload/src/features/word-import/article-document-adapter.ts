import {
  ARTICLE_MAX_BLOCKS,
  createArticleBlock,
  createArticleMediaBlock,
  createArticleDocument,
  serializeArticleDocument,
  type ArticleDocument,
} from '../../lib/article-document.js'
import type {
  ImportedBlock,
  ImportedInline,
  ImportedListItem,
  ImportedDocument,
} from './model.js'

export type ArticleWordImportResult = {
  document: ArticleDocument
  warnings: string[]
}

const inlineText = (inlines: ImportedInline[]): string =>
  inlines
    .map((inline) => inline.kind === 'link' ? inline.children.map((child) => child.text).join('') : inline.kind === 'inlineImage' ? '' : inline.text)
    .join('')

const collectInlineImages = (inlines: ImportedInline[]): string[] =>
  inlines
    .filter((inline): inline is Extract<ImportedInline, { kind: 'inlineImage' }> => inline.kind === 'inlineImage')
    .map((inline) => inline.image.mediaKey)

const appendParagraph = (blocks: ReturnType<typeof createArticleBlock>[], text: string) => {
  const value = text.trim()
  if (value) blocks.push(createArticleBlock('paragraph', value))
}

const appendList = (
  blocks: ReturnType<typeof createArticleBlock>[],
  items: ImportedListItem[],
) => {
  if (!items.length) return
  const ordered = items.every((item) => item.ordered)
  const mixed = items.some((item) => item.ordered !== ordered)
  blocks.push(createArticleBlock(ordered && !mixed ? 'orderedList' : 'bulletList', items.map((item) => {
    const prefix = item.ordered && !mixed ? '' : ''
    return prefix + inlineText(item.inlines).trim()
  }).filter(Boolean).join('\n')))
}

export const articleDocumentFromImportedDocument = (
  document: ImportedDocument,
  mediaRefs: ReadonlyMap<string, string>,
): ArticleWordImportResult => {
  const blocks: ArticleDocument['blocks'] = []
  const warnings = [...document.warnings.map((warning) => warning.message)]

  const appendImportedBlocks = (input: ImportedBlock[]) => {
    for (const block of input) {
      if (block.kind === 'paragraph') {
        appendParagraph(blocks, inlineText(block.inlines))
        for (const key of collectInlineImages(block.inlines)) {
          const url = mediaRefs.get(key)
          if (url) blocks.push(createArticleMediaBlock('image', [url]))
          else warnings.push('有一张 Word 图片无法关联到已上传媒体。')
        }
        continue
      }

      if (block.kind === 'heading') {
        const text = inlineText(block.inlines).trim()
        if (text) {
          blocks.push(createArticleBlock('heading', text))
          const current = blocks[blocks.length - 1]
          if (current.type === 'heading') current.level = block.level <= 2 ? 2 : 3
        }
        for (const key of collectInlineImages(block.inlines)) {
          const url = mediaRefs.get(key)
          if (url) blocks.push(createArticleMediaBlock('image', [url]))
        }
        continue
      }

      if (block.kind === 'list') {
        appendList(blocks, block.items)
        for (const item of block.items) {
          for (const key of collectInlineImages(item.inlines)) {
            const url = mediaRefs.get(key)
            if (url) blocks.push(createArticleMediaBlock('image', [url]))
          }
        }
        continue
      }

      if (block.kind === 'listItem') {
        appendList(blocks, [block])
        for (const key of collectInlineImages(block.inlines)) {
          const url = mediaRefs.get(key)
          if (url) blocks.push(createArticleMediaBlock('image', [url]))
        }
        continue
      }

      if (block.kind === 'image') {
        const url = mediaRefs.get(block.mediaKey)
        if (url) blocks.push(createArticleMediaBlock('image', [url], block.alt ?? ''))
        else warnings.push('有一张 Word 图片未能关联到媒体资源。')
        continue
      }

      if (block.kind === 'table') {
        warnings.push('Word 表格已转为段落文本；当前结构化文章模型暂不持久化表格单元格布局。')
        for (const row of block.rows) {
          const rowImages: string[] = []
          const rowText = row.map((cell) => {
            const text = cell.blocks
              .flatMap((cellBlock) => {
                if (cellBlock.kind === 'paragraph') {
                  for (const key of collectInlineImages(cellBlock.inlines)) {
                    const url = mediaRefs.get(key)
                    if (url) rowImages.push(url)
                  }
                  return [inlineText(cellBlock.inlines)]
                }
                if (cellBlock.kind === 'heading') {
                  for (const key of collectInlineImages(cellBlock.inlines)) {
                    const url = mediaRefs.get(key)
                    if (url) rowImages.push(url)
                  }
                  return [inlineText(cellBlock.inlines)]
                }
                if (cellBlock.kind === 'list') {
                  for (const item of cellBlock.items) {
                    for (const key of collectInlineImages(item.inlines)) {
                      const url = mediaRefs.get(key)
                      if (url) rowImages.push(url)
                    }
                  }
                  return cellBlock.items.map((item) => inlineText(item.inlines))
                }
                if (cellBlock.kind === 'listItem') {
                  for (const key of collectInlineImages(cellBlock.inlines)) {
                    const url = mediaRefs.get(key)
                    if (url) rowImages.push(url)
                  }
                  return [inlineText(cellBlock.inlines)]
                }
                if (cellBlock.kind === 'image') {
                  const url = mediaRefs.get(cellBlock.mediaKey)
                  if (url) rowImages.push(url)
                  return []
                }
                return []
              })
              .map((value) => value.trim())
              .filter(Boolean)
              .join(' / ')
            return text || ''
          }).join(' ｜ ').trim()
          appendParagraph(blocks, rowText)
          for (const url of Array.from(new Set(rowImages))) {
            blocks.push(createArticleMediaBlock('image', [url]))
          }
        }
      }
    }
  }

  appendImportedBlocks(document.blocks)

  if (!blocks.length) {
    warnings.push('Word 文档没有可导入的正文内容。')
    return { document: createArticleDocument(), warnings }
  }

  if (blocks.length > ARTICLE_MAX_BLOCKS) {
    throw new Error('Word 导入结果超过文章最多 ' + String(ARTICLE_MAX_BLOCKS) + ' 个区块的限制，请拆分文档后再导入。')
  }

  const importedDocument: ArticleDocument = {
    version: 2,
    blocks,
  }

  try {
    serializeArticleDocument(importedDocument)
  } catch (error) {
    if (error instanceof Error && error.message === 'ARTICLE_DOCUMENT_TOO_LARGE') {
      throw new Error('Word 导入结果超过文章保存大小限制，请拆分文档后再导入。')
    }
    throw error
  }

  return {
    document: importedDocument,
    warnings,
  }
}
