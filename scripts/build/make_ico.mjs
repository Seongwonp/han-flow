// build/icon.png(정사각 8-bit RGB/RGBA, non-interlaced)에서 build/icon.ico를 결정적으로 생성한다.
// 외부 의존성 없이 node:zlib만 쓴다. 256px은 PNG entry(Vista+), 128px 이하는 32bpp BMP(DIB) entry로
// 넣어 rcedit·NSIS·구형 Explorer 모두 읽을 수 있게 한다.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as zlib from 'node:zlib'

const sizes = [256, 128, 64, 48, 32, 16]
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const input = resolve(process.argv[2] ?? 'build/icon.png')
const output = resolve(process.argv[3] ?? 'build/icon.ico')

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(pngSignature)) throw new Error('PNG signature가 아닙니다.')
  let offset = 8
  let header
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12]
      }
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (!header) throw new Error('IHDR가 없습니다.')
  const { width, height, bitDepth, colorType, interlace } = header
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`지원하지 않는 PNG 형식: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`)
  }
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(width * height * 4)
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0
      const up = previous[x]
      const upLeft = x >= channels ? previous[x - channels] : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      } else if (filter !== 0) throw new Error(`알 수 없는 PNG filter ${filter}`)
      line[x] = (line[x] + predictor) & 0xff
    }
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4
      pixels[target] = line[x * channels]
      pixels[target + 1] = line[x * channels + 1]
      pixels[target + 2] = line[x * channels + 2]
      pixels[target + 3] = channels === 4 ? line[x * channels + 3] : 255
    }
    previous = line
  }
  return { width, height, pixels }
}

// premultiplied alpha로 면적 가중 평균(box filter). 배율이 정수가 아니어도 결정적이다.
function resize(image, size) {
  const { width, height, pixels } = image
  const out = Buffer.alloc(size * size * 4)
  const scaleX = width / size
  const scaleY = height / size
  for (let oy = 0; oy < size; oy += 1) {
    const y0 = oy * scaleY
    const y1 = y0 + scaleY
    for (let ox = 0; ox < size; ox += 1) {
      const x0 = ox * scaleX
      const x1 = x0 + scaleX
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let area = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy)
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const weight = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx))
          const index = (sy * width + sx) * 4
          const alpha = pixels[index + 3] * weight
          r += pixels[index] * alpha
          g += pixels[index + 1] * alpha
          b += pixels[index + 2] * alpha
          a += alpha
          area += weight
        }
      }
      const target = (oy * size + ox) * 4
      if (a > 0) {
        out[target] = Math.round(r / a)
        out[target + 1] = Math.round(g / a)
        out[target + 2] = Math.round(b / a)
      }
      out[target + 3] = Math.round(a / area)
    }
  }
  return out
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

// Node 22.2+는 native zlib.crc32를 제공한다. 없는 runtime에서는 같은 다항식의 JS 구현으로 물러선다.
function crc32(buffer) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer) >>> 0
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    pngSignature,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// BITMAPINFOHEADER + bottom-up BGRA + 1bpp AND mask(32bit 행 정렬).
function encodeDib(pixels, size) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  const maskStride = Math.ceil(size / 32) * 4
  header.writeUInt32LE(size * size * 4 + maskStride * size, 20)
  const color = Buffer.alloc(size * size * 4)
  const mask = Buffer.alloc(maskStride * size)
  for (let y = 0; y < size; y += 1) {
    const row = size - 1 - y
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 4
      const target = (row * size + x) * 4
      color[target] = pixels[source + 2]
      color[target + 1] = pixels[source + 1]
      color[target + 2] = pixels[source]
      color[target + 3] = pixels[source + 3]
      if (pixels[source + 3] === 0) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return Buffer.concat([header, color, mask])
}

const image = decodePng(await readFile(input))
if (image.width !== image.height || image.width < 256) {
  throw new Error(`256px 이상 정사각 PNG가 필요합니다: ${image.width}x${image.height}`)
}

const images = sizes.map((size) => {
  const pixels = resize(image, size)
  return { size, data: size >= 256 ? encodePng(pixels, size) : encodeDib(pixels, size) }
})

const directory = Buffer.alloc(6 + 16 * images.length)
directory.writeUInt16LE(0, 0)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(images.length, 4)
let dataOffset = directory.length
images.forEach(({ size, data }, index) => {
  const entry = 6 + index * 16
  directory[entry] = size >= 256 ? 0 : size
  directory[entry + 1] = size >= 256 ? 0 : size
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(data.length, entry + 8)
  directory.writeUInt32LE(dataOffset, entry + 12)
  dataOffset += data.length
})

const ico = Buffer.concat([directory, ...images.map(({ data }) => data)])
await writeFile(output, ico)
console.log(`${output}: ${sizes.join('/')}px, ${ico.length} bytes`)
