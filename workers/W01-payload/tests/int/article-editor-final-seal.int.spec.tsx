import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ArticleStructuredEditor from '../../src/components/ArticleStructuredEditor.js'
import {
  ARTICLE_MAX_BLOCKS,
  createArticleDocument,
  serializeArticleBlockForClipboard,
  type ArticleDocument,
} from '../../src/lib/article-document.js'

function EditorHarness({
  initialValue = createArticleDocument('第一段'),
  disabled = false,
}: {
  initialValue?: ArticleDocument
  disabled?: boolean
}) {
  const [value, setValue] = useState(initialValue)

  return (
    <ArticleStructuredEditor
      value={value}
      disabled={disabled}
      onChange={(next) => setValue(next)}
    />
  )
}

describe('ArticleStructuredEditor final interaction closure', () => {
  it('inserts a paragraph with Ctrl/Cmd+Enter and moves focus to it', async () => {
    render(<EditorHarness />)

    const first = screen.getByRole('textbox', { name: '正文' })
    first.focus()
    fireEvent.keyDown(first, {
      key: 'Enter',
      ctrlKey: true,
    })

    const textareas = await screen.findAllByRole('textbox', { name: '正文' })
    expect(textareas).toHaveLength(2)
    expect((textareas[1] as HTMLTextAreaElement).value).toBe('')
    expect(document.activeElement).toBe(textareas[1])
  })

  it('merges an adjacent same-type block from the start of the textarea and restores focus', async () => {
    const initialValue = {
      version: 2 as const,
      blocks: [
        { id: 'first', type: 'paragraph' as const, text: '第一段' },
        { id: 'second', type: 'paragraph' as const, text: '第二段' },
      ],
    }
    render(<EditorHarness initialValue={initialValue} />)

    const textareas = screen.getAllByRole('textbox', { name: '正文' })
    const secondTextarea = textareas[1] as HTMLTextAreaElement
    secondTextarea.focus()
    secondTextarea.selectionStart = 0
    secondTextarea.selectionEnd = 0

    fireEvent.keyDown(secondTextarea, {
      key: 'Backspace',
    })

    await waitFor(() => {
      const merged = screen.getAllByRole('textbox', { name: '正文' })
      expect(merged).toHaveLength(1)
      expect((merged[0] as HTMLTextAreaElement).value).toBe('第一段\n\n第二段')
      expect(window.document.activeElement).toBe(merged[0])
      expect(merged[0]).toHaveProperty('selectionStart', '第一段\n\n第二段'.length)
    })
  })

  it('moves a block with Alt+ArrowDown and preserves the cursor offset', async () => {
    const initialValue = {
      version: 2 as const,
      blocks: [
        { id: 'first', type: 'paragraph' as const, text: '第一段' },
        { id: 'second', type: 'paragraph' as const, text: '第二段' },
      ],
    }
    render(<EditorHarness initialValue={initialValue} />)

    const textareas = screen.getAllByRole('textbox', { name: '正文' })
    const firstTextarea = textareas[0] as HTMLTextAreaElement
    firstTextarea.focus()
    firstTextarea.selectionStart = 1
    firstTextarea.selectionEnd = 1

    fireEvent.keyDown(firstTextarea, {
      key: 'ArrowDown',
      altKey: true,
    })

    await waitFor(() => {
      const moved = screen.getAllByRole('textbox', { name: '正文' })
      expect((moved[0] as HTMLTextAreaElement).value).toBe('第二段')
      expect((moved[1] as HTMLTextAreaElement).value).toBe('第一段')
      expect(window.document.activeElement).toBe(moved[1])
      expect(moved[1]).toHaveProperty('selectionStart', 1)
    })
  })

  it('accepts structured clipboard paste and restores a duplicated block', async () => {
    render(<EditorHarness />)

    const raw = serializeArticleBlockForClipboard({
      id: 'source',
      type: 'heading',
      text: '复制后的标题',
      level: 3,
    })
    const first = screen.getByRole('textbox', { name: '正文' })

    fireEvent.paste(first, {
      clipboardData: {
        getData: () => raw,
      },
    })

    await waitFor(() => {
      expect(screen.getAllByRole('textbox', { name: '正文' })).toHaveLength(1)
      expect((screen.getByRole('textbox', { name: '标题' }) as HTMLTextAreaElement).value).toBe('复制后的标题')
      expect(window.document.activeElement).toBe(screen.getByRole('textbox', { name: '标题' }))
    })
  })

  it('blocks structural keyboard actions while disabled', () => {
    render(<EditorHarness disabled />)

    const first = screen.getByRole('textbox', { name: '正文' })
    first.focus()

    fireEvent.keyDown(first, {
      key: 'Enter',
      ctrlKey: true,
    })

    expect(screen.getAllByRole('textbox', { name: '正文' })).toHaveLength(1)
  })

  it('disables structural insertion controls at the maximum block count', () => {
    const blocks = Array.from({ length: ARTICLE_MAX_BLOCKS }, (_, index) => ({
      id: 'block-' + String(index),
      type: 'paragraph' as const,
      text: '正文',
    }))

    render(
      <EditorHarness
        initialValue={{
          version: 2,
          blocks,
        }}
      />,
    )

    expect(screen.getAllByRole('button', { name: '在下方添加正文区块' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    expect(screen.getAllByRole('button', { name: '复制区块' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
  })
})
