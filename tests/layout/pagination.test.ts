import { existsSync } from 'fs'
import { resolve } from 'path'
import { paginateDocument } from '../../src/core/layout/pagination'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'

const fixture = resolve(__dirname, '../fixtures/private/m1-weekly.hwpx')
const privateTest = existsSync(fixture) ? test : test.skip

describe('AIDA block pagination', () => {
  privateTest('section 경계와 layout height로 7개 block page를 구성한다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(fixture))
    const pages = paginateDocument(document)
    // reference PDF의 8번째 페이지는 표 행 분할이 필요하며 다음 pagination 단계에서 처리한다.
    expect(pages).toHaveLength(7)
    expect(pages.every((page) => page.length > 0)).toBe(true)
  })
})
