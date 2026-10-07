export type TextMark = 'bold' | 'italic' | 'underline' | 'strike' | 'superscript' | 'subscript'

export interface ImportedText {
  kind: 'text'
  text: string
  marks: TextMark[]
  color?: string
  backgroundColor?: string
  fontSizePt?: number
  fontFamily?: string
}

export interface ImportedLink {
  kind: 'link'
  href: string
  children: ImportedText[]
}

export interface ImportedInlineImage {
  kind: 'inlineImage'
  image: ImportedImage
}

export type ImportedInline = ImportedText | ImportedLink | ImportedInlineImage

export interface ImportedParagraphStyle {
  align?: 'left' | 'center' | 'right' | 'justify'
  firstLineIndentPt?: number
  leftIndentPt?: number
  rightIndentPt?: number
  spacingBeforePt?: number
  spacingAfterPt?: number
  lineHeight?: number
}

export interface ImportedParagraphBase {
  inlines: ImportedInline[]
  style?: ImportedParagraphStyle
}

export interface ImportedParagraph extends ImportedParagraphBase {
  kind: 'paragraph'
}

export interface ImportedHeading extends ImportedParagraphBase {
  kind: 'heading'
  level: 1 | 2 | 3 | 4 | 5 | 6
}

export interface ImportedListItem {
  kind: 'listItem'
  inlines: ImportedInline[]
  level: number
  ordered: boolean
  style?: ImportedParagraphStyle
}

export interface ImportedImage {
  kind: 'image'
  mediaKey: string
  mimeType: string
  bytes: Uint8Array
  widthPx?: number
  heightPx?: number
  alt?: string
}

export interface ImportedTableCell {
  blocks: ImportedBlock[]
  colSpan?: number
  rowSpan?: number
  widthPx?: number
  backgroundColor?: string
  align?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'center' | 'bottom'
  header?: boolean
}

export interface ImportedTable {
  kind: 'table'
  rows: ImportedTableCell[][]
  widthPx?: number
}

export interface ImportedList {
  kind: 'list'
  items: ImportedListItem[]
}

export type ImportedBlock =
  | ImportedParagraph
  | ImportedHeading
  | ImportedListItem
  | ImportedList
  | ImportedImage
  | ImportedTable

export interface ImportWarning {
  code:
    | 'UNSUPPORTED_OBJECT'
    | 'NORMALIZED_LAYOUT'
    | 'SKIPPED_MEDIA'
    | 'INVALID_LINK'
    | 'TRUNCATED_INPUT'
  message: string
}

export interface ImportedDocument {
  blocks: ImportedBlock[]
  warnings: ImportWarning[]
  stats: {
    paragraphs: number
    headings: number
    lists: number
    images: number
    tables: number
    mediaBytes: number
    normalizedLineBreaks: number
    normalizedWideMedia: number
  }
}
