import { isRenderedStrikeShape } from '../../src/core/parser/line_shape'
import AdmZip from 'adm-zip'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'

describe('취소선 shape 판정', () => {
  test('실제 선 종류만 취소선으로 본다', () => {
    for (const shape of ['SOLID', 'DASH', 'DOT', 'DASH_DOT', 'DASH_DOT_DOT', 'LONG_DASH', 'CIRCLE', 'DOUBLE_SLIM', 'SLIM_THICK', 'THICK_SLIM', 'SLIM_THICK_SLIM', 'WAVE', 'DOUBLE_WAVE']) {
      expect(isRenderedStrikeShape(shape)).toBe(true)
    }
  })

  test('한/글 내보내기의 3D 기본값과 NONE·알 수 없는 값은 취소선이 아니다', () => {
    for (const shape of ['NONE', '3D', 'SLIM_3D', 'Ghost', '', undefined]) {
      expect(isRenderedStrikeShape(shape)).toBe(false)
    }
  })
})


describe('decoder 취소선 해석', () => {
  test('shape="3D"는 취소선 없음, SOLID는 취소선으로 해석한다', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'han-flow-strike-'))
    try {
      const path = createSyntheticHwpx(directory)
      const zip = new AdmZip(path)
      const header = zip.readAsText('Contents/header.xml')
      const patched = header.replace(
        '<hh:bold/></hh:charPr>',
        '<hh:bold/><hh:strikeout shape="3D" color="#000000"/></hh:charPr>' +
          '<hh:charPr id="9" height="1000" textColor="#000000"><hh:strikeout shape="SOLID" color="#000000"/></hh:charPr>'
      )
      expect(patched).not.toBe(header)
      zip.updateFile('Contents/header.xml', Buffer.from(patched))
      zip.writeZip(path)
      const reader = await HwpxPackageReader.open(path)
      const document = await decodeViewerDocument(reader)
      expect(document.charStyles['0'].strikeout).toBe(false)
      expect(document.charStyles['9'].strikeout).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
