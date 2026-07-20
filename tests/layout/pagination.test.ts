import { existsSync } from 'fs'
import { resolve } from 'path'
import { paginateDocument } from '../../src/core/layout/pagination'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'

const fixture = resolve(__dirname, '../fixtures/private/m1-weekly.hwpx')
const privateTest = existsSync(fixture) ? test : test.skip

describe('AIDA block pagination', () => {
  privateTest('페이지 경계 표를 행 단위로 나눠 8페이지를 구성한다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(fixture))
    const pages = paginateDocument(document)
    expect(pages).toHaveLength(8)
    expect(pages.every((page) => page.length > 0)).toBe(true)
    const fragments = pages.flat().filter((block) => block.id.includes(':fragment'))
    expect(fragments).toHaveLength(2)
  })
})
