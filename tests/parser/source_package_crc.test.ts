import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { crc32, crc32Fallback, HwpxSourcePackage } from '../../src/core/parser/source_package'
import * as generators from '../fixtures/public/create_synthetic_hwpx'

// ZIP entry CRC-32: `withEntry`가 쓰는 native `zlib.crc32`가 전환 전 byte 단위 JS 구현(`crc32Fallback`)과 같은 값을 내는지,
// 그리고 공개 fixture의 모든 entry에서 ZIP central directory에 기록된 CRC와 같은지 확인한다.

interface ManifestFixture {
  id: string
  source?: 'generator' | 'file'
  generator?: string
  fileName?: string
  file?: string
  options?: Record<string, unknown>
  expected: { outcome: string }
}

const publicRoot = join(__dirname, '../fixtures/public')
const manifest = JSON.parse(
  readFileSync(join(publicRoot, 'hwpx_corpus_manifest.json'), 'utf8')
) as { fixtures: ManifestFixture[] }
const openedFixtures = manifest.fixtures.filter((fixture) => fixture.expected.outcome === 'opened')

/** 결정적 의사 난수(xorshift32). */
function randomBytes(seed: number, length: number): Buffer {
  const bytes = Buffer.alloc(length)
  let state = seed >>> 0 || 1
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state & 0xff
  }
  return bytes
}

describe('ZIP entry CRC-32', () => {
  test('이 runtime은 native zlib.crc32를 제공한다(Node 22.2+, Electron 44의 Node 24)', () => {
    expect(typeof (require('zlib') as { crc32?: unknown }).crc32).toBe('function')
  })

  test('알려진 값과 같다', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0)
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32Fallback(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toBe(0xffffffff)
  })

  test('무작위 buffer(빈 것부터 1 MiB, offset 있는 view 포함)에서 전환 전 JS 구현과 같다', () => {
    const lengths = [0, 1, 2, 3, 7, 8, 15, 16, 63, 64, 255, 256, 1_000, 4_096, 65_537, 1_048_576]
    for (const [index, length] of lengths.entries()) {
      for (let seed = 1; seed <= 8; seed += 1) {
        const bytes = randomBytes(seed * 7919 + index, length)
        const expected = crc32Fallback(bytes)
        expect(crc32(bytes)).toBe(expected)
        // 큰 ArrayBuffer 안 일부를 가리키는 view(Buffer.subarray)도 그 범위만 계산한다.
        const padded = Buffer.concat([randomBytes(seed, 5), bytes, randomBytes(seed + 1, 3)])
        expect(crc32(padded.subarray(5, 5 + length))).toBe(expected)
      }
    }
  })

  test('zlib.crc32가 없는 runtime에서는 JS 구현으로 물러선다', () => {
    jest.isolateModules(() => {
      jest.doMock('zlib', () => {
        const actual = jest.requireActual('zlib') as Record<string, unknown>
        const { crc32: _native, ...withoutCrc32 } = actual
        return withoutCrc32
      })
      expect((require('zlib') as { crc32?: unknown }).crc32).toBeUndefined()
      const isolated = require('../../src/core/parser/source_package') as typeof import('../../src/core/parser/source_package')
      const bytes = randomBytes(42, 10_000)
      expect(isolated.crc32(bytes)).toBe(crc32Fallback(bytes))
      expect(isolated.crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    })
    jest.dontMock('zlib')
  })

  describe('공개 fixture entry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'han-flow-crc-'))
    const fixturePath = (fixture: ManifestFixture): string => {
      if (fixture.source === 'file') return join(publicRoot, fixture.file!)
      const create = (generators as unknown as Record<string, (directory: string, options?: unknown) => string>)[
        fixture.generator!
      ]
      return create(directory, fixture.options ?? fixture.fileName)
    }
    let entries = 0

    afterAll(() => rmSync(directory, { recursive: true, force: true }))

    test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
      '%s: 모든 file entry의 CRC가 ZIP 기록·JS 구현과 같고 withEntry가 같은 값을 기록한다',
      async (_id, fixture) => {
        const sourcePackage = await HwpxSourcePackage.open(fixturePath(fixture))
        for (const entry of sourcePackage.listEntries()) {
          if (entry.type !== 'file') continue
          const bytes = sourcePackage.readEntry(entry.path)
          expect([entry.path, crc32(bytes)]).toEqual([entry.path, entry.crc32])
          expect(crc32Fallback(bytes)).toBe(entry.crc32)
          entries += 1
        }
        const index = await sourcePackage.index()
        const sectionPath = index.sectionPaths[0]
        const changed = Buffer.concat([sourcePackage.readEntry(sectionPath), Buffer.from('\n')])
        const edited = sourcePackage.withEntry(sectionPath, changed)
        expect(edited.listEntries().find((entry) => entry.path === sectionPath)?.crc32).toBe(crc32Fallback(changed))
      },
      60_000
    )

    test('공개 fixture entry를 모두 확인했다', () => {
      expect(entries).toBeGreaterThan(openedFixtures.length * 3)
    })
  })
})
