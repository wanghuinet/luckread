import { describe, expect, it } from 'vitest'
import {
  countTextMatches,
  replaceAllTextCaseAware,
  replaceTextInArticleDocument,
} from './FindReplacePlugin.js'

describe('article editor find and replace', () => {
  it('counts literal matches with optional case sensitivity', () => {
    expect(countTextMatches('LuckRead luckread LUCKREAD', 'luckread', false)).toBe(3)
    expect(countTextMatches('LuckRead luckread LUCKREAD', 'luckread', true)).toBe(1)
    expect(countTextMatches('abc', '', false)).toBe(0)
  })

  it('replaces all literal matches without interpreting regex characters', () => {
    expect(replaceAllTextCaseAware('a+b A+B', 'a+b', 'x', false)).toBe('x x')
    expect(replaceAllTextCaseAware('one two one', 'one', 'three', true)).toBe('three two three')
    expect(replaceAllTextCaseAware('abc', '', 'x', false)).toBe('abc')
  })

  it('replaces text across every block while preserving block structure', () => {
    const document = {
      version: 2 as const,
      blocks: [
        { id: 'a', type: 'paragraph' as const, text: '旧标题' },
        { id: 'b', type: 'heading' as const, text: '旧标题', level: 2 as const },
        { id: 'c', type: 'image' as const, text: '图片说明', mediaRefs: ['https://media.example/a.jpg'] },
      ],
    }

    const next = replaceTextInArticleDocument(document, '旧标题', '新标题', true)

    expect(next.blocks[0]?.text).toBe('新标题')
    expect(next.blocks[1]?.text).toBe('新标题')
    expect(next.blocks[1]?.level).toBe(2)
    expect(next.blocks[2]?.mediaRefs).toEqual(['https://media.example/a.jpg'])
    expect(document.blocks[0]?.text).toBe('旧标题')
  })
})
