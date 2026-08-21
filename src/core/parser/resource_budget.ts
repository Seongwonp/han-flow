export interface XmlResourceLimits {
  maxDepth: number
  maxNodes: number
  maxTextCharacters: number
}

export const XML_RESOURCE_LIMITS: XmlResourceLimits = {
  maxDepth: 256,
  maxNodes: 1_000_000,
  maxTextCharacters: 50_000_000
}

function xmlBudgetError(message: string): never {
  throw new Error(`안전하지 않은 HWPX XML입니다: ${message}`)
}

function findMarkupEnd(xml: string, start: number): number {
  let quote = ''
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index
    }
  }
  return -1
}

export function validateXmlResourceBudget(
  input: Buffer | string,
  limits: XmlResourceLimits = XML_RESOURCE_LIMITS
): string {
  const xml = Buffer.isBuffer(input) ? input.toString('utf8') : input
  let depth = 0
  let nodes = 0
  let textCharacters = 0
  let index = 0

  const addNode = (): void => {
    nodes += 1
    if (nodes > limits.maxNodes) {
      xmlBudgetError(`node 수가 제한(${limits.maxNodes})을 초과합니다.`)
    }
  }

  const addText = (length: number): void => {
    if (length > 0) addNode()
    textCharacters += length
    if (textCharacters > limits.maxTextCharacters) {
      xmlBudgetError(`text 크기가 제한(${limits.maxTextCharacters}자)을 초과합니다.`)
    }
  }

  while (index < xml.length) {
    const markupStart = xml.indexOf('<', index)
    if (markupStart < 0) {
      addText(xml.length - index)
      break
    }
    addText(markupStart - index)

    if (xml.startsWith('<!--', markupStart)) {
      const end = xml.indexOf('-->', markupStart + 4)
      if (end < 0) xmlBudgetError('끝나지 않은 주석이 있습니다.')
      index = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', markupStart)) {
      const end = xml.indexOf(']]>', markupStart + 9)
      if (end < 0) xmlBudgetError('끝나지 않은 CDATA가 있습니다.')
      addText(end - (markupStart + 9))
      index = end + 3
      continue
    }
    if (xml.startsWith('<?', markupStart)) {
      const end = xml.indexOf('?>', markupStart + 2)
      if (end < 0) xmlBudgetError('끝나지 않은 처리 지시문이 있습니다.')
      index = end + 2
      continue
    }
    if (xml.slice(markupStart, markupStart + 9).toUpperCase() === '<!DOCTYPE') {
      xmlBudgetError('DOCTYPE 선언을 허용하지 않습니다.')
    }
    if (xml.startsWith('<!', markupStart)) {
      xmlBudgetError('지원하지 않는 XML 선언이 있습니다.')
    }

    const end = findMarkupEnd(xml, markupStart + 1)
    if (end < 0) xmlBudgetError('끝나지 않은 태그가 있습니다.')
    const body = xml.slice(markupStart + 1, end).trim()
    if (!body) xmlBudgetError('이름이 없는 태그가 있습니다.')

    if (body.startsWith('/')) {
      depth -= 1
      if (depth < 0) xmlBudgetError('닫는 태그의 깊이가 올바르지 않습니다.')
    } else {
      addNode()
      if (!body.endsWith('/')) {
        depth += 1
        if (depth > limits.maxDepth) {
          xmlBudgetError(`깊이가 제한(${limits.maxDepth})을 초과합니다.`)
        }
      }
    }
    index = end + 1
  }

  if (depth !== 0) xmlBudgetError('태그 깊이가 닫히지 않았습니다.')
  return xml
}

export interface ImageResourceLimits {
  maxCount: number
  maxBytesPerResource: number
  maxTotalBytes: number
  maxDimension: number
  maxPixelsPerImage: number
  maxTotalPixels: number
}

export const IMAGE_RESOURCE_LIMITS: ImageResourceLimits = {
  maxCount: 2_000,
  maxBytesPerResource: 32 * 1024 * 1024,
  maxTotalBytes: 192 * 1024 * 1024,
  maxDimension: 32_768,
  maxPixelsPerImage: 40_000_000,
  maxTotalPixels: 160_000_000
}

interface ImageDimensions {
  width: number
  height: number
}

function readUint24Le(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function pngDimensions(bytes: Buffer): ImageDimensions | undefined {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return undefined
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function jpegDimensions(bytes: Buffer): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return undefined
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return undefined
    if (startOfFrame.has(marker) && length >= 7) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  return undefined
}

function gifDimensions(bytes: Buffer): ImageDimensions | undefined {
  const signature = bytes.subarray(0, 6).toString('ascii')
  if (bytes.length < 10 || (signature !== 'GIF87a' && signature !== 'GIF89a')) return undefined
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
}

function bmpDimensions(bytes: Buffer): ImageDimensions | undefined {
  if (bytes.length < 22 || bytes.subarray(0, 2).toString('ascii') !== 'BM') return undefined
  const dibHeaderSize = bytes.readUInt32LE(14)
  if (dibHeaderSize === 12) {
    return { width: bytes.readUInt16LE(18), height: bytes.readUInt16LE(20) }
  }
  if (dibHeaderSize < 40 || bytes.length < 26) return undefined
  return { width: Math.abs(bytes.readInt32LE(18)), height: Math.abs(bytes.readInt32LE(22)) }
}

function webpDimensions(bytes: Buffer): ImageDimensions | undefined {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return undefined
  const kind = bytes.subarray(12, 16).toString('ascii')
  if (kind === 'VP8X') return { width: readUint24Le(bytes, 24) + 1, height: readUint24Le(bytes, 27) + 1 }
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  }
  return undefined
}

function rasterDimensions(path: string, bytes: Buffer): ImageDimensions | undefined {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'png') return pngDimensions(bytes)
  if (extension === 'jpg' || extension === 'jpeg') return jpegDimensions(bytes)
  if (extension === 'gif') return gifDimensions(bytes)
  if (extension === 'bmp') return bmpDimensions(bytes)
  if (extension === 'webp') return webpDimensions(bytes)
  return undefined
}

const dimensionCheckedExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'])

export class ImageResourceBudget {
  private count = 0
  private totalBytes = 0
  private totalPixels = 0

  constructor(private readonly limits: ImageResourceLimits = IMAGE_RESOURCE_LIMITS) {}

  add(path: string, bytes: Buffer): void {
    this.count += 1
    if (this.count > this.limits.maxCount) this.fail(`개수가 제한(${this.limits.maxCount})을 초과합니다.`)
    if (bytes.byteLength > this.limits.maxBytesPerResource) {
      this.fail(`개별 크기가 제한(${this.limits.maxBytesPerResource} bytes)을 초과합니다: ${path}`)
    }
    this.totalBytes += bytes.byteLength
    if (this.totalBytes > this.limits.maxTotalBytes) {
      this.fail(`전체 크기가 제한(${this.limits.maxTotalBytes} bytes)을 초과합니다.`)
    }

    const extension = path.split('.').pop()?.toLowerCase() ?? ''
    const dimensions = rasterDimensions(path, bytes)
    if (dimensionCheckedExtensions.has(extension) && !dimensions) {
      this.fail(`이미지 header가 올바르지 않습니다: ${path}`)
    }
    if (!dimensions) return
    const { width, height } = dimensions
    if (width < 1 || height < 1 || width > this.limits.maxDimension || height > this.limits.maxDimension) {
      this.fail(`이미지 가로·세로가 제한(${this.limits.maxDimension}px)을 벗어납니다: ${path}`)
    }
    const pixels = width * height
    if (!Number.isSafeInteger(pixels) || pixels > this.limits.maxPixelsPerImage) {
      this.fail(`이미지 decoded pixel 수가 제한(${this.limits.maxPixelsPerImage})을 초과합니다: ${path}`)
    }
    this.totalPixels += pixels
    if (!Number.isSafeInteger(this.totalPixels) || this.totalPixels > this.limits.maxTotalPixels) {
      this.fail(`전체 이미지 decoded pixel 수가 제한(${this.limits.maxTotalPixels})을 초과합니다.`)
    }
  }

  private fail(message: string): never {
    throw new Error(`안전하지 않은 HWPX 이미지 resource입니다: ${message}`)
  }
}
