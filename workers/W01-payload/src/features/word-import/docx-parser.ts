import { DocxZip } from './zip.js'
import type {
  ImportedBlock,
  ImportedDocument,
  ImportedHeading,
  ImportedInline,
  ImportedImage,
  ImportedListItem,
  ImportedParagraph,
  ImportedParagraphStyle,
  ImportedTable,
  ImportedTableCell,
  ImportedText,
  TextMark,
} from './model.js'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const EMU_PER_PX = 9525

interface StyleDef {
  name?: string
  basedOn?: string
  outlineLevel?: number
}

interface NumberingDef {
  numFmt: string
}

interface Relationship {
  target: string
  external: boolean
}

interface ParserContext {
  zip: DocxZip
  relationships: Map<string, Relationship>
  styles: Map<string, StyleDef>
  numbering: Map<string, NumberingDef>
  mediaByPath: Map<string, ImportedImage>
  mediaBytes: number
  warnings: ImportedDocument['warnings']
  mediaLimitBytes: number
}

function local(element: Element | null): string {
  return element?.localName ?? ''
}

function children(element: Element | null, name?: string): Element[] {
  if (!element) return []
  return [...element.children].filter((child) => !name || local(child) === name)
}

function child(element: Element | null, name: string): Element | null {
  return children(element, name)[0] ?? null
}

function descendant(element: Element | null, name: string): Element | null {
  if (!element) return null
  for (const node of [...element.getElementsByTagName('*')]) {
    if (local(node) === name) return node
  }
  return null
}

function attr(element: Element | null, name: string): string | undefined {
  if (!element) return undefined
  return (
    element.getAttributeNS(W_NS, name) ??
    element.getAttributeNS(R_NS, name) ??
    element.getAttribute('w:' + name) ??
    element.getAttribute('r:' + name) ??
    element.getAttribute(name) ??
    undefined
  )
}

function parseXml(source: string, label: string): Document {
  const parser = new DOMParser()
  const document = parser.parseFromString(source, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid DOCX XML: ' + label)
  }
  return document
}

function parseStyles(source: string): Map<string, StyleDef> {
  const result = new Map<string, StyleDef>()
  if (!source) return result
  const doc = parseXml(source, 'styles.xml')

  for (const style of [...doc.getElementsByTagNameNS(W_NS, 'style')]) {
    const id = attr(style, 'styleId')
    if (!id) continue

    const name = attr(child(style, 'name'), 'val')
    const basedOn = attr(child(style, 'basedOn'), 'val')
    const outlineText = attr(child(child(style, 'pPr'), 'outlineLvl'), 'val')

    result.set(id, {
      name,
      basedOn,
      outlineLevel: outlineText ? Number.parseInt(outlineText, 10) : undefined,
    })
  }

  return result
}

function parseNumbering(source: string): Map<string, NumberingDef> {
  const result = new Map<string, NumberingDef>()
  if (!source) return result
  const doc = parseXml(source, 'numbering.xml')

  const abstractFormats = new Map<string, string>()
  for (const abstractNum of [...doc.getElementsByTagNameNS(W_NS, 'abstractNum')]) {
    const abstractId = attr(abstractNum, 'abstractNumId')
    if (!abstractId) continue

    for (const level of [...abstractNum.getElementsByTagNameNS(W_NS, 'lvl')]) {
      const ilvl = attr(level, 'ilvl') ?? '0'
      const fmt = attr(child(level, 'numFmt'), 'val') ?? 'bullet'
      abstractFormats.set(abstractId + ':' + ilvl, fmt)
    }
  }

  for (const num of [...doc.getElementsByTagNameNS(W_NS, 'num')]) {
    const numId = attr(num, 'numId')
    const abstractId = attr(child(num, 'abstractNumId'), 'val')
    if (!numId || !abstractId) continue

    // Materialize the abstract numbering defaults first.
    for (let level = 0; level < 10; level += 1) {
      const fmt = abstractFormats.get(abstractId + ':' + level)
      if (fmt) result.set(numId + ':' + level, { numFmt: fmt })
    }

    // Direct lvlOverride entries intentionally win over abstract defaults.
    for (const override of [...num.getElementsByTagNameNS(W_NS, 'lvlOverride')]) {
      const ilvl = attr(override, 'ilvl') ?? '0'
      const level = child(override, 'lvl')
      const fmt = attr(child(level, 'numFmt'), 'val')
      if (fmt) result.set(numId + ':' + ilvl, { numFmt: fmt })
    }
  }

  return result
}

function resolveStyleHeadingLevel(
  styleId: string | undefined,
  styles: Map<string, StyleDef>,
  seen = new Set<string>(),
): number | undefined {
  if (!styleId || seen.has(styleId)) return undefined
  seen.add(styleId)
  const style = styles.get(styleId)
  if (!style) return undefined

  const name = style.name ?? ''
  const match = name.match(/(?:heading|标题)\s*([1-6])/i)
  if (match) return Math.min(6, Number.parseInt(match[1]!, 10))
  if (style.outlineLevel !== undefined) return Math.min(6, style.outlineLevel + 1)
  return resolveStyleHeadingLevel(style.basedOn, styles, seen)
}

function parsePackageTarget(sourcePart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = sourcePart.split('/')
  parts.pop()
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length > 0) parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

function parseRelationships(source: string): Map<string, Relationship> {
  const result = new Map<string, Relationship>()
  if (!source) return result
  const doc = parseXml(source, 'document.xml.rels')
  for (const relation of [...doc.getElementsByTagNameNS(REL_NS, 'Relationship')]) {
    const id = relation.getAttribute('Id')
    const target = relation.getAttribute('Target')
    if (!id || !target) continue
    const external = relation.getAttribute('TargetMode') === 'External'
    result.set(id, {
      target: external ? target : parsePackageTarget('word/document.xml', target),
      external,
    })
  }
  return result
}

function isTrue(element: Element | null): boolean {
  if (!element) return false
  const value = attr(element, 'val')
  return value === undefined || !['0', 'false', 'off', 'no', 'none'].includes(value.toLowerCase())
}

function wordColor(value: string | undefined): string | undefined {
  if (!value || value.toLowerCase() === 'auto') return undefined
  if (/^[0-9a-f]{6}$/i.test(value)) return '#' + value
  return undefined
}

function highlightColor(value: string | undefined): string | undefined {
  const map: Record<string, string> = {
    yellow: '#fff2a8',
    green: '#b7efb7',
    cyan: '#b7efff',
    magenta: '#f5b7ef',
    blue: '#b7ccff',
    red: '#ffb7b7',
    darkBlue: '#748ffc',
    darkCyan: '#66d9e8',
    darkGreen: '#69db7c',
    darkMagenta: '#da77f2',
    darkRed: '#ff8787',
    darkYellow: '#ffd43b',
    darkGray: '#868e96',
    lightGray: '#dee2e6',
  }
  if (!value || value.toLowerCase() === 'none') return undefined
  return map[value] ?? undefined
}

function parseRunMarks(rPr: Element | null): {
  marks: TextMark[]
  color?: string
  backgroundColor?: string
  fontSizePt?: number
  fontFamily?: string
} {
  const marks: TextMark[] = []
  const b = child(rPr, 'b')
  const i = child(rPr, 'i')
  const u = child(rPr, 'u')
  const strike = child(rPr, 'strike')
  const vertAlign = attr(child(rPr, 'vertAlign'), 'val')

  if (isTrue(b)) marks.push('bold')
  if (isTrue(i)) marks.push('italic')
  if (isTrue(u)) marks.push('underline')
  if (isTrue(strike)) marks.push('strike')
  if (vertAlign === 'superscript') marks.push('superscript')
  if (vertAlign === 'subscript') marks.push('subscript')

  const color = wordColor(attr(child(rPr, 'color'), 'val'))
  const backgroundColor = highlightColor(attr(child(rPr, 'highlight'), 'val'))
  const halfPoints = attr(child(rPr, 'sz'), 'val')
  const fontSizePt = halfPoints ? Number.parseInt(halfPoints, 10) / 2 : undefined
  const fonts = child(rPr, 'rFonts')
  const fontFamily =
    attr(fonts, 'eastAsia') ??
    attr(fonts, 'hAnsi') ??
    attr(fonts, 'ascii') ??
    undefined

  return { marks, color, backgroundColor, fontSizePt, fontFamily }
}

function styleFromParagraph(pPr: Element | null): ImportedParagraphStyle | undefined {
  if (!pPr) return undefined
  const style: ImportedParagraphStyle = {}

  const alignment = attr(child(pPr, 'jc'), 'val')
  if (alignment === 'center') style.align = 'center'
  else if (alignment === 'right' || alignment === 'end') style.align = 'right'
  else if (alignment === 'both' || alignment === 'distribute') style.align = 'justify'
  else if (alignment === 'left' || alignment === 'start') style.align = 'left'

  const indent = child(pPr, 'ind')
  const firstLine = attr(indent, 'firstLine')
  const hanging = attr(indent, 'hanging')
  const left = attr(indent, 'left')
  const right = attr(indent, 'right')
  if (firstLine) style.firstLineIndentPt = Number.parseInt(firstLine, 10) / 20
  else if (hanging) style.firstLineIndentPt = -Number.parseInt(hanging, 10) / 20
  if (left) style.leftIndentPt = Number.parseInt(left, 10) / 20
  if (right) style.rightIndentPt = Number.parseInt(right, 10) / 20

  const spacing = child(pPr, 'spacing')
  const before = attr(spacing, 'before')
  const after = attr(spacing, 'after')
  const line = attr(spacing, 'line')
  const lineRule = attr(spacing, 'lineRule')
  if (before) style.spacingBeforePt = Number.parseInt(before, 10) / 20
  if (after) style.spacingAfterPt = Number.parseInt(after, 10) / 20
  if (line && lineRule === 'auto') style.lineHeight = Number.parseInt(line, 10) / 240

  return Object.keys(style).length > 0 ? style : undefined
}

function textNode(text: string, marks: ReturnType<typeof parseRunMarks>): ImportedText {
  return {
    kind: 'text',
    text,
    marks: marks.marks,
    ...(marks.color ? { color: marks.color } : {}),
    ...(marks.backgroundColor ? { backgroundColor: marks.backgroundColor } : {}),
    ...(marks.fontSizePt ? { fontSizePt: marks.fontSizePt } : {}),
    ...(marks.fontFamily ? { fontFamily: marks.fontFamily } : {}),
  }
}

function runToInlines(run: Element): ImportedInline[] {
  const rPr = child(run, 'rPr')
  const marks = parseRunMarks(rPr)
  const result: ImportedInline[] = []

  for (const node of run.children) {
    const name = local(node)
    if (name === 't' || name === 'delText') {
      const value = node.textContent ?? ''
      if (value) result.push(textNode(value, marks))
    } else if (name === 'tab') {
      result.push(textNode(' ', marks))
    } else if (name === 'br' || name === 'cr') {
      result.push(textNode('\n', marks))
    } else if (name === 'noBreakHyphen') {
      result.push(textNode('-', marks))
    }
  }

  return result
}

function renderOmmlToText(element: Element): string {
  const name = local(element)
  if (name === 't') return element.textContent ?? ''
  if (name === 'f') {
    const numerator = child(element, 'num')
    const denominator = child(element, 'den')
    return '(' + (numerator ? renderOmmlToText(numerator) : '') + ')/(' +
      (denominator ? renderOmmlToText(denominator) : '') + ')'
  }
  if (name === 'sSub') {
    const base = child(element, 'e')
    const sub = child(element, 'sub')
    return (base ? renderOmmlToText(base) : '') + '_' + (sub ? renderOmmlToText(sub) : '')
  }
  if (name === 'sSup') {
    const base = child(element, 'e')
    const sup = child(element, 'sup')
    return (base ? renderOmmlToText(base) : '') + '^' + (sup ? renderOmmlToText(sup) : '')
  }
  return [...element.children].map(renderOmmlToText).join('')
}

function parseInlineContainer(
  container: Element,
  context: ParserContext,
): ImportedInline[] {
  const result: ImportedInline[] = []

  for (const node of container.children) {
    const name = local(node)
    if (name === 'r') {
      result.push(...runToInlines(node))
      continue
    }

    if (name === 'hyperlink') {
      const relId = attr(node, 'id')
      const relation = relId ? context.relationships.get(relId) : undefined
      if (!relation) {
        result.push(...parseInlineContainer(node, context))
        continue
      }

      const href = relation.target.trim()
      if (!/^(?:https?:\/\/|mailto:)/i.test(href)) {
        context.warnings.push({
          code: 'INVALID_LINK',
          message: 'A non-web DOCX hyperlink was ignored during import.',
        })
        result.push(...parseInlineContainer(node, context))
        continue
      }
      const childrenInlines = parseInlineContainer(node, context)
      const textChildren = childrenInlines.flatMap((inline) =>
        inline.kind === 'text'
          ? [inline]
          : inline.kind === 'link'
            ? inline.children
            : [],
      )
      if (textChildren.length > 0) {
        result.push({ kind: 'link', href, children: textChildren })
      } else {
        result.push(...childrenInlines)
      }
    }
  }

  return result
}

async function readImage(
  context: ParserContext,
  relationshipId: string,
  widthPx?: number,
  heightPx?: number,
  alt?: string,
): Promise<ImportedImage | undefined> {
  const relation = context.relationships.get(relationshipId)
  if (!relation || relation.external) return undefined

  const path = relation.target
  if (!path.startsWith('word/media/')) return undefined

  const existing = context.mediaByPath.get(path)
  if (existing) return existing

  const entry = context.zip.get(path)
  if (!entry) return undefined
  const mimeByExtension: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
  }

  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'svg') {
    context.warnings.push({
      code: 'SKIPPED_MEDIA',
      message: 'SVG Word images were skipped because this importer does not sanitize SVG content.',
    })
    return undefined
  }

  const mimeType = mimeByExtension[extension]
  if (!mimeType) {
    context.warnings.push({
      code: 'SKIPPED_MEDIA',
      message: 'Unsupported Word image type was skipped: ' + extension,
    })
    return undefined
  }

  if (entry.uncompressedSize > 15 * 1024 * 1024 || context.mediaBytes + entry.uncompressedSize > context.mediaLimitBytes) {
    throw new Error('DOCX image import exceeded the configured media safety budget')
  }

  const bytes = await context.zip.read(path, 15 * 1024 * 1024)
  context.mediaBytes += bytes.byteLength
  const image: ImportedImage = {
    kind: 'image',
    mediaKey: path,
    mimeType,
    bytes,
    ...(widthPx ? { widthPx } : {}),
    ...(heightPx ? { heightPx } : {}),
    ...(alt ? { alt } : {}),
  }
  context.mediaByPath.set(path, image)
  return image
}

async function parseDrawing(
  drawing: Element,
  context: ParserContext,
): Promise<ImportedImage | undefined> {
  const extent =
    [...drawing.getElementsByTagNameNS(WP_NS, 'extent')][0] ??
    descendant(drawing, 'extent')
  const cx = attr(extent, 'cx')
  const cy = attr(extent, 'cy')
  const widthPx = cx ? Math.round(Number(cx) / EMU_PER_PX) : undefined
  const heightPx = cy ? Math.round(Number(cy) / EMU_PER_PX) : undefined

  const docPr =
    [...drawing.getElementsByTagNameNS(WP_NS, 'docPr')][0] ??
    descendant(drawing, 'docPr')
  const alt = attr(docPr, 'descr') ?? attr(docPr, 'name')

  const blip = [...drawing.getElementsByTagNameNS(A_NS, 'blip')][0]
  const relId = blip?.getAttributeNS(R_NS, 'embed') ?? blip?.getAttribute('r:embed') ?? undefined
  if (!relId) return undefined

  return readImage(context, relId, widthPx, heightPx, alt)
}

async function parseLegacyVml(
  run: Element,
  context: ParserContext,
): Promise<ImportedImage | undefined> {
  const imagedata = [...run.getElementsByTagNameNS('urn:schemas-microsoft-com:vml', 'imagedata')][0]
  const relId = imagedata?.getAttributeNS(R_NS, 'id') ?? imagedata?.getAttribute('r:id') ?? undefined
  if (!relId) return undefined
  return readImage(context, relId)
}

function addUnsupportedObjectWarning(context: ParserContext, kind: string): void {
  context.warnings.push({
    code: 'UNSUPPORTED_OBJECT',
    message: 'A Word ' + kind + ' object was skipped during import.',
  })
}

async function parseParagraph(
  paragraph: Element,
  context: ParserContext,
): Promise<ImportedBlock[]> {
  const pPr = child(paragraph, 'pPr')
  const styleId = attr(child(pPr, 'pStyle'), 'val')
  const headingLevel = resolveStyleHeadingLevel(styleId, context.styles)

  const outlineLvl = attr(child(pPr, 'outlineLvl'), 'val')
  const levelFromOutline = outlineLvl ? Math.min(6, Number.parseInt(outlineLvl, 10) + 1) : undefined
  const style = styleFromParagraph(pPr)

  const numPr = child(pPr, 'numPr')
  const numId = attr(child(numPr, 'numId'), 'val')
  const ilvl = Number.parseInt(attr(child(numPr, 'ilvl'), 'val') ?? '0', 10)
  const numbering = numId ? context.numbering.get(numId + ':' + ilvl) : undefined
  const ordered = Boolean(numbering && !['bullet', 'none'].includes(numbering.numFmt))

  const inlines: ImportedInline[] = []
  const visit = async (container: Element): Promise<void> => {
    for (const childNode of container.children) {
      const name = local(childNode)

      if (name === 'del') {
        // Word's deleted/revision text must not be imported as live article content.
        continue
      }

      if (name === 'oMath' || name === 'oMathPara') {
        const mathText = renderOmmlToText(childNode).trim()
        if (mathText) {
          inlines.push({ kind: 'text', text: mathText, marks: [] })
          context.warnings.push({
            code: 'NORMALIZED_LAYOUT',
            message: 'A Word mathematical expression was imported as editable text.',
          })
        }
        continue
      }

      if (name === 'ins' || name === 'smartTag' || name === 'customXml') {
        await visit(childNode)
        continue
      }

      if (name === 'AlternateContent') {
        const fallback = child(childNode, 'Fallback')
        const choice = children(childNode, 'Choice')[0]
        if (fallback) await visit(fallback)
        else if (choice) await visit(choice)
        else addUnsupportedObjectWarning(context, 'AlternateContent')
        continue
      }

      if (name === 'fldSimple') {
        await visit(childNode)
        continue
      }

      if (name === 'lastRenderedPageBreak') {
        inlines.push(textNode('\n', { marks: [] }))
        continue
      }

      if (name === 'object' || name === 'oleObject' || name === 'subDoc') {
        addUnsupportedObjectWarning(context, name)
        continue
      }

      if (name === 'sdt') {
        const content = child(childNode, 'sdtContent')
        if (content) await visit(content)
        continue
      }

      if (name === 'r') {
        const drawing = child(childNode, 'drawing')
        if (drawing) {
          const image = await parseDrawing(drawing, context)
          if (image) {
            inlines.push({
              kind: 'inlineImage',
              image,
            })
          }
          continue
        }

        const pictImage = await parseLegacyVml(childNode, context)
        if (pictImage) {
          inlines.push({
            kind: 'inlineImage',
            image: pictImage,
          })
          continue
        }

        if (child(childNode, 'object')) {
          addUnsupportedObjectWarning(context, 'embedded')
          continue
        }

        inlines.push(...runToInlines(childNode))
        continue
      }

      if (name === 'hyperlink') {
        inlines.push(...parseInlineContainer(childNode, context))
      }
    }
  }

  await visit(paragraph)

  const hasImageInline = inlines.some((inline) => inline.kind === 'inlineImage')

  const splitInlinesForImages = (input: ImportedInline[]): ImportedBlock[] => {
    const blocks: ImportedBlock[] = []
    let pending: ImportedInline[] = []

    const flushText = (): void => {
      if (pending.length > 0) {
        const paragraphBlock: ImportedParagraph | ImportedHeading = headingLevel || levelFromOutline
          ? {
              kind: 'heading',
              level: (headingLevel ?? levelFromOutline ?? 1) as ImportedHeading['level'],
              inlines: pending,
              ...(style ? { style } : {}),
            }
          : { kind: 'paragraph', inlines: pending, ...(style ? { style } : {}) }
        blocks.push(paragraphBlock)
        pending = []
      }
    }

    for (const inline of input) {
      if (inline.kind === 'inlineImage') {
        flushText()
        blocks.push(inline.image)
      } else {
        pending.push(inline)
      }
    }

    flushText()
    if (blocks.length === 0 && !hasImageInline) {
      return [{ kind: 'paragraph', inlines: [], ...(style ? { style } : {}) }]
    }
    return blocks
  }

  if (numId) {
    return [{
      kind: 'listItem',
      inlines,
      level: Number.isFinite(ilvl) ? Math.max(0, ilvl) : 0,
      ordered,
      ...(style ? { style } : {}),
    }]
  }

  return splitInlinesForImages(inlines)
}

function parseTableCellProperties(
  tcPr: Element | null,
): Pick<ImportedTableCell, 'colSpan' | 'widthPx' | 'backgroundColor' | 'verticalAlign'> {
  const gridSpan = Number.parseInt(attr(child(tcPr, 'gridSpan'), 'val') ?? '1', 10)
  const fill = attr(child(tcPr, 'shd'), 'fill')
  const widthValue = attr(child(tcPr, 'tcW'), 'w')
  const widthType = attr(child(tcPr, 'tcW'), 'type') ?? 'dxa'
  const widthPx =
    widthValue && widthType === 'dxa'
      ? Math.round((Number.parseInt(widthValue, 10) / 20) * (96 / 72))
      : undefined
  const verticalAlign = attr(child(tcPr, 'vAlign'), 'val')

  return {
    ...(Number.isFinite(gridSpan) && gridSpan > 1 ? { colSpan: gridSpan } : {}),
    ...(widthPx && widthPx > 0 ? { widthPx } : {}),
    ...(fill && /^[0-9a-f]{6}$/i.test(fill) ? { backgroundColor: '#' + fill } : {}),
    ...(verticalAlign === 'top' || verticalAlign === 'center' || verticalAlign === 'bottom'
      ? { verticalAlign }
      : {}),
  }
}

function parseTableProperties(tblPr: Element | null): { widthPx?: number } {
  const value = attr(child(tblPr, 'tblW'), 'w')
  if (!value) return {}
  const unit = attr(child(tblPr, 'tblW'), 'type') ?? 'dxa'
  if (unit === 'dxa') return { widthPx: Math.round(Number.parseInt(value, 10) / 20 * 96 / 72) }
  return {}
}

async function parseTable(table: Element, context: ParserContext): Promise<ImportedTable> {
  const rows = [...table.children].filter((element) => local(element) === 'tr')
  const resultRows: ImportedTableCell[][] = []
  const activeVertical = new Map<number, ImportedTableCell>()

  for (const rowElement of rows) {
    const row: ImportedTableCell[] = []
    const continuedCells = new Set<ImportedTableCell>()
    const restartedCells = new Set<ImportedTableCell>()
    let column = 0

    for (const cellElement of children(rowElement, 'tc')) {
      const tcPr = child(cellElement, 'tcPr')
      const props = parseTableCellProperties(tcPr)
      const header = isTrue(child(child(rowElement, 'trPr'), 'tblHeader'))
      const vMerge = child(tcPr, 'vMerge')
      const mergeState = attr(vMerge, 'val') ?? (vMerge ? 'continue' : undefined)
      const colSpan = props.colSpan ?? 1

      if (mergeState === 'continue') {
        const previous = activeVertical.get(column)
        if (previous) {
          previous.rowSpan = (previous.rowSpan ?? 1) + 1
          continuedCells.add(previous)
          column += previous.colSpan ?? colSpan
          continue
        }
      }

      const previousAtColumn = activeVertical.get(column)
      if (previousAtColumn) {
        for (const [activeColumn, activeCell] of activeVertical) {
          if (activeCell === previousAtColumn) activeVertical.delete(activeColumn)
        }
      }

      const blocks = await parseBlockContainer(cellElement, context)
      if (blocks.length === 0) blocks.push({ kind: 'paragraph', inlines: [] })

      const cell: ImportedTableCell = {
        blocks,
        ...props,
        ...(header ? { header: true } : {}),
        ...(mergeState === 'restart' ? { rowSpan: 1 } : {}),
      }
      row.push(cell)

      if (mergeState === 'restart') {
        restartedCells.add(cell)
        for (let spanColumn = 0; spanColumn < colSpan; spanColumn += 1) {
          activeVertical.set(column + spanColumn, cell)
        }
      }

      column += colSpan
    }

    for (const [activeColumn, activeCell] of activeVertical) {
      if (!continuedCells.has(activeCell) && !restartedCells.has(activeCell)) {
        activeVertical.delete(activeColumn)
      }
    }

    resultRows.push(row)
  }

  return {
    kind: 'table',
    rows: resultRows,
    ...parseTableProperties(child(table, 'tblPr')),
  }
}

async function parseBlockContainer(
  container: Element,
  context: ParserContext,
): Promise<ImportedBlock[]> {
  const blocks: ImportedBlock[] = []

  for (const element of container.children) {
    const name = local(element)

    if (name === 'p') {
      blocks.push(...(await parseParagraph(element, context)))
      continue
    }

    if (name === 'tbl') {
      blocks.push(await parseTable(element, context))
      continue
    }

    if (name === 'sdt') {
      const content = child(element, 'sdtContent')
      if (content) blocks.push(...(await parseBlockContainer(content, context)))
      continue
    }

    if (name === 'customXml') {
      blocks.push(...(await parseBlockContainer(element, context)))
      continue
    }

    if (name === 'AlternateContent') {
      const fallback = child(element, 'Fallback')
      const choice = children(element, 'Choice')[0]
      const selected = fallback ?? choice
      if (selected) {
        blocks.push(...(await parseBlockContainer(selected, context)))
      } else {
        addUnsupportedObjectWarning(context, 'AlternateContent')
      }
    }
  }

  return blocks
}

function countStats(blocks: ImportedBlock[]): ImportedDocument['stats'] {
  let paragraphs = 0
  let headings = 0
  let lists = 0
  let images = 0
  let tables = 0

  const countInlines = (inlines: ImportedInline[]): void => {
    for (const inline of inlines) {
      if (inline.kind === 'inlineImage') images += 1
      else if (inline.kind === 'link') countInlines(inline.children)
    }
  }

  const walk = (items: ImportedBlock[]): void => {
    for (const block of items) {
      if (block.kind === 'paragraph') {
        paragraphs += 1
        countInlines(block.inlines)
      } else if (block.kind === 'heading') {
        headings += 1
        countInlines(block.inlines)
      } else if (block.kind === 'list') {
        lists += 1
        paragraphs += block.items.length
        for (const item of block.items) countInlines(item.inlines)
      } else if (block.kind === 'listItem') {
        paragraphs += 1
        countInlines(block.inlines)
      } else if (block.kind === 'image') {
        images += 1
      } else if (block.kind === 'table') {
        tables += 1
        for (const row of block.rows) for (const cell of row) walk(cell.blocks)
      }
    }
  }

  walk(blocks)

  return {
    paragraphs,
    headings,
    lists,
    images,
    tables,
    mediaBytes: 0,
    normalizedLineBreaks: 0,
    normalizedWideMedia: 0,
  }
}

export async function parseDocx(
  input: ArrayBuffer | Uint8Array,
  options?: { maxMediaBytes?: number },
): Promise<ImportedDocument> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength < 100) {
    throw new Error('The selected file is not a valid DOCX document')
  }

  const zip = new DocxZip(bytes)
  if (!zip.has('word/document.xml')) {
    throw new Error('The selected DOCX does not contain word/document.xml')
  }

  const relationships = parseRelationships(
    zip.has('word/_rels/document.xml.rels')
      ? await zip.readText('word/_rels/document.xml.rels', 2 * 1024 * 1024)
      : '',
  )
  const styles = parseStyles(
    zip.has('word/styles.xml')
      ? await zip.readText('word/styles.xml', 4 * 1024 * 1024)
      : '',
  )
  const numbering = parseNumbering(
    zip.has('word/numbering.xml')
      ? await zip.readText('word/numbering.xml', 4 * 1024 * 1024)
      : '',
  )
  const documentXml = parseXml(
    await zip.readText('word/document.xml', 12 * 1024 * 1024),
    'document.xml',
  )

  const context: ParserContext = {
    zip,
    relationships,
    styles,
    numbering,
    mediaByPath: new Map(),
    mediaBytes: 0,
    warnings: [],
    mediaLimitBytes: options?.maxMediaBytes ?? 50 * 1024 * 1024,
  }

  const body = [...documentXml.getElementsByTagNameNS(W_NS, 'body')][0]
  if (!body) throw new Error('The selected DOCX has no document body')

  const blocks = await parseBlockContainer(body, context)

  const stats = countStats(blocks)
  stats.mediaBytes = context.mediaBytes

  return {
    blocks,
    warnings: context.warnings,
    stats,
  }
}
