import { describe, expect, it } from 'vitest'
import { articleDocumentToMarkdown } from './article-document-to-markdown.js'

describe('ArticleDocument to Markdown', () => {
  it('exports all supported article structures', () => {
    const markdown = articleDocumentToMarkdown({
      version: 2,
      blocks: [
        { id: 'h2', type: 'heading', text: '小标题', level: 2 },
        { id: 'h3', type: 'heading', text: '子标题', level: 3 },
        { id: 'p', type: 'paragraph', text: '正文' },
        { id: 'q', type: 'quote', text: '第一行\n第二行' },
        { id: 'b', type: 'bulletList', text: '一\n二' },
        { id: 'o', type: 'orderedList', text: '甲\n乙' },
        { id: 'd', type: 'divider', text: '' },
        {
          id: 'i',
          type: 'image',
          text: '图片',
          mediaRefs: ['https://media.example/a.jpg'],
        },
        {
          id: 'g',
          type: 'gallery',
          text: '图库',
          mediaRefs: [
            'https://media.example/b.jpg',
            'https://media.example/c.jpg',
          ],
        },
      ],
    })

    expect(markdown).toContain('## 小标题')
    expect(markdown).toContain('### 子标题')
    expect(markdown).toContain('> 第一行\n> 第二行')
    expect(markdown).toContain('- 一\n- 二')
    expect(markdown).toContain('1. 甲\n2. 乙')
    expect(markdown).toContain('---')
    expect(markdown).toContain('![图片](https://media.example/a.jpg)')
    expect(markdown).toContain('![图库](https://media.example/b.jpg)')
    expect(markdown.endsWith('\n')).toBe(true)
  })

  it('escapes structural-looking paragraph lines', () => {
    const markdown = articleDocumentToMarkdown({
      version: 2,
      blocks: [
        { id: 'p', type: 'paragraph', text: '# 不是标题\n- 不是列表\n> 不是引用' },
      ],
    })

    expect(markdown).toContain('\\# 不是标题')
    expect(markdown).toContain('\\- 不是列表')
    expect(markdown).toContain('\\> 不是引用')
  })
})
