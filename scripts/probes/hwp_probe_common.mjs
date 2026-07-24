import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import * as CFB from 'cfb'

export const PROBE_SCHEMA_VERSION = 1
export const MAX_HWP_BYTES = 200 * 1024 * 1024
const HWP_SIGNATURE = 'HWP Document File'
const CFB_MAGIC = 'd0cf11e0a1b11ae1'

export class HwpProbeError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'HwpProbeError'
    this.code = code
  }
}

function headerVersion(content) {
  return [content[35], content[34], content[33], content[32]].join('.')
}

function headerFlags(content) {
  const value = content.readUInt32LE(36)
  return {
    compressed: Boolean(value & (1 << 0)),
    encrypted: Boolean(value & (1 << 1)),
    distribution: Boolean(value & (1 << 2)),
    containsScripts: Boolean(value & (1 << 3)),
    drm: Boolean(value & (1 << 4))
  }
}

export async function inspectHwpContainer(filePath) {
  const info = await stat(filePath)
  if (!info.isFile()) throw new HwpProbeError('NOT_A_FILE', '입력이 일반 파일이 아닙니다.')
  if (info.size === 0) throw new HwpProbeError('EMPTY_INPUT', '빈 파일은 검사할 수 없습니다.')
  if (info.size > MAX_HWP_BYTES) {
    throw new HwpProbeError('FILE_TOO_LARGE', `HWP probe 상한 ${MAX_HWP_BYTES}바이트를 넘었습니다.`)
  }

  const bytes = await readFile(filePath)
  if (bytes.subarray(0, 8).toString('hex') !== CFB_MAGIC) {
    throw new HwpProbeError('NOT_CFB', 'CFB/OLE magic이 일치하지 않습니다.')
  }

  let container
  try {
    container = CFB.read(bytes, { type: 'buffer' })
  } catch {
    throw new HwpProbeError('CORRUPTED_CFB', 'CFB 컨테이너를 읽을 수 없습니다.')
  }

  const fileHeader = CFB.find(container, 'FileHeader')
  if (!fileHeader?.content || fileHeader.content.length < 40) {
    throw new HwpProbeError('MISSING_FILE_HEADER', 'HWP FileHeader가 없거나 너무 짧습니다.')
  }
  const signature = fileHeader.content.subarray(0, 32).toString('ascii').replace(/\0+$/, '')
  if (signature !== HWP_SIGNATURE) {
    throw new HwpProbeError('NOT_HWP_5', 'HWP 5.0 FileHeader signature가 일치하지 않습니다.')
  }

  const streamSizes = container.FileIndex
    .filter((entry) => entry.type === 2 && entry.content)
    .map((entry) => entry.content.length)

  return {
    bytes,
    input: {
      format: 'hwp5',
      sizeBytes: info.size,
      sha256Prefix: createHash('sha256').update(bytes).digest('hex').slice(0, 12)
    },
    container: {
      version: headerVersion(fileHeader.content),
      flags: headerFlags(fileHeader.content),
      streamCount: streamSizes.length,
      totalStoredBytes: streamSizes.reduce((sum, size) => sum + size, 0),
      largestStreamBytes: Math.max(0, ...streamSizes)
    }
  }
}

export function safeError(error) {
  return {
    code: error instanceof HwpProbeError ? error.code : 'PROBE_FAILED',
    message: error instanceof HwpProbeError ? error.message : '후보 probe 실행에 실패했습니다.'
  }
}

export function probeEnvelope(engine, engineVersion, preflight, result, timings) {
  return {
    schemaVersion: PROBE_SCHEMA_VERSION,
    engine,
    engineVersion,
    input: preflight.input,
    container: preflight.container,
    timings,
    result
  }
}

export function outputProbe(label, payload) {
  process.stdout.write(`${label} ${JSON.stringify(payload)}\n`)
}
