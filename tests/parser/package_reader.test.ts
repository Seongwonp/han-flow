import { existsSync } from 'fs'
import { resolve } from 'path'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { walkOrderedXml } from '../../src/core/parser/ordered_xml'

const fixture = resolve(__dirname, '../fixtures/private/m1-weekly.hwpx')
const privateTest = existsSync(fixture) ? test : test.skip

describe('AIDA M1 HWPX package', () => {
  privateTest('패키지 구조와 혼합 콘텐츠를 결정적으로 읽는다', async () => {
    const reader = await HwpxPackageReader.open(fixture)
    const index = await reader.index()
    expect(index).toMatchObject({
      mimetype: 'application/hwp+zip',
      headerPath: 'Contents/header.xml',
      sectionPaths: [
        'Contents/section0.xml',
        'Contents/section1.xml',
        'Contents/section2.xml'
      ],
      resourcePaths: ['BinData/image1.png', 'BinData/image2.png']
    })
    expect(Object.values(index.sectionSizes).every((size) => size > 0)).toBe(true)

    const counts = { paragraph: 0, table: 0, picture: 0 }
    for (const path of index.sectionPaths) {
      const nodes = walkOrderedXml(await reader.readOrderedXml(path))
      counts.paragraph += nodes.filter((node) => node.name === 'hp:p').length
      counts.table += nodes.filter((node) => node.name === 'hp:tbl').length
      counts.picture += nodes.filter((node) => node.name === 'hp:pic').length
    }
    expect(counts).toEqual({ paragraph: 303, table: 15, picture: 4 })
  })

  privateTest('텍스트와 그림의 실제 자식 순서를 보존한다', async () => {
    const reader = await HwpxPackageReader.open(fixture)
    const nodes = walkOrderedXml(await reader.readOrderedXml('Contents/section2.xml'))
    const run = nodes.find((node) =>
      node.children.some((child) => child.name === 'hp:pic') &&
      node.children.some((child) => child.name === 'hp:t')
    )
    // fast-xml-parser는 공백만 든 선행 hp:t를 생략하지만, 의미 있는 노드 순서는 보존한다.
    expect(run?.children.map((child) => child.name)).toEqual(['hp:pic', 'hp:t'])
  })
})
