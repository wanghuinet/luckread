const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50

export interface ZipEntry {
  name: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  flags: number
}

export const MAX_DOCX_ENTRY_BYTES = 32 * 1024 * 1024
export const MAX_DOCX_INPUT_BYTES = 50 * 1024 * 1024
export const MAX_DOCX_ENTRIES = 4096

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 0x10000 - 22)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset
    }
  }

  throw new Error('Invalid DOCX: ZIP end-of-central-directory record not found')
}

function readUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function sliceView(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error('Invalid DOCX: ZIP entry exceeds input bounds')
  }
  return bytes.subarray(offset, offset + length)
}

async function inflateRaw(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support DOCX deflate decompression')
  }

  const source = new Response(bytes as BodyInit).body
  if (!source) {
    throw new Error('This browser does not provide a DOCX decompression input stream')
  }

  const stream = source.pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      totalBytes += next.value.byteLength
      if (totalBytes > maxBytes) {
        throw new Error('DOCX entry exceeds the safety size limit after decompression')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export class DocxZip {
  private readonly bytes: Uint8Array
  private readonly entries = new Map<string, ZipEntry>()

  constructor(bytes: Uint8Array) {
    if (bytes.byteLength > MAX_DOCX_INPUT_BYTES) {
      throw new Error('DOCX input exceeds the 50 MB safety limit')
    }
    this.bytes = bytes
    this.readCentralDirectory()
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  get(name: string): ZipEntry | undefined {
    return this.entries.get(name)
  }

  list(prefix = ''): ZipEntry[] {
    return [...this.entries.values()].filter((entry) => entry.name.startsWith(prefix))
  }

  async read(name: string, maxBytes = MAX_DOCX_ENTRY_BYTES): Promise<Uint8Array> {
    const entry = this.entries.get(name)
    if (!entry) throw new Error('DOCX entry not found: ' + name)
    if (entry.flags & 0x1) throw new Error('Encrypted DOCX files are not supported')
    if (entry.uncompressedSize > maxBytes) {
      throw new Error('DOCX entry exceeds the safety size limit: ' + name)
    }

    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)
    const localOffset = entry.localHeaderOffset

    if (view.getUint32(localOffset, true) !== LOCAL_FILE_SIGNATURE) {
      throw new Error('Invalid DOCX local file header: ' + name)
    }

    const nameLength = view.getUint16(localOffset + 26, true)
    const extraLength = view.getUint16(localOffset + 28, true)
    const dataOffset = localOffset + 30 + nameLength + extraLength
    const compressed = sliceView(this.bytes, dataOffset, entry.compressedSize)

    if (entry.compressionMethod === 0) {
      if (compressed.byteLength !== entry.uncompressedSize) {
        throw new Error('DOCX ZIP entry size mismatch: ' + name)
      }
      return new Uint8Array(compressed)
    }
    if (entry.compressionMethod === 8) {
      const inflated = await inflateRaw(compressed, maxBytes)
      if (inflated.byteLength !== entry.uncompressedSize) {
        throw new Error('DOCX ZIP entry size mismatch: ' + name)
      }
      return inflated
    }

    throw new Error('Unsupported DOCX ZIP compression method: ' + entry.compressionMethod)
  }

  async readText(name: string, maxBytes = 8 * 1024 * 1024): Promise<string> {
    return readUtf8(await this.read(name, maxBytes))
  }

  private readCentralDirectory(): void {
    const eocd = findEndOfCentralDirectory(this.bytes)
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)

    const diskNumber = view.getUint16(eocd + 4, true)
    const centralDisk = view.getUint16(eocd + 6, true)
    if (diskNumber !== 0 || centralDisk !== 0) {
      throw new Error('Multi-disk DOCX files are not supported')
    }

    const totalEntries = view.getUint16(eocd + 10, true)
    if (totalEntries > MAX_DOCX_ENTRIES) {
      throw new Error('DOCX contains too many ZIP entries')
    }
    const centralSize = view.getUint32(eocd + 12, true)
    const centralOffset = view.getUint32(eocd + 16, true)

    if (centralOffset + centralSize > this.bytes.length) {
      throw new Error('Invalid DOCX central directory bounds')
    }

    let offset = centralOffset
    for (let index = 0; index < totalEntries; index += 1) {
      if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
        throw new Error('Invalid DOCX central directory entry')
      }

      const flags = view.getUint16(offset + 8, true)
      const compressionMethod = view.getUint16(offset + 10, true)
      const compressedSize = view.getUint32(offset + 20, true)
      const uncompressedSize = view.getUint32(offset + 24, true)
      const nameLength = view.getUint16(offset + 28, true)
      const extraLength = view.getUint16(offset + 30, true)
      const commentLength = view.getUint16(offset + 32, true)
      const localHeaderOffset = view.getUint32(offset + 42, true)

      const name = readUtf8(sliceView(this.bytes, offset + 46, nameLength))
      this.entries.set(name, {
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        flags,
      })

      offset += 46 + nameLength + extraLength + commentLength
    }
  }
}
