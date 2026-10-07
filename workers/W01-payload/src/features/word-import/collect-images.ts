import type { ImportedBlock, ImportedImage, ImportedInline } from './model.js'

const collectInlineImages = (inlines: ImportedInline[], result: ImportedImage[]): void => {
  for (const inline of inlines) {
    if (inline.kind === 'inlineImage') result.push(inline.image)
  }
}

export const collectImportedImages = (blocks: ImportedBlock[], result: ImportedImage[] = []): ImportedImage[] => {
  for (const block of blocks) {
    if (block.kind === 'image') {
      result.push(block)
    } else if (block.kind === 'paragraph' || block.kind === 'heading' || block.kind === 'listItem') {
      collectInlineImages(block.inlines, result)
    } else if (block.kind === 'list') {
      for (const item of block.items) collectInlineImages(item.inlines, result)
    } else if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row) collectImportedImages(cell.blocks, result)
      }
    }
  }
  return result
}
