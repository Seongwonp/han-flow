const { ipcRenderer } = require('electron')
const { readFile } = require('node:fs/promises')
const { dirname, resolve } = require('node:path')

const RESULT_CHANNEL = 'han-flow:generate-public-hwp'

function expectOk(label, result) {
  const parsed = JSON.parse(result)
  if (!parsed.ok) throw new Error(`${label}: ${result}`)
  return parsed
}

function createPublicImageBytes() {
  const canvas = document.createElement('canvas')
  canvas.width = 240
  canvas.height = 120
  const context = canvas.getContext('2d')
  if (!context) throw new Error('fixture 이미지용 Canvas를 만들 수 없습니다.')

  context.fillStyle = '#f4f7ff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#3157d5'
  context.fillRect(0, 0, 56, canvas.height)
  context.fillStyle = '#172554'
  context.font = 'bold 28px sans-serif'
  context.fillText('HAN-FLOW', 76, 55)
  context.fillStyle = '#52617a'
  context.font = '18px sans-serif'
  context.fillText('PUBLIC FIXTURE', 76, 85)

  const base64 = canvas.toDataURL('image/png').split(',')[1]
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

window.addEventListener('DOMContentLoaded', async () => {
  let documentModel
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context를 만들 수 없습니다.')
    globalThis.measureTextWidth = (font, text) => {
      context.font = font
      return context.measureText(text).width
    }

    const modulePath = require.resolve('@rhwp/core')
    const rhwp = await import(modulePath)
    const wasm = await readFile(resolve(dirname(modulePath), 'rhwp_bg.wasm'))
    await rhwp.default(wasm)

    documentModel = rhwp.HwpDocument.createEmpty()
    expectOk('머리말 생성', documentModel.createHeaderFooter(0, true, 0))
    expectOk(
      '머리말 텍스트',
      documentModel.insertTextInHeaderFooter(
        0,
        true,
        0,
        0,
        0,
        'HANFLOW-PUBLIC-HEADER · 공개 회귀 문서'
      )
    )

    const title = 'Han-Flow 공개 HWP 회귀 문서'
    expectOk('제목', documentModel.insertText(0, 0, 0, title))
    expectOk('문단 1', documentModel.insertParagraph(0, 0))
    const intro = '개인정보가 없는 합성 문서입니다. 본문, 표, 그림, 머리말과 두 쪽 레이아웃을 검증합니다.'
    expectOk('소개', documentModel.insertText(0, 1, 0, intro))

    expectOk('문단 2', documentModel.insertParagraph(0, 1))
    const table = expectOk(
      '표',
      documentModel.createTableEx(JSON.stringify({
        sectionIdx: 0,
        paraIdx: 2,
        charOffset: 0,
        rowCount: 3,
        colCount: 3,
        treatAsChar: true,
        colWidths: [14000, 14000, 14000]
      }))
    )
    const tableTexts = [
      '항목', '기대값', '검증 목적',
      '본문', '표시', '텍스트 보존',
      '그림', '1개', '리소스 연결'
    ]
    tableTexts.forEach((text, cellIndex) => {
      expectOk(
        `표 셀 ${cellIndex}`,
        documentModel.insertTextInCell(0, table.paraIdx, table.controlIdx, cellIndex, 0, 0, text)
      )
    })

    expectOk('문단 3', documentModel.insertParagraph(0, 2))
    const imageBytes = createPublicImageBytes()
    expectOk(
      '그림',
      documentModel.insertPictureEx(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 3,
          charOffset: 0,
          width: 18000,
          height: 9000,
          naturalWidthPx: 240,
          naturalHeightPx: 120,
          extension: 'png',
          description: 'Han-Flow 공개 fixture 표식'
        }),
        imageBytes
      )
    )

    expectOk('문단 4', documentModel.insertParagraph(0, 3))
    const secondPage = 'HANFLOW-SECOND-PAGE · 강제 쪽 나누기 뒤의 두 번째 페이지 본문입니다.'
    expectOk('둘째 쪽 본문', documentModel.insertText(0, 4, 0, secondPage))
    expectOk('쪽 나누기', documentModel.insertPageBreak(0, 4, 0))
    expectOk('문단 5', documentModel.insertParagraph(0, 4))
    expectOk(
      '마무리 문장',
      documentModel.insertText(
        0,
        5,
        0,
        '검색, 선택, 접근성 텍스트 레이어와 PDF 내보내기 결과를 함께 확인합니다.'
      )
    )

    const verify = JSON.parse(documentModel.exportHwpVerify())
    const bytes = documentModel.exportHwp()
    ipcRenderer.send(RESULT_CHANNEL, {
      success: true,
      base64: Buffer.from(bytes).toString('base64'),
      diagnostics: {
        paragraphCount: documentModel.getParagraphCount(0),
        pageCount: documentModel.pageCount(),
        exportVerify: verify
      }
    })
  } catch (error) {
    ipcRenderer.send(RESULT_CHANNEL, {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    documentModel?.free()
  }
})
