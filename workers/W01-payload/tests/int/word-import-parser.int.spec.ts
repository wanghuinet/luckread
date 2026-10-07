import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { parseDocx } from '../../src/features/word-import/docx-parser.js'
import { DocxZip } from '../../src/features/word-import/zip.js'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 * (crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer).setUint16(offset, value, true)
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer).setUint32(offset, value >>> 0, true)
}

async function makeDeclaredSmallDeflatedZip(name: string, data: Uint8Array, declaredSize: number): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream is unavailable in this test environment')
  }

  const compressed = new Uint8Array(deflateRawSync(data))
  const encoder = new TextEncoder()
  const nameBytes = encoder.encode(name)
  const crc = crc32(data)

  const local = new Uint8Array(30 + nameBytes.length + compressed.length)
  writeU32(local, 0, 0x04034b50)
  writeU16(local, 4, 20)
  writeU16(local, 6, 0x800)
  writeU16(local, 8, 8)
  writeU32(local, 14, crc)
  writeU32(local, 18, compressed.length)
  writeU32(local, 22, declaredSize)
  writeU16(local, 26, nameBytes.length)
  local.set(nameBytes, 30)
  local.set(compressed, 30 + nameBytes.length)

  const central = new Uint8Array(46 + nameBytes.length)
  writeU32(central, 0, 0x02014b50)
  writeU16(central, 4, 20)
  writeU16(central, 6, 20)
  writeU16(central, 8, 0x800)
  writeU16(central, 10, 8)
  writeU32(central, 16, crc)
  writeU32(central, 20, compressed.length)
  writeU32(central, 24, declaredSize)
  writeU16(central, 28, nameBytes.length)
  writeU32(central, 42, 0)
  central.set(nameBytes, 46)

  const eocd = new Uint8Array(22)
  writeU32(eocd, 0, 0x06054b50)
  writeU16(eocd, 8, 1)
  writeU16(eocd, 10, 1)
  writeU32(eocd, 12, central.length)
  writeU32(eocd, 16, local.length)

  const result = new Uint8Array(local.length + central.length + eocd.length)
  result.set(local, 0)
  result.set(central, local.length)
  result.set(eocd, local.length + central.length)
  return result
}

function makeStoredZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder()
  const entries: Array<{
    data: Uint8Array
    local: Uint8Array
    central: Uint8Array
  }> = []

  let offset = 0

  for (const [name, value] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const data = typeof value === 'string' ? encoder.encode(value) : value
    const crc = crc32(data)

    const local = new Uint8Array(30 + nameBytes.length + data.length)
    writeU32(local, 0, 0x04034b50)
    writeU16(local, 4, 20)
    writeU16(local, 6, 0x800)
    writeU16(local, 8, 0)
    writeU16(local, 10, 0)
    writeU16(local, 12, 0)
    writeU32(local, 14, crc)
    writeU32(local, 18, data.length)
    writeU32(local, 22, data.length)
    writeU16(local, 26, nameBytes.length)
    writeU16(local, 28, 0)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)

    const central = new Uint8Array(46 + nameBytes.length)
    writeU32(central, 0, 0x02014b50)
    writeU16(central, 4, 20)
    writeU16(central, 6, 20)
    writeU16(central, 8, 0x800)
    writeU16(central, 10, 0)
    writeU16(central, 12, 0)
    writeU16(central, 14, 0)
    writeU32(central, 16, crc)
    writeU32(central, 20, data.length)
    writeU32(central, 24, data.length)
    writeU16(central, 28, nameBytes.length)
    writeU16(central, 30, 0)
    writeU16(central, 32, 0)
    writeU16(central, 34, 0)
    writeU16(central, 36, 0)
    writeU32(central, 38, 0)
    writeU32(central, 42, offset)
    central.set(nameBytes, 46)

    entries.push({ data, local, central })
    offset += local.length
  }

  const centralOffset = offset
  const centralSize = entries.reduce((sum, entry) => sum + entry.central.length, 0)

  const eocd = new Uint8Array(22)
  writeU32(eocd, 0, 0x06054b50)
  writeU16(eocd, 4, 0)
  writeU16(eocd, 6, 0)
  writeU16(eocd, 8, entries.length)
  writeU16(eocd, 10, entries.length)
  writeU32(eocd, 12, centralSize)
  writeU32(eocd, 16, centralOffset)
  writeU16(eocd, 20, 0)

  const result = new Uint8Array(centralOffset + centralSize + eocd.length)
  let cursor = 0
  for (const entry of entries) {
    result.set(entry.local, cursor)
    cursor += entry.local.length
  }
  for (const entry of entries) {
    result.set(entry.central, cursor)
    cursor += entry.central.length
  }
  result.set(eocd, cursor)
  return result
}

const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr><w:u w:val="none"/></w:rPr>
        <w:t>No underline</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:t>Numbered</w:t></w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="1905000" cy="952500"/>
            <wp:docPr id="1" descr="Accessible image"/>
            <a:graphic><a:graphicData><a:blip r:embed="rId1"/></a:graphicData></a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p>
      <w:r><w:object><w:dummy/></w:object></w:r>
    </w:p>
    <w:p>
      <mc:AlternateContent>
        <mc:Choice Requires="wps"><w:r><w:t>Choice</w:t></w:r></mc:Choice>
        <mc:Fallback><w:r><w:t>Fallback content</w:t></w:r></mc:Fallback>
      </mc:AlternateContent>
      <w:fldSimple w:instr="PAGE"><w:r><w:t>7</w:t></w:r></w:fldSimple>
    </w:p>
    <w:tbl>
      <w:tr><w:trPr><w:tblHeader w:val="0"/></w:trPr><w:tc>
        <w:p><w:r><w:t>outer</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`

const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`

const numberingXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="${W_NS}">
  <w:abstractNum w:abstractNumId="10">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="10"/>
    <w:lvlOverride w:ilvl="0"><w:lvl><w:numFmt w:val="decimal"/></w:lvl></w:lvlOverride>
  </w:num>
</w:numbering>`

describe('DOCX parser compatibility', () => {
  it('preserves DrawingML metadata, numbering overrides, nested tables and skip warnings', async () => {
    const input = makeStoredZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': documentXml,
      'word/_rels/document.xml.rels': relsXml,
      'word/numbering.xml': numberingXml,
      'word/media/image1.png': new Uint8Array([137, 80, 78, 71]),
    })

    const result = await parseDocx(input)

    expect(result.blocks[0]).toMatchObject({
      kind: 'paragraph',
      inlines: [{ kind: 'text', text: 'No underline', marks: [] }],
    })

    expect(result.blocks[1]).toMatchObject({
      kind: 'listItem',
      ordered: true,
      level: 0,
    })

    expect(result.blocks[2]).toMatchObject({
      kind: 'image',
      widthPx: 200,
      heightPx: 100,
      alt: 'Accessible image',
      mediaKey: 'word/media/image1.png',
    })

    expect(result.warnings).toContainEqual({
      code: 'UNSUPPORTED_OBJECT',
      message: 'A Word embedded object was skipped during import.',
    })

    expect(result.blocks[4]).toMatchObject({
      kind: 'paragraph',
      inlines: [
        { kind: 'text', text: 'Fallback content' },
        { kind: 'text', text: '7' },
      ],
    })

    const table = result.blocks[5]
    expect(table?.kind).toBe('table')
    if (table?.kind === 'table') {
      expect(table.rows[0]?.[0]?.blocks[0]).toMatchObject({ kind: 'paragraph' })
      expect(table.rows[0]?.[0]?.blocks[1]).toMatchObject({ kind: 'table' })
    }
  })

  it('skips unsanitized SVG media with an explicit warning', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="952500" cy="952500"/>
            <wp:docPr id="3" descr="Unsafe SVG"/>
            <a:graphic><a:graphicData><a:blip r:embed="rIdSvg"/></a:graphicData></a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`

    const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdSvg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.svg"/>
</Relationships>`

    const result = await parseDocx(makeStoredZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': xml,
      'word/_rels/document.xml.rels': rels,
      'word/media/image1.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    }))

    expect(result.blocks[0]).toMatchObject({
      kind: 'paragraph',
      inlines: [],
    })
    expect(result.warnings).toContainEqual({
      code: 'SKIPPED_MEDIA',
      message: 'SVG Word images were skipped because this importer does not sanitize SVG content.',
    })
  })


  it('rejects DOCX packages with an excessive ZIP entry count', async () => {
    const input = new Uint8Array(122)
    const view = new DataView(input.buffer)
    const eocdOffset = 100

    view.setUint32(eocdOffset, 0x06054b50, true)
    view.setUint16(eocdOffset + 10, 4097, true)

    await expect(parseDocx(input)).rejects.toThrow('DOCX contains too many ZIP entries')
  })

  it('rejects DOCX input above the 50 MB safety limit before ZIP parsing', async () => {
    const input = new Uint8Array(50 * 1024 * 1024 + 1)

    expect(() => new DocxZip(input)).toThrow('DOCX input exceeds the 50 MB safety limit')
  })

  it('caps actual decompressed output even when ZIP metadata declares a smaller size', async () => {
    const payload = new Uint8Array(8 * 1024).fill(65)
    const zipBytes = await makeDeclaredSmallDeflatedZip('payload.bin', payload, 1)
    const zip = new DocxZip(zipBytes)

    await expect(zip.read('payload.bin', 1024)).rejects.toThrow(
      'DOCX entry exceeds the safety size limit after decompression',
    )
  })

  it('rejects stored DOCX entries whose declared size does not match actual bytes', async () => {
    const payload = new Uint8Array([1, 2, 3, 4])
    const zipBytes = makeStoredZip({ 'payload.bin': payload })
    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength)
    const eocdOffset = zipBytes.byteLength - 22
    const centralOffset = view.getUint32(eocdOffset + 16, true)
    view.setUint32(centralOffset + 24, 1, true)

    const zip = new DocxZip(zipBytes)
    await expect(zip.read('payload.bin')).rejects.toThrow('DOCX ZIP entry size mismatch: payload.bin')
  })



  it('keeps images embedded in numbered Word paragraphs inside the list item', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:t>before</w:t></w:r>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="952500" cy="952500"/>
            <wp:docPr id="4" descr="List image"/>
            <a:graphic><a:graphicData><a:blip r:embed="rIdListImage"/></a:graphicData></a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
      <w:r><w:t>after</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`

    const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdListImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/list.png"/>
</Relationships>`

    const result = await parseDocx(makeStoredZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': xml,
      'word/_rels/document.xml.rels': rels,
      'word/media/list.png': new Uint8Array([137, 80, 78, 71]),
    }))

    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0]).toMatchObject({
      kind: 'listItem',
      level: 0,
      inlines: [
        { kind: 'text', text: 'before' },
        { kind: 'inlineImage', image: { mediaKey: 'word/media/list.png', alt: 'List image' } },
        { kind: 'text', text: 'after' },
      ],
    })
    expect(result.stats.images).toBe(1)
  })



})
