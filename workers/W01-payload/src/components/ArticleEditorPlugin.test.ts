import { describe, expect, it } from 'vitest'

import { normalizeArticleEditorPlugins, type ArticleEditorPlugin } from './ArticleEditorPlugin.js'

const plugin = (id: string, order?: number): ArticleEditorPlugin => ({
  id,
  label: id,
  order,
})

describe('article editor plugin host', () => {
  it('orders plugins deterministically by order and id', () => {
    const ordered = normalizeArticleEditorPlugins([
      plugin('z', 20),
      plugin('a', 10),
      plugin('c'),
      plugin('b', 10),
    ])

    expect(ordered.map((item) => item.id)).toEqual(['a', 'b', 'c', 'z'])
  })

  it('drops empty ids and keeps only the first plugin for a duplicate id', () => {
    const duplicate = plugin(' word-import ', 10)
    const plugins = normalizeArticleEditorPlugins([
      plugin('', 1),
      duplicate,
      plugin('word-import', 20),
      plugin('gallery', 30),
    ])

    expect(plugins.map((item) => item.id)).toEqual(['word-import', 'gallery'])
    expect(plugins[0]).toBe(duplicate)
  })

  it('does not mutate the caller-provided plugin array', () => {
    const plugins = [plugin('two', 20), plugin('one', 10)]
    const original = [...plugins]

    normalizeArticleEditorPlugins(plugins)

    expect(plugins).toEqual(original)
  })
})
