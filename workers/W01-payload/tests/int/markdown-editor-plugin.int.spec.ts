import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { markdownToArticleDocument } from '../../src/lib/markdown-to-article-document.js'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('Markdown editor plugin', () => {
  it('converts supported Markdown blocks into the stable ArticleDocument', () => {
    const result = markdownToArticleDocument([
      '# 主标题',
      '',
      '正文 **加粗**',
      '',
      '> 引用',
      '',
      '- 第一项',
      '- 第二项',
      '',
      '1. A',
      '2. B',
      '',
      '---',
      '',
      '\x60\x60\x60ts',
      'const answer: number = 42',
      '\x60\x60\x60',
    ].join('\n'))

    expect(result.unsupported).toEqual([])
    expect(result.document.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'quote',
      'bulletList',
      'orderedList',
      'divider',
      'code',
    ])
    expect(result.document.blocks[0]?.level).toBe(2)
    expect(result.document.blocks[3]?.text).toBe('第一项\n第二项')
    expect(result.document.blocks[6]).toMatchObject({
      type: 'code',
      language: 'typescript',
      text: 'const answer: number = 42',
    })
    expect(result.document.version).toBe(2)
  })

  it('imports display math into a dedicated math block', () => {
    const result = markdownToArticleDocument(['$$', '\\frac{a}{b}', '$$'].join('\\n'))

    expect(result.unsupported).toEqual([])
    expect(result.document.blocks[0]).toMatchObject({
      type: 'math',
      text: '\\frac{a}{b}',
    })
  })

  it('imports markdown tables into structured table blocks', () => {
    const result = markdownToArticleDocument([
      '| 名称 | 状态 |',
      '| --- | --- |',
      '| Markdown | 已完成 |',
      '| Code | 进行中 |',
    ].join('\n'))

    expect(result.unsupported).toEqual([])
    expect(result.document.blocks[0]).toMatchObject({
      type: 'table',
      table: {
        headers: ['名称', '状态'],
        rows: [
          ['Markdown', '已完成'],
          ['Code', '进行中'],
        ],
      },
    })
  })

  it('imports a standalone remote image as a media block', () => {
    const result = markdownToArticleDocument(
      '![封面](https://cdn.example.com/cover.webp)',
    )

    expect(result.unsupported).toEqual([])
    expect(result.document.blocks[0]).toMatchObject({
      type: 'image',
      text: '封面',
      mediaRefs: ['https://cdn.example.com/cover.webp'],
    })
  })

  it('fails closed for content the current document schema cannot preserve', () => {
    const result = markdownToArticleDocument([
      '[保留链接地址](https://example.com)',
      '',
      '**\x60inline\x60**',
      '',
      '<div>unsupported html</div>',
    ].join('\n'))

    expect(result.unsupported).toEqual(
      expect.arrayContaining(['链接', 'HTML']),
    )
  })

  it('registers writer statistics and plain text copy tools without new network dependencies', () => {
    const tools = read('src/components/WriterToolsPlugin.tsx')
    const registry = read('src/components/article-editor-plugins.ts')
    expect(tools).toContain('const characters = Array.from(plainText).length')
    expect(tools).toContain('value.blocks.filter((block) => block.type === \'math\').length')
    expect(tools).toContain("id: 'content.writer-stats'")
    expect(tools).toContain("id: 'content.copy-plain-text'")
    expect(tools).toContain('navigator.clipboard.writeText(plainText)')
    expect(registry).toContain("import { copyPlainTextPlugin, writerStatsPlugin } from './WriterToolsPlugin.js'")
    expect(registry).toContain('writerStatsPlugin')
    expect(registry).toContain('copyPlainTextPlugin')
  })

  it('registers the article outline plugin against stable block anchors', () => {
    const editor = read('src/components/ArticleStructuredEditor.tsx')
    const outline = read('src/components/ArticleOutlinePlugin.tsx')
    const registry = read('src/components/article-editor-plugins.ts')
    expect(editor).toContain("const blockDomId = (id: string): string => 'lr-article-block-' + encodeURIComponent(id)")
    expect(editor).toContain('id={blockDomId(block.id)}')
    expect(outline).toContain('function ArticleOutlinePanel(')
    expect(outline).toContain('block.type === \'heading\'')
    expect(outline).toContain('window.document.getElementById(blockDomId(block.id))')
    expect(outline).toContain("id: 'content.outline'")
    expect(registry).toContain("import { articleOutlinePlugin } from './ArticleOutlinePlugin.js'")
    expect(registry).toContain('articleOutlinePlugin')
  })

  it('registers the find and replace plugin without changing the document authority', () => {
    const plugin = read('src/components/FindReplacePlugin.tsx')
    const registry = read('src/components/article-editor-plugins.ts')
    expect(plugin).toContain('function replaceAllTextCaseAware(')
    expect(plugin).toContain('ARTICLE_TABLE_MAX_CELL_TEXT')
    expect(plugin).toContain("id: 'content.find-replace'")
    expect(plugin).toContain('当前匹配 {matchCount} 处')
    expect(plugin).toContain("event.shiftKey && event.key.toLowerCase() === 'f'")
    expect(plugin).toContain("event.key === 'Escape'")
    expect(plugin).toContain("window.addEventListener('keydown', onKeyDown)")
    expect(plugin).toContain('全部替换')
    expect(registry).toContain("import { findReplacePlugin } from './FindReplacePlugin.js'")
    expect(registry).toContain('findReplacePlugin')
  })

  it('registers the open-source plugin through the existing host', () => {
    const registry = read(
      'src/components/article-editor-plugins.ts',
    )
    const plugin = read(
      'src/components/MarkdownImportPlugin.tsx',
    )

    expect(registry).toContain(
      "import { markdownImportPlugin } from './MarkdownImportPlugin.js'",
    )
    expect(registry).toContain('markdownImportPlugin')
    expect(registry).toContain('markdownExportPlugin')
    expect(registry).toContain('codeBlockPlugin')
    expect(registry).toContain('tableBlockPlugin')
    expect(registry).toContain('mathBlockPlugin')
    expect(registry).toContain('findReplacePlugin')
    expect(registry).toContain('articleOutlinePlugin')
    expect(plugin).toContain('markdownToArticleDocument')
    expect(plugin).toContain('className="lr-editor-markdown-input"')
    const math = read('src/components/MathBlockPlugin.tsx')
    expect(plugin).toContain('本次不会导入，避免静默丢失内容')
    expect(math).toContain("import { createArticleBlock } from '../lib/article-document.js'")
    expect(math).toContain("id: 'content.math-block'")
    expect(math).toContain('KaTeX')
  })

  it('registers the media manager without relaxing media block constraints', () => {
    const manager = read('src/components/MediaManagerPlugin.tsx')
    const registry = read('src/components/article-editor-plugins.ts')
    expect(manager).toContain("id: 'content.media-manager'")
    expect(manager).toContain("block.type !== 'image' && block.type !== 'gallery'")
    expect(manager).toContain("block.type === 'gallery' && refs.length < 2")
    expect(manager).toContain('moveRef(media.blockIndex, refIndex, -1)')
    expect(manager).toContain('removeRef(media.blockIndex, refIndex)')
    expect(manager).toContain('function addRef(blockIndex: number, url: string)')
    expect(manager).toContain('mediaAssets.filter((asset) => asset.mimeType.startsWith(\'image/\')')
    expect(manager).toContain('media.refs.length >= 12')
    expect(registry).toContain("import { mediaManagerPlugin } from './MediaManagerPlugin.js'")
    expect(registry).toContain('mediaManagerPlugin')
  })

  it('registers bounded undo and redo without adding another document authority', () => {
    const history = read('src/components/UndoRedoPlugin.tsx')
    const registry = read('src/components/article-editor-plugins.ts')
    expect(history).toContain('const MAX_HISTORY_ENTRIES = 40')
    expect(history).toContain('const MAX_HISTORY_CHARS = 2_000_000')
    expect(history).toContain('const HISTORY_GROUP_WINDOW_MS = 750')
    expect(history).toContain('pastRef.current')
    expect(history).toContain('futureRef.current')
    expect(history).toContain('updateDocument(document)')
    expect(history).toContain("(!event.metaKey && !event.ctrlKey)")
    expect(history).toContain("event.key.toLowerCase()")
    expect(history).toContain("window.addEventListener('keydown', onKeyDown)")
    expect(history).toContain("id: 'content.undo-redo'")
    expect(registry).toContain("import { undoRedoPlugin } from './UndoRedoPlugin.js'")
    expect(registry).toContain('undoRedoPlugin')
  })
})
