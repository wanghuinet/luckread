import type { ArticleBlock, ArticleDocument } from './article-document.js'

const escapeLeadingMarkdown = (value: string): string =>
  value
    .split('\n')
    .map((line) => {
      if (/^\s*(?:#{1,6}\s|>\s|[-+*]\s|\d+[.)]\s|---+$|___+$|(?:\*\s*){3,})/u.test(line)) {
        return '\\' + line
      }
      return line
    })
    .join('\n')

const exportBlock = (block: ArticleBlock): string => {
  switch (block.type) {
    case 'heading':
      return '#'.repeat(block.level === 3 ? 3 : 2) + ' ' + escapeLeadingMarkdown(block.text.trim())
    case 'quote':
      return block.text
        .trim()
        .split('\n')
        .map((line) => '> ' + line)
        .join('\n')
    case 'bulletList':
      return block.text
        .split('\n')
        .filter(Boolean)
        .map((item) => '- ' + escapeLeadingMarkdown(item.trim()))
        .join('\n')
    case 'orderedList':
      return block.text
        .split('\n')
        .filter(Boolean)
        .map((item, index) => String(index + 1) + '. ' + escapeLeadingMarkdown(item.trim()))
        .join('\n')
    case 'divider':
      return '---'
    case 'image': {
      const ref = block.mediaRefs?.[0]
      return ref ? '![' + block.text.trim() + '](' + ref + ')' : ''
    }
    case 'gallery':
      return (block.mediaRefs ?? [])
        .map((ref) => '![' + block.text.trim() + '](' + ref + ')')
        .join('\n')
    case 'paragraph':
    default:
      return escapeLeadingMarkdown(block.text.trim())
  }
}

export const articleDocumentToMarkdown = (document: ArticleDocument): string =>
  document.blocks
    .map(exportBlock)
    .filter(Boolean)
    .join('\n\n') + '\n'
