import katex from 'katex'
import Prism from 'prismjs'
import 'prismjs/components/prism-bash.js'
import 'prismjs/components/prism-css.js'
import 'prismjs/components/prism-json.js'
import 'prismjs/components/prism-markup.js'
import 'prismjs/components/prism-markdown.js'
import 'prismjs/components/prism-python.js'
import 'prismjs/components/prism-sql.js'
import 'prismjs/components/prism-typescript.js'

import type { ArticleDocument, ArticleCodeLanguage } from '../lib/article-document.js'

type Props = {
  document: ArticleDocument
}

const listItems = (text: string) =>
  text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)

export default function ArticleStructuredRenderer({ document }: Props) {
  return (
    <div className="content-detail-article-body">
      {document.blocks.map((block) => {
        if (block.type === 'divider') {
          return <hr aria-label="内容分隔线" key={block.id} />
        }

        if (block.type === 'heading') {
          const Heading = block.level === 3 ? 'h3' : 'h2'
          return <Heading key={block.id}>{block.text}</Heading>
        }

        if (block.type === 'quote') {
          return <blockquote key={block.id}>{block.text}</blockquote>
        }

        if (block.type === 'bulletList' || block.type === 'orderedList') {
          const ListTag = block.type === 'bulletList' ? 'ul' : 'ol'
          return (
            <ListTag key={block.id}>
              {listItems(block.text).map((item, index) => (
                <li key={block.id + ':' + index}>{item}</li>
              ))}
            </ListTag>
          )
        }

        if (block.type === 'table') {
          const table = block.table
          if (!table) return null
          return (
            <figure className="content-detail-article-table" key={block.id}>
              <div className="content-detail-article-table-scroll">
                <table>
                  <thead>
                    <tr>
                      {table.headers.map((header, index) => (
                        <th key={block.id + ':header:' + index} scope="col">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rowIndex) => (
                      <tr key={block.id + ':row:' + rowIndex}>
                        {row.map((cell, columnIndex) => (
                          <td key={block.id + ':cell:' + rowIndex + ':' + columnIndex}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </figure>
          )
        }

        if (block.type === 'math') {
          const html = katex.renderToString(block.text, {
            displayMode: true,
            throwOnError: false,
            strict: 'warn',
          })
          return (
            <figure className="content-detail-article-math" key={block.id}>
              <div
                aria-label="数学公式"
                className="content-detail-article-math-expression"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </figure>
          )
        }

        if (block.type === 'code') {
          const grammarKey: ArticleCodeLanguage | 'markup' =
            block.language === 'html' ? 'markup' : (block.language ?? 'plaintext')
          const grammar = grammarKey === 'plaintext'
            ? null
            : Prism.languages[grammarKey]
          const highlighted = grammar
            ? Prism.highlight(block.text, grammar, grammarKey)
            : null

          return (
            <figure className="content-detail-article-code" key={block.id}>
              <figcaption>{block.language ?? 'plaintext'}</figcaption>
              <pre>
                <code>
                  {highlighted
                    ? <span dangerouslySetInnerHTML={{ __html: highlighted }} />
                    : block.text}
                </code>
              </pre>
            </figure>
          )
        }

        if (block.type === 'image') {
          const ref = block.mediaRefs?.[0]
          if (!ref) return null
          return (
            <figure key={block.id}>
              <img alt={block.text || '文章图片'} loading="lazy" src={ref} />
              {block.text ? <figcaption>{block.text}</figcaption> : null}
            </figure>
          )
        }

        if (block.type === 'gallery') {
          const refs = block.mediaRefs ?? []
          if (!refs.length) return null
          return (
            <figure key={block.id}>
              <div className="content-detail-article-gallery">
                {refs.map((ref, index) => (
                  <img
                    alt={(block.text || '文章图库') + ' ' + (index + 1)}
                    key={ref}
                    loading="lazy"
                    src={ref}
                  />
                ))}
              </div>
              {block.text ? <figcaption>{block.text}</figcaption> : null}
            </figure>
          )
        }

        return <p key={block.id}>{block.text}</p>
      })}
    </div>
  )
}
