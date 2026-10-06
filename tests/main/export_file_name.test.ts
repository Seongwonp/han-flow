import { posix, win32 } from 'path'
import {
  documentStem,
  FALLBACK_PDF_FILE_NAME,
  pdfFileName,
  sanitizeFileStem,
  suggestedPdfExportPath,
  windowTitle
} from '../../src/main/export_file_name'
import { documentFileName, documentTitle } from '../../src/renderer/src/document_title'

describe('PDF 내보내기 기본 이름', () => {
  test('한글·공백이 있는 문서 이름을 그대로 쓰고 확장자만 .pdf로 바꾼다', () => {
    expect(pdfFileName('/문서함/보고서 작성 서식.hwpx', posix)).toBe('보고서 작성 서식.pdf')
    expect(pdfFileName('C:\\Users\\민지\\바탕 화면\\2026 예산(안).hwp', win32)).toBe('2026 예산(안).pdf')
    expect(pdfFileName('/docs/계획.v2.final.HWPX', posix)).toBe('계획.v2.final.pdf')
  })

  test('Windows 금지 문자와 끝의 점·공백을 정리한다', () => {
    expect(sanitizeFileStem('회의록: 3/4 <초안>?')).toBe('회의록_ 3_4 _초안__')
    expect(sanitizeFileStem('a*b|c"d\\e')).toBe('a_b_c_d_e')
    expect(sanitizeFileStem('끝에 점과 공백. . ')).toBe('끝에 점과 공백')
    expect(sanitizeFileStem('  앞뒤 공백  ')).toBe('앞뒤 공백')
    expect(sanitizeFileStem('탭\t문자')).toBe('탭_문자')
    expect(sanitizeFileStem('CON')).toBe('CON_')
    expect(sanitizeFileStem('lpt1')).toBe('lpt1_')
    expect(sanitizeFileStem('...')).toBeUndefined()
    expect(sanitizeFileStem('???')).toBeUndefined()
    // POSIX에서는 콜론이 들어간 이름도 열 수 있다. 내보낼 이름은 Windows에서도 쓸 수 있게 바꾼다.
    expect(pdfFileName('/tmp/12:30 회의.hwpx', posix)).toBe('12_30 회의.pdf')
  })

  test('문서를 모르거나 이름이 비면 문서.pdf로 돌아간다', () => {
    expect(pdfFileName(undefined)).toBe(FALLBACK_PDF_FILE_NAME)
    expect(pdfFileName('', posix)).toBe(FALLBACK_PDF_FILE_NAME)
    // 점으로 시작하는 이름은 확장자가 아니라 이름 자체다(path.extname 규칙).
    expect(pdfFileName('/tmp/.hwpx', posix)).toBe('.hwpx.pdf')
    expect(pdfFileName('/tmp/ ..hwp', posix)).toBe(FALLBACK_PDF_FILE_NAME)
  })

  test('경로 없는 파일 이름도 받는다', () => {
    expect(documentStem('보고서.hwpx', posix)).toBe('보고서')
    expect(pdfFileName('보고서.hwpx', posix)).toBe('보고서.pdf')
    expect(suggestedPdfExportPath('보고서.hwpx', undefined, posix)).toBe('보고서.pdf')
  })

  test('마지막 대화상자 폴더가 있으면 그 폴더, 없으면 원본 문서 폴더에 둔다', () => {
    expect(suggestedPdfExportPath('/문서함/보고서 작성 서식.hwpx', undefined, posix))
      .toBe('/문서함/보고서 작성 서식.pdf')
    expect(suggestedPdfExportPath('/문서함/보고서 작성 서식.hwpx', '/내보내기', posix))
      .toBe('/내보내기/보고서 작성 서식.pdf')
    expect(suggestedPdfExportPath('C:\\문서\\예산.hwp', undefined, win32)).toBe('C:\\문서\\예산.pdf')
    expect(suggestedPdfExportPath(undefined, '/내보내기', posix)).toBe('/내보내기/문서.pdf')
    expect(suggestedPdfExportPath(undefined, undefined, posix)).toBe('문서.pdf')
  })

  test('창 제목은 <파일 이름> - Han-Flow, 문서가 없으면 Han-Flow', () => {
    expect(windowTitle('/문서함/보고서 작성 서식.hwpx', posix)).toBe('보고서 작성 서식.hwpx - Han-Flow')
    expect(windowTitle('C:\\문서\\예산.hwp', win32)).toBe('예산.hwp - Han-Flow')
    expect(windowTitle(undefined)).toBe('Han-Flow')
  })

  test('renderer PDF 제목은 구분자와 무관하게 확장자 없는 문서 이름이다', () => {
    expect(documentFileName('C:\\Users\\민지\\보고서 작성 서식.hwpx')).toBe('보고서 작성 서식.hwpx')
    expect(documentFileName('/home/민지/보고서 작성 서식.hwpx')).toBe('보고서 작성 서식.hwpx')
    expect(documentTitle('C:\\Users\\민지\\보고서 작성 서식.hwpx')).toBe('보고서 작성 서식')
    expect(documentTitle('/a/계획.v2.hwp')).toBe('계획.v2')
    expect(documentTitle('README')).toBe('README')
  })
})
