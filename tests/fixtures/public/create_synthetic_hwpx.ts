import AdmZip from 'adm-zip'
import { join } from 'path'

const header = `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hh:fontfaces><hh:fontface lang="HANGUL"><hh:font id="0" face="HanFlow Test Sans"/></hh:fontface></hh:fontfaces>
  <hh:charProperties><hh:charPr id="0" height="1000" textColor="#123456"><hh:fontRef hangul="0"/><hh:bold/></hh:charPr></hh:charProperties>
  <hh:numberings><hh:numbering id="1"><hh:paraHead level="1" numFormat="DIGIT">^1.</hh:paraHead></hh:numbering></hh:numberings>
  <hh:bullets><hh:bullet id="1" char="-"/></hh:bullets>
  <hh:paraProperties><hh:paraPr id="0"><hh:align horizontal="LEFT"/><hh:heading type="NONE" idRef="0" level="0"/><hh:lineSpacing value="160"/><hh:margin><hc:left value="0"/><hc:right value="0"/><hc:prev value="0"/><hc:next value="0"/></hh:margin></hh:paraPr><hh:paraPr id="1"><hh:heading type="BULLET" idRef="1" level="0"/><hh:margin><hc:left value="0"/><hc:right value="0"/><hc:prev value="0"/><hc:next value="0"/></hh:margin></hh:paraPr><hh:paraPr id="2"><hh:heading type="NUMBER" idRef="1" level="0"/><hh:margin><hc:left value="0"/><hc:right value="0"/><hc:prev value="0"/><hc:next value="0"/></hh:margin></hh:paraPr><hh:paraPr id="3"><hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"><hh:margin><hc:left value="120"/><hc:right value="240"/><hc:prev value="360"/><hc:next value="480"/></hh:margin><hh:lineSpacing type="PERCENT" value="130"/></hp:case><hp:default><hh:margin><hc:left value="1200"/><hc:right value="2400"/><hc:prev value="3600"/><hc:next value="4800"/></hh:margin><hh:lineSpacing type="PERCENT" value="200"/></hp:default></hp:switch></hh:paraPr></hh:paraProperties>
  <hh:borderFills><hh:borderFill id="1"><hh:leftBorder type="SOLID" width="0.12" color="#000000"/><hh:rightBorder type="SOLID" width="0.12" color="#000000"/><hh:topBorder type="SOLID" width="0.12" color="#000000"/><hh:bottomBorder type="SOLID" width="0.12" color="#000000"/><hc:fillBrush><hc:winBrush faceColor="#EEEEEE"/></hc:fillBrush></hh:borderFill></hh:borderFills>
</hh:head>`

const cell = (row: number, height: number, label: string, headerCell = false) => `<hp:tr><hp:tc borderFillIDRef="1" header="${headerCell ? 1 : 0}"><hp:cellAddr colAddr="0" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="6000" height="${height}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList vertAlign="CENTER"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${label}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="${height}"/></hp:linesegarray></hp:p></hp:subList></hp:tc></hp:tr>`

const section0 = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:startNum page="0"/><hp:visibility hideFirstPageNum="0"/><hp:pagePr width="10000" height="10000"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="300" footer="300"/></hp:pagePr><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:secPr><hp:header id="1" applyPageType="BOTH"><hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>공개 머리말</hp:t></hp:run></hp:p></hp:subList></hp:header><hp:header id="4" applyPageType="EVEN"><hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>짝수 쪽 머리말</hp:t></hp:run></hp:p></hp:subList></hp:header><hp:footer id="2" applyPageType="BOTH"><hp:subList><hp:p paraPrIDRef="1"><hp:run charPrIDRef="0"><hp:pic><hp:curSz width="200" height="200"/><hc:img xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" binaryItemIDRef="image1"/></hp:pic><hp:t>공개 꼬리말</hp:t></hp:run></hp:p><hp:p paraPrIDRef="2"><hp:run charPrIDRef="0"><hp:t>첫 항목</hp:t></hp:run></hp:p><hp:p paraPrIDRef="2"><hp:run charPrIDRef="0"><hp:t>둘째 항목</hp:t></hp:run></hp:p></hp:subList></hp:footer><hp:tbl id="public-table" rowCnt="4" colCnt="1" pageBreak="CELL" repeatHeader="1"><hp:sz width="6000" height="8500"/>${cell(0, 1000, '공개 헤더', true)}${cell(1, 3000, '긴 설명')}${cell(2, 500, '다음 제목')}${cell(3, 4000, '다음 본문')}</hp:tbl></hp:run></hp:p>
</hs:sec>`

const section1 = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:startNum page="5"/><hp:pageNum pos="BOTTOM_RIGHT" formatType="DIGIT" sideChar=""/></hp:secPr><hp:header id="3" applyPageType="BOTH"><hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>둘째 구역 머리말</hp:t></hp:run></hp:p></hp:subList></hp:header><hp:pic><hp:curSz width="1000" height="1000"/><hc:img binaryItemIDRef="image1"/></hp:pic><hp:t>이미지 뒤 텍스트</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>
</hs:sec>`

const columnCell = (
  row: number,
  column: number,
  label: string,
  paragraphId: number,
  headerCell = false
) => `<hp:tc borderFillIDRef="1" header="${headerCell ? 1 : 0}"><hp:cellAddr colAddr="${column}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="2000" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList vertAlign="CENTER"><hp:p id="${paragraphId}" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${label}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="2000"/></hp:linesegarray></hp:p></hp:subList></hp:tc>`

const columnTableSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="12000" height="12000"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="300" footer="300"/></hp:pagePr></hp:secPr><hp:tbl id="column-table" rowCnt="3" colCnt="3" pageBreak="CELL" repeatHeader="1"><hp:sz width="6000" height="6000"/>
    <hp:tr>${columnCell(0, 0, 'H1', 100, true)}${columnCell(0, 1, 'H2', 101, true)}${columnCell(0, 2, 'H3', 102, true)}</hp:tr>
    <hp:tr>${columnCell(1, 0, 'A1', 110)}${columnCell(1, 1, 'A2', 111)}${columnCell(1, 2, 'A3', 112)}</hp:tr>
    <hp:tr>${columnCell(2, 0, 'B1', 120)}${columnCell(2, 1, 'B2', 121)}${columnCell(2, 2, 'B3', 122)}</hp:tr>
  </hp:tbl></hp:run></hp:p>
</hs:sec>`

const listMarkerSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="12000" height="12000"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="300" footer="300"/></hp:pagePr></hp:secPr><hp:t>목록 구조 회귀</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>
  <hp:p id="2" paraPrIDRef="1"><hp:run charPrIDRef="0"><hp:t>글머리표 첫 항목</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="1000" vertsize="1000"/></hp:linesegarray></hp:p>
  <hp:p id="3" paraPrIDRef="1"><hp:run charPrIDRef="0"><hp:t>글머리표 둘째 항목</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="2000" vertsize="1000"/></hp:linesegarray></hp:p>
  <hp:p id="4" paraPrIDRef="2"><hp:run charPrIDRef="0"><hp:t>번호 첫 항목</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="3000" vertsize="1000"/></hp:linesegarray></hp:p>
  <hp:p id="5" paraPrIDRef="2"><hp:run charPrIDRef="0"><hp:t>번호 둘째 항목</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="4000" vertsize="1000"/></hp:linesegarray></hp:p>
</hs:sec>`

const multiColumnBody = [
  ['2', '3000', '두 단 문서의 둘째 문단', '0'],
  ['3', '6000', '명시적 단 나눔 뒤 첫 문단', '1'],
  ['4', '9000', '오른쪽 단 둘째 문단', '0'],
  ['5', '12000', '오른쪽 단 셋째 문단', '0'],
  ['6', '15000', '둘째 페이지 첫 문단', '0'],
  ['7', '18000', '둘째 페이지 둘째 문단', '0']
].map(([id, top, text, columnBreak]) =>
  `<hp:p id="${id}" paraPrIDRef="0" columnBreak="${columnBreak}"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="${top}" vertsize="3000"/></hp:linesegarray></hp:p>`
).join('\n  ')

const multiColumnSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="30000" height="12000"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="300" footer="300"/></hp:pagePr></hp:secPr><hp:ctrl><hp:colPr id="columns-2" type="NEWSPAPER" layout="LEFT" colCount="2" sameSz="1" sameGap="600"/></hp:ctrl><hp:t>두 단 문서의 첫 문단</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="3000"/></hp:linesegarray></hp:p>
  ${multiColumnBody}
</hs:sec>`

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X4nHCwAAAABJRU5ErkJggg==', 'base64')
const HWPX_MIMETYPE = 'application/hwp+zip'

function addMimetype(zip: AdmZip): void {
  const entry = zip.addFile('mimetype', Buffer.from(HWPX_MIMETYPE))
  entry.header.method = 0
}

const cellFragmentHeader = header.replace('height="1000"', 'height="500"')
const fragmentParagraphs = Array.from({ length: 15 }, (_, index) =>
  `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>P${String(index + 1).padStart(2, '0')}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="2000"/></hp:linesegarray></hp:p>`
).join('')

const cellFragmentSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="20000" height="21000"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="300" footer="300"/></hp:pagePr></hp:secPr><hp:tbl id="cell-fragment-table" rowCnt="2" colCnt="1" pageBreak="CELL" repeatHeader="1"><hp:sz width="12000" height="32200"/>${cell(0, 2000, 'H', true)}<hp:tr><hp:tc borderFillIDRef="1"><hp:cellAddr colAddr="0" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="12000" height="30200"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList vertAlign="CENTER">${fragmentParagraphs}</hp:subList></hp:tc></hp:tr></hp:tbl></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="32200"/></hp:linesegarray></hp:p>
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:tbl id="anchor-table" rowCnt="1" colCnt="1" pageBreak="CELL"><hp:sz width="12000" height="2000"/>${cell(0, 2000, 'A')}</hp:tbl></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="2000"/></hp:linesegarray></hp:p>
</hs:sec>`

const compatibilityImages = Array.from({ length: 12 }, (_, index) =>
  `<hp:pic><hp:curSz width="1000" height="1000"/><hc:img binaryItemIDRef="image${index + 1}"/></hp:pic>`
).join('')

const compatibilitySection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="20000" height="21000"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="300" footer="300"/></hp:pagePr></hp:secPr>${compatibilityImages}</hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1200"/></hp:linesegarray></hp:p>
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:tbl id="merged-table" rowCnt="3" colCnt="2" pageBreak="CELL"><hp:sz width="12000" height="6000"/>
    <hp:tr><hp:tc borderFillIDRef="1" header="1"><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="6000" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>H1</hp:t></hp:run></hp:p></hp:subList></hp:tc><hp:tc borderFillIDRef="1" header="1"><hp:cellAddr colAddr="1" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="6000" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>H2</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr>
    <hp:tr><hp:tc borderFillIDRef="1"><hp:cellAddr colAddr="0" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="2"/><hp:cellSz width="6000" height="4000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList vertAlign="CENTER"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>R</hp:t></hp:run></hp:p></hp:subList></hp:tc><hp:tc borderFillIDRef="1"><hp:cellAddr colAddr="1" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="6000" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>A</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr>
    <hp:tr><hp:tc borderFillIDRef="1"><hp:cellAddr colAddr="1" rowAddr="2"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="6000" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>B</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr>
  </hp:tbl></hp:run><hp:linesegarray><hp:lineseg vertpos="1200" vertsize="6000"/></hp:linesegarray></hp:p>
</hs:sec>`

export interface SyntheticHwpxOptions {
  sectionCount?: number
  paragraphsPerExtraSection?: number
  imageBytes?: number
  firstSectionExtraParagraphs?: number
  firstSectionPageWidth?: number
  firstSectionPageHeight?: number
  firstSectionMargin?: number
  firstSectionTableWidth?: number
  fileName?: string
}

function paragraphs(sectionIndex: number, paragraphCount: number): string {
  return Array.from({ length: paragraphCount }, (_, paragraphIndex) =>
    `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>성능 측정 section ${sectionIndex} paragraph ${paragraphIndex}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>`
  ).join('')
}

function extraSection(sectionIndex: number, paragraphCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${paragraphs(sectionIndex, paragraphCount)}</hs:sec>`
}

export function createSyntheticHwpx(directory: string, options: SyntheticHwpxOptions = {}): string {
  const sectionCount = Math.max(options.sectionCount ?? 2, 2)
  const paragraphsPerExtraSection = options.paragraphsPerExtraSection ?? 1
  const path = join(directory, options.fileName ?? 'han-flow-public.hwpx')
  const zip = new AdmZip()
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section1.xml', Buffer.from(section1))
  const firstSectionPageWidth = options.firstSectionPageWidth ?? 10000
  const firstSectionPageHeight = options.firstSectionPageHeight ?? 10000
  const firstSectionMargin = options.firstSectionMargin ?? 1000
  const firstSectionTableWidth = options.firstSectionTableWidth ?? 6000
  const firstSection = section0
    .replace(
      '<hp:pagePr width="10000" height="10000">',
      `<hp:pagePr width="${firstSectionPageWidth}" height="${firstSectionPageHeight}">`
    )
    .replace(
      '<hp:margin left="1000" right="1000" top="1000" bottom="1000" header="300" footer="300"/>',
      `<hp:margin left="${firstSectionMargin}" right="${firstSectionMargin}" top="${firstSectionMargin}" bottom="${firstSectionMargin}" header="300" footer="300"/>`
    )
    .replace('<hp:sz width="6000" height="8500"/>', `<hp:sz width="${firstSectionTableWidth}" height="8500"/>`)
    .replaceAll('<hp:cellSz width="6000"', `<hp:cellSz width="${firstSectionTableWidth}"`)
    .replace('</hs:sec>', `${paragraphs(0, options.firstSectionExtraParagraphs ?? 0)}</hs:sec>`)
  zip.addFile('Contents/section0.xml', Buffer.from(firstSection))
  for (let sectionIndex = 2; sectionIndex < sectionCount; sectionIndex += 1) {
    zip.addFile(`Contents/section${sectionIndex}.xml`, Buffer.from(extraSection(sectionIndex, paragraphsPerExtraSection)))
  }
  const imageBytes = Math.max(options.imageBytes ?? transparentPng.length, transparentPng.length)
  zip.addFile('BinData/image1.png', Buffer.concat([transparentPng, Buffer.alloc(imageBytes - transparentPng.length)]))
  zip.writeZip(path)
  return path
}

export function createCellFragmentHwpx(directory: string, fileName = 'han-flow-cell-fragment.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip()
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(cellFragmentHeader))
  zip.addFile('Contents/section0.xml', Buffer.from(cellFragmentSection))
  zip.writeZip(path)
  return path
}

export function createTableColumnHwpx(directory: string, fileName = 'han-flow-table-column.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(columnTableSection))
  zip.writeZip(path)
  return path
}

/**
 * 큰 단순 표 하나만 든 합성 문서(직접 작성). 첫 행은 반복 머리글, 나머지는 `R{행}C{열}` 글자를 담은 단순 텍스트 셀이다.
 * 기본값(120행×4열)은 표 원문이 약 200 KiB로, 표 구조 command의 history·복구 기록 크기 회귀에 쓴다.
 */
export function createLargeTableHwpx(
  directory: string,
  options: { rows?: number; columns?: number; fileName?: string } = {}
): string {
  const rows = options.rows ?? 120
  const columns = options.columns ?? 4
  const path = join(directory, options.fileName ?? 'han-flow-large-table.hwpx')
  const body = Array.from({ length: rows }, (_, row) =>
    `<hp:tr>${Array.from({ length: columns }, (_, column) =>
      columnCell(row, column, row === 0 ? `H${column + 1}` : `R${row}C${column + 1}`, 1000 + row * columns + column, row === 0)
    ).join('')}</hp:tr>`
  ).join('\n    ')
  const section = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="12000" height="12000"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="300" footer="300"/></hp:pagePr></hp:secPr><hp:tbl id="large-table" rowCnt="${rows}" colCnt="${columns}" pageBreak="CELL" repeatHeader="1"><hp:sz width="${columns * 2000}" height="${rows * 2000}"/>
    ${body}
  </hp:tbl></hp:run></hp:p>
</hs:sec>`
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(section))
  zip.writeZip(path)
  return path
}

export function createListMarkerHwpx(directory: string, fileName = 'han-flow-list-markers.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(listMarkerSection))
  zip.writeZip(path)
  return path
}

export function createMultiColumnHwpx(directory: string, fileName = 'han-flow-multi-column.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(multiColumnSection))
  zip.writeZip(path)
  return path
}

export function createParallelColumnHwpx(directory: string, fileName = 'han-flow-parallel-column.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(multiColumnSection.replace('type="NEWSPAPER"', 'type="PARALLEL"')))
  zip.writeZip(path)
  return path
}

export function createCompatibilityHwpx(directory: string, fileName = 'han-flow-compatibility.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip()
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(cellFragmentHeader))
  zip.addFile('Contents/section0.xml', Buffer.from(compatibilitySection))
  for (let index = 1; index <= 12; index += 1) {
    zip.addFile(`BinData/image${index}.png`, transparentPng)
  }
  zip.writeZip(path)
  return path
}

export function createInvalidHwpx(directory: string, fileName = 'han-flow-invalid.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip()
  addMimetype(zip)
  zip.addFile('Contents/section0.xml', Buffer.from(cellFragmentSection))
  zip.writeZip(path)
  return path
}

/**
 * 표지·목차·본문 3쪽짜리 공공기관 보고서 서식 구조(직접 작성한 합성 문서).
 * - 목차 표 첫 열의 `1.`·`2.`처럼 숫자로만 보이는 `hp:t`(XML 숫자 변환으로 `.`을 잃던 회귀)
 * - 한컴 문자표의 보충 사설 영역 글자 U+F03DA(키캡 글머리). 글꼴에 glyph가 없으면 PDF에서 글자로 추출되지 않는다.
 */
export const REPORT_TOC_PUA_MARKER = String.fromCodePoint(0xf03da)
export const REPORT_TOC_NUMERIC_TEXTS = ['1.', '2.', '3.', '4.', '007', '1e3', '0x10', ' 12 '] as const

const reportHeader = header
  .replace(
    '</hh:charProperties>',
    '<hh:charPr id="1" height="2400" textColor="#000000"><hh:fontRef hangul="0"/><hh:bold/></hh:charPr>' +
      '<hh:charPr id="2" height="1500" textColor="#000000"><hh:fontRef hangul="0"/></hh:charPr></hh:charProperties>'
  )
  .replace(
    '</hh:paraProperties>',
    '<hh:paraPr id="4"><hh:align horizontal="CENTER"/><hh:heading type="NONE" idRef="0" level="0"/><hh:lineSpacing value="160"/><hh:margin><hc:left value="0"/><hc:right value="0"/><hc:prev value="0"/><hc:next value="0"/></hh:margin></hh:paraPr>' +
      '<hh:paraPr id="5"><hh:align horizontal="RIGHT"/><hh:heading type="NONE" idRef="0" level="0"/><hh:lineSpacing value="160"/><hh:margin><hc:left value="0"/><hc:right value="500"/><hc:prev value="0"/><hc:next value="0"/></hh:margin></hh:paraPr></hh:paraProperties>'
  )

const reportCell = (row: number, column: number, width: number, height: number, text: string, paraPr = '0', charPr = '2') =>
  `<hp:tc borderFillIDRef="1"><hp:cellAddr colAddr="${column}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${width}" height="${height}"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/><hp:subList vertAlign="CENTER"><hp:p paraPrIDRef="${paraPr}"><hp:run charPrIDRef="${charPr}">${text ? `<hp:t>${text}</hp:t>` : ''}</hp:run></hp:p></hp:subList></hp:tc>`

const reportParagraph = (text: string, options: { paraPr?: string; charPr?: string; pageBreak?: boolean } = {}) =>
  `<hp:p paraPrIDRef="${options.paraPr ?? '0'}"${options.pageBreak ? ' pageBreak="1"' : ''}><hp:run charPrIDRef="${options.charPr ?? '2'}"><hp:t>${text}</hp:t></hp:run></hp:p>`

const tocEntries: Array<[string, string, string]> = [
  ['1.', '추진 배경 및 목적', '1'],
  ['2.', '세부 추진 계획', '2'],
  ['3.', '', '3'],
  ['4.', '', '4']
]

const reportTocSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p paraPrIDRef="4"><hp:run charPrIDRef="1"><hp:secPr><hp:pagePr width="59528" height="84188"><hp:margin left="5102" right="5102" top="4252" bottom="4252" header="3600" footer="3600"/></hp:pagePr></hp:secPr><hp:t>합성 보고서 제목</hp:t></hp:run></hp:p>
  ${reportParagraph('2026. 10. 6.(화)', { paraPr: '4' })}
  ${reportParagraph('○○○○과', { paraPr: '4' })}
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="2"><hp:tbl id="report-writer" rowCnt="1" colCnt="2" pageBreak="CELL"><hp:sz width="44000" height="1800"/><hp:tr>${reportCell(0, 0, 6000, 1800, '작 성 자', '4')}${reportCell(0, 1, 38000, 1800, '○○과장 ○○○ ☎000-0000')}</hp:tr></hp:tbl></hp:run></hp:p>
  ${reportParagraph('목    차', { paraPr: '4', charPr: '1', pageBreak: true })}
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="2"><hp:tbl id="report-toc" rowCnt="${tocEntries.length}" colCnt="3" pageBreak="CELL"><hp:sz width="47450" height="${tocEntries.length * 3512}"/>${tocEntries.map(([number, title, page], row) =>
    `<hp:tr>${reportCell(row, 0, 3650, 3512, number, '5', '1')}${reportCell(row, 1, 39336, 3512, title)}${reportCell(row, 2, 4464, 3512, page, '4')}</hp:tr>`
  ).join('')}</hp:tbl></hp:run></hp:p>
  ${reportParagraph('1. 추진 배경', { charPr: '1', pageBreak: true })}
  ${reportParagraph('Ⅰ 개요')}
  ${reportParagraph(`${REPORT_TOC_PUA_MARKER} 둘째 수준 항목`)}
  ${reportParagraph('  ○ 셋째 수준 항목')}
  ${reportParagraph('    - 넷째 수준 항목')}
  ${reportParagraph(`  가. ${REPORT_TOC_PUA_MARKER} : 문자표 키캡 글머리`)}
  ${reportParagraph('  나. 숫자로만 된 글자 칸')}
  ${REPORT_TOC_NUMERIC_TEXTS.slice(4).map((text) => reportParagraph(text)).join('\n  ')}
</hs:sec>`

export function createReportTocHwpx(directory: string, fileName = 'han-flow-report-toc.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(reportHeader))
  zip.addFile('Contents/section0.xml', Buffer.from(reportTocSection))
  zip.writeZip(path)
  return path
}

/**
 * 공공기관 행사 계획 붙임 쪽의 내어쓰기 문단(직접 작성한 합성 문서).
 * 한/글은 음수 `hc:intent`(내어쓰기)를 첫 줄은 왼쪽 여백에서, 둘째 줄부터 `|intent|`만큼 들여 그린다.
 * 음수를 CSS `text-indent`로만 옮기면 첫 줄이 용지 왼쪽 밖으로 나가 PDF에서 잘린다.
 * 구역 첫 문단은 한/글 저장본처럼 `hp:secPr`만 든 빈 문단이다. 글자 칸이 없어 편집 시 합성 anchor
 * `#hp:p:0:empty`로 시작하고 첫 입력 뒤 새 `#hp:t:0` anchor로 바뀐다(편집 E2E가 이 전환을 따라가야 한다).
 */
const hangingIndentHeader = reportHeader.replace(
  '</hh:paraProperties>',
  '<hh:paraPr id="6"><hh:align horizontal="JUSTIFY"/><hh:heading type="NONE" idRef="0" level="0"/><hh:lineSpacing type="PERCENT" value="130"/><hh:margin><hc:intent value="-2620" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin></hh:paraPr>' +
    '<hh:paraPr id="7"><hh:align horizontal="JUSTIFY"/><hh:heading type="NONE" idRef="0" level="0"/><hh:lineSpacing type="PERCENT" value="160"/><hh:margin><hc:intent value="-15232" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin></hh:paraPr>' +
    '<hh:paraPr id="8"><hh:align horizontal="JUSTIFY"/><hh:heading type="NONE" idRef="0" level="0"/><hh:lineSpacing type="PERCENT" value="160"/><hh:margin><hc:intent value="-18704" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin></hh:paraPr>' +
    '<hh:paraPr id="9"><hh:align horizontal="LEFT"/><hh:heading type="BULLET" idRef="1" level="0"/><hh:lineSpacing type="PERCENT" value="140"/><hh:margin><hc:intent value="-4214" unit="HWPUNIT"/><hc:left value="1406" unit="HWPUNIT"/><hc:right value="458" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin></hh:paraPr>' +
    '<hh:paraPr id="10"><hh:align horizontal="CENTER"/><hh:heading type="NONE" idRef="0" level="0"/><hh:lineSpacing type="PERCENT" value="160"/><hh:margin><hc:intent value="-200" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin></hh:paraPr>' +
    '<hh:paraPr id="11"><hh:align horizontal="CENTER"/><hh:heading type="NONE" idRef="0" level="0"/><hh:lineSpacing type="PERCENT" value="160"/><hh:margin><hc:intent value="-4642" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin></hh:paraPr></hh:paraProperties>'
).replace(
  '</hh:charProperties>',
  '<hh:charPr id="3" height="1000" textColor="#FF0000"><hh:fontRef hangul="0"/><hh:bold/></hh:charPr><hh:charPr id="4" height="1000" textColor="#000000"><hh:fontRef hangul="0"/><hh:bold/></hh:charPr></hh:charProperties>'
)

/**
 * 보도자료 머리 표의 좁은 셀: 가운데 정렬 문단에 셀 안쪽 폭(3251 - 2×510)보다 큰 내어쓰기(-4642, 실제 2321)가 있다.
 * 음수 text-indent를 그대로 쓰면 `배포`가 왼쪽 날짜 셀 끝과 겹친다.
 */
const pressCell = (column: number, width: number, text: string, paraPr: string, charPr: string) =>
  `<hp:tc borderFillIDRef="1"><hp:cellAddr colAddr="${column}" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${width}" height="2514"/><hp:cellMargin left="510" right="510" top="141" bottom="141"/><hp:subList vertAlign="CENTER"><hp:p paraPrIDRef="${paraPr}"><hp:run charPrIDRef="${charPr}"><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList></hp:tc>`

export const PRESS_HEADER_CELL_TEXTS = ['보도시점', '2026.4.7.(화) 09:00', '배포', '2026.4.7.(화) 08:30'] as const

const pressHeaderTable = `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="2"><hp:tbl id="press-header" rowCnt="1" colCnt="4" pageBreak="CELL"><hp:sz width="31283" height="2514"/><hp:tr>${[
  pressCell(0, 4538, PRESS_HEADER_CELL_TEXTS[0], '10', '3'),
  pressCell(1, 12054, PRESS_HEADER_CELL_TEXTS[1], '4', '3'),
  pressCell(2, 3251, PRESS_HEADER_CELL_TEXTS[2], '11', '4'),
  pressCell(3, 11440, PRESS_HEADER_CELL_TEXTS[3], '4', '4')
].join('')}</hp:tr></hp:tbl></hp:run></hp:p>`

const hangingIndentSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="2"><hp:secPr><hp:pagePr width="59528" height="84188"><hp:margin left="5669" right="5669" top="2834" bottom="1417" header="1417" footer="1417"/></hp:pagePr></hp:secPr></hp:run></hp:p>
  ${reportParagraph('합성 행사 개최 계획', { paraPr: '4', charPr: '1' })}
  ${pressHeaderTable}
  ${reportParagraph('□ 행사 개요: 참여형 홍보 체계를 바탕으로 국민 참여 행사를 열고 지역 단위 활동 계획을 함께 공유하여 관심을 높인다', { paraPr: '6' })}
  ${reportParagraph('○ (일시) 2026. 4. 7.(화) 17:00 ~ 18:00', { paraPr: '7' })}
  ${reportParagraph('○ (참석) 정책국장, 진흥기관 부회장, 지역 담당 과장, 서포터즈 구성원, 관계 기관 담당자 등 약 15명이 참석하여 활동 계획을 함께 나눈다', { paraPr: '7' })}
  ${reportParagraph('※ 서포터즈: 교사, 창업가 등 이해도를 갖춘 관계자 10명 내외로 구성하고 분야별 활동 결과를 정리하여 공유한다', { paraPr: '8' })}
  ${reportParagraph('행사 뒤 활동 수기를 모아 우수 사례를 선정하고 영상 제작과 대외 홍보에 활용하며 활동자에게 포상한다', { paraPr: '9' })}
</hs:sec>`

export function createHangingIndentHwpx(directory: string, fileName = 'han-flow-hanging-indent.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(hangingIndentHeader))
  zip.addFile('Contents/section0.xml', Buffer.from(hangingIndentSection))
  zip.writeZip(path)
  return path
}

export const roundTripSentinels = {
  headerAttribute: 'han-flow-unknown-attribute',
  headerNode: 'han-flow-unknown-header-node',
  sectionAttribute: 'han-flow-unknown-section-attribute',
  sectionNode: 'han-flow-unknown-section-node',
  binary: Buffer.from([0x48, 0x46, 0x58, 0x00, 0xff, 0x10, 0x20])
} as const

export function createRoundTripHwpx(
  directory: string,
  fileName = 'han-flow-round-trip.hwpx'
): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)

  const roundTripHeader = header
    .replace(
      '<hh:head ',
      `<hh:head xmlns:hfx="urn:han-flow:unknown" hfx:sentinel="${roundTripSentinels.headerAttribute}" `
    )
    .replace(
      '</hh:head>',
      `<hfx:preserve>${roundTripSentinels.headerNode}</hfx:preserve></hh:head>`
    )
  const roundTripSection = section0
    .replace(
      '<hs:sec ',
      `<hs:sec xmlns:hfx="urn:han-flow:unknown" hfx:sentinel="${roundTripSentinels.sectionAttribute}" `
    )
    .replace(
      '</hs:sec>',
      `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t></hp:t></hp:run></hp:p><hfx:preserve>${roundTripSentinels.sectionNode}</hfx:preserve></hs:sec>`
    )

  zip.addFile('version.xml', Buffer.from('<?xml version="1.0"?><hv:HCFVersion xmlns:hv="urn:han-flow:version" version="1.4"/>'))
  zip.addFile('Contents/content.hpf', Buffer.from('<?xml version="1.0"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf"/>'))
  zip.addFile('Contents/header.xml', Buffer.from(roundTripHeader))
  zip.addFile('Contents/section0.xml', Buffer.from(roundTripSection))
  zip.addFile('BinData/image1.png', transparentPng)
  zip.addFile('META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container/>'))
  zip.addFile('Preview/PrvText.txt', Buffer.from('공개 round-trip fixture'))
  zip.addFile('Unknown/', Buffer.alloc(0))
  const unknownEntry = zip.addFile('Unknown/custom.bin', roundTripSentinels.binary)
  unknownEntry.header.method = 0
  zip.writeZip(path)
  return path
}

/**
 * 글자와 개체가 한 문단에 섞인 합성 문서(직접 작성, 개인정보 없음).
 * - 본문: 일반 문단 → 글자 + 글자처럼 취급한 수식 → 일반 문단 → 글자 + 글상자(`hp:rect`/`hp:drawText`) → 일반 문단
 * - 표 셀 하나: 글자 + 수식 문단, 일반 문단
 * 글자 입력은 되고 문단 나눔·병합·여러 문단 범위는 막혀야 하는 문단(capability `PARAGRAPH_HAS_OBJECT`)을 만든다.
 */
export const INLINE_OBJECT_TEXTS = {
  before: '앞 문단',
  equationLead: '수식 앞 ',
  equationTail: ' 수식 뒤',
  middle: '가운데 문단',
  textBoxLead: '글상자 앞 ',
  textBoxInner: '상자 안 글',
  after: '끝 문단',
  cellEquationLead: '셀 수식 앞 ',
  cellPlain: '셀 일반 문단'
} as const

const inlineEquation = (id: number) =>
  `<hp:equation id="${id}" zOrder="0" numberingType="EQUATION" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" version="Equation Version 60" baseLine="61" textColor="#000000" baseUnit="1000" lineMode="CHAR" font="HYhwpEQ"><hp:sz width="3000" widthRelTo="ABSOLUTE" height="1200" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="56" right="56" top="0" bottom="0"/><hp:script>a over b</hp:script></hp:equation>`
const inlineTextBox =
  `<hp:rect id="7001" zOrder="1" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" ratio="0"><hp:offset x="0" y="0"/><hp:orgSz width="4000" height="1600"/><hp:curSz width="4000" height="1600"/><hp:drawText lastWidth="4000" name="" editable="0"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${INLINE_OBJECT_TEXTS.textBoxInner}</hp:t></hp:run></hp:p></hp:subList><hp:textMargin left="100" right="100" top="100" bottom="100"/></hp:drawText><hp:sz width="4000" widthRelTo="ABSOLUTE" height="1600" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/></hp:rect>`
const inlineObjectParagraph = (runs: string) =>
  `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${runs}</hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1200"/></hp:linesegarray></hp:p>`
const inlineObjectSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="20000" height="20000"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="300" footer="300"/></hp:pagePr></hp:secPr></hp:run><hp:run charPrIDRef="0"><hp:t>구역 첫 문단</hp:t></hp:run></hp:p>
  ${inlineObjectParagraph(`<hp:t>${INLINE_OBJECT_TEXTS.before}</hp:t>`)}
  ${inlineObjectParagraph(`<hp:t>${INLINE_OBJECT_TEXTS.equationLead}</hp:t>${inlineEquation(7000)}<hp:t>${INLINE_OBJECT_TEXTS.equationTail}</hp:t>`)}
  ${inlineObjectParagraph(`<hp:t>${INLINE_OBJECT_TEXTS.middle}</hp:t>`)}
  ${inlineObjectParagraph(`<hp:t>${INLINE_OBJECT_TEXTS.textBoxLead}</hp:t>${inlineTextBox}`)}
  ${inlineObjectParagraph(`<hp:t>${INLINE_OBJECT_TEXTS.after}</hp:t>`)}
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:tbl id="inline-object-table" rowCnt="1" colCnt="1"><hp:sz width="12000" height="3000"/><hp:tr><hp:tc borderFillIDRef="1" header="0"><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="12000" height="3000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${INLINE_OBJECT_TEXTS.cellEquationLead}</hp:t>${inlineEquation(7002)}</hp:run></hp:p><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${INLINE_OBJECT_TEXTS.cellPlain}</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>
</hs:sec>`

export function createInlineObjectHwpx(directory: string, fileName = 'han-flow-inline-objects.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(inlineObjectSection))
  zip.writeZip(path)
  return path
}

/**
 * 쪽보다 큰 개체·표 셀 안 글상자 합성 문서(직접 작성, 개인정보 없음). A4 쪽(본문 높이 72851 HWPUNIT).
 * - 선언 높이 100000인 글자처럼 취급한 수식
 * - 선언 높이 120000이고 글 60줄이 든 글상자(자리 차지)
 * - 1×2 표 왼쪽 셀 안 글자 + 셀보다 넓은 글자처럼 취급한 글상자
 * 자리 표시와 되살린 글이 쪽 본문을 넘지 않고(overflow 0), 화면과 PDF 글자 수가 같은지 verify:matrix가 확인한다.
 */
export const LONG_OBJECT_TEXTS = {
  before: '긴 개체 앞 문단',
  middle: '긴 수식 뒤 문단',
  tableLead: '셀 글상자 앞 ',
  boxInner: '셀 안 글상자 글',
  after: '끝 문단',
  boxLine: (index: number) => `쪽보다 긴 글상자 ${index + 1}번째 줄입니다`
} as const

const a4SecPr = '<hp:secPr><hp:pagePr width="59528" height="84189"><hp:margin left="5669" right="5669" top="5669" bottom="5669" header="2835" footer="2835"/></hp:pagePr></hp:secPr>'
const plainParagraph = (text: string) =>
  `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>`
const objectPos = (inline: boolean) =>
  `<hp:pos treatAsChar="${inline ? 1 : 0}" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>`
const textBox = (id: number, width: number, height: number, inline: boolean, paragraphs: string[]) =>
  `<hp:rect id="${id}" zOrder="${id}" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" ratio="0"><hp:offset x="0" y="0"/><hp:orgSz width="${width}" height="${height}"/><hp:curSz width="${width}" height="${height}"/><hp:drawText lastWidth="${width}" name="" editable="0"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${paragraphs.map((text) => `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`).join('')}</hp:subList><hp:textMargin left="283" right="283" top="283" bottom="283"/></hp:drawText><hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>${objectPos(inline)}</hp:rect>`
const longObjectSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${a4SecPr}</hp:run><hp:run charPrIDRef="0"><hp:t>${LONG_OBJECT_TEXTS.before}</hp:t></hp:run></hp:p>
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:equation id="8000" zOrder="0" numberingType="EQUATION" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" version="Equation Version 60" baseLine="86" textColor="#000000" baseUnit="1000" lineMode="CHAR" font="HYhwpEQ"><hp:sz width="40000" widthRelTo="ABSOLUTE" height="100000" heightRelTo="ABSOLUTE" protect="0"/>${objectPos(true)}<hp:script>sum from {i=1} to {n} i = {n(n+1)} over 2</hp:script></hp:equation></hp:run></hp:p>
  ${plainParagraph(LONG_OBJECT_TEXTS.middle)}
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${textBox(8001, 46000, 120000, false, Array.from({ length: 60 }, (_, index) => LONG_OBJECT_TEXTS.boxLine(index)))}</hp:run></hp:p>
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:tbl id="long-object-table" rowCnt="1" colCnt="2"><hp:sz width="40000" height="4000"/><hp:tr>${[0, 1].map((column) => `<hp:tc borderFillIDRef="1" header="0"><hp:cellAddr colAddr="${column}" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="20000" height="4000"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/><hp:subList vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${column === 0 ? `<hp:t>${LONG_OBJECT_TEXTS.tableLead}</hp:t>${textBox(8002, 30000, 3000, true, [LONG_OBJECT_TEXTS.boxInner])}` : '<hp:t>오른쪽 셀</hp:t>'}</hp:run></hp:p></hp:subList></hp:tc>`).join('')}</hp:tr></hp:tbl></hp:run></hp:p>
  ${plainParagraph(LONG_OBJECT_TEXTS.after)}
</hs:sec>`

export function createLongObjectHwpx(directory: string, fileName = 'han-flow-long-objects.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(longObjectSection))
  zip.writeZip(path)
  return path
}

/**
 * 각주 40개(각 2~3줄)가 든 A4 합성 문서(직접 작성, 개인정보 없음). 각주를 모두 더하면 한 쪽보다 길어, 각주마다 번호 표시가
 * 놓인 쪽 아래에 놓이면서 본문이 각주 높이만큼 줄어 여러 쪽으로 나뉘어야 한다.
 */
export const FOOTNOTE_FLOW_COUNT = 40
const footnote = (index: number) =>
  `<hp:ctrl><hp:footNote number="${index + 1}" suffixChar="41" instId="${9000 + index}"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:ctrl><hp:autoNum num="${index + 1}" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" suffixChar=")" supscript="0"/></hp:autoNum></hp:ctrl><hp:t>각주 ${index + 1}번 본문입니다. 구역 끝 각주 목록은 각주마다 나뉘어 쪽을 넘어 이어져야 합니다. 이 문장은 각주 하나가 여러 줄을 차지하도록 일부러 길게 적었습니다. 화면과 PDF의 글자 수가 같아야 합니다.</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p></hp:subList></hp:footNote></hp:ctrl>`
const footnoteFlowSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${a4SecPr}</hp:run><hp:run charPrIDRef="0"><hp:t>각주 40개 문서</hp:t></hp:run></hp:p>
  ${Array.from({ length: FOOTNOTE_FLOW_COUNT }, (_, index) =>
    `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>본문 ${index + 1}번 문단</hp:t>${footnote(index)}<hp:t/></hp:run><hp:linesegarray><hp:lineseg vertpos="${index * 1600}" vertsize="1000"/></hp:linesegarray></hp:p>`
  ).join('\n  ')}
</hs:sec>`

export function createFootnoteFlowHwpx(directory: string, fileName = 'han-flow-footnote-flow.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(footnoteFlowSection))
  zip.writeZip(path)
  return path
}

/**
 * 쪽 아래 각주 배치 검증용 A4 합성 문서(직접 작성, 개인정보 없음). 구역 정의에 한/글 기본 각주 모양(`hp:footNotePr`)을 둔다.
 * - 첫 본문 문단의 각주 1은 한 쪽보다 긴 문단 하나와 짧은 문단 하나로 되어 있어 쪽을 넘어 줄 단위로 나뉘어야 한다.
 * - 뒤 본문 문단 몇 개에 짧은 각주가 붙는다. 각주는 번호 표시가 놓인 쪽 아래(또는 이어지는 각주 다음)에서 시작해야 한다.
 * verify:matrix가 화면 overflow 0, 번호 표시와 각주 첫 조각의 쪽 일치, 화면과 PDF 글자 수, 긴 각주 편집·저장을 확인한다.
 */
export const LONG_FOOTNOTE_TEXTS = {
  title: '긴 각주 배치 시험 문서',
  longSentence: (index: number) => `긴 각주 ${index + 1}번째 문장은 쪽 아래 각주 영역이 한 쪽을 넘을 때 줄 단위로 나뉘어 다음 쪽으로 이어지는지 확인합니다. `,
  longTail: '긴 각주의 마지막 문단입니다.',
  body: (index: number) => `본문 ${index + 1}번 문단입니다. 쪽 아래 각주가 차지하는 높이만큼 본문이 줄어야 합니다.`,
  shortNote: (index: number) => `짧은 각주 ${index}번 본문입니다.`
} as const
export const LONG_FOOTNOTE_SENTENCES = 60
export const LONG_FOOTNOTE_BODY_PARAGRAPHS = 40
const LONG_FOOTNOTE_SHORT_ANCHORS = [6, 14, 22, 31]
const footNotePr = '<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>'
const flowNote = (number: number, paragraphs: string[]) =>
  `<hp:ctrl><hp:footNote number="${number}" suffixChar="41" instId="${9300 + number}"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${paragraphs.map((text, index) =>
    `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${index === 0 ? `<hp:ctrl><hp:autoNum num="${number}" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" suffixChar=")" supscript="0"/></hp:autoNum></hp:ctrl>` : ''}<hp:t>${text}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>`
  ).join('')}</hp:subList></hp:footNote></hp:ctrl>`
const longFootnoteSection = () => {
  let number = 1
  const body = Array.from({ length: LONG_FOOTNOTE_BODY_PARAGRAPHS }, (_, index) => {
    const note = index === 0
      ? flowNote(number++, [Array.from({ length: LONG_FOOTNOTE_SENTENCES }, (_unused, sentence) => LONG_FOOTNOTE_TEXTS.longSentence(sentence)).join(''), LONG_FOOTNOTE_TEXTS.longTail])
      : LONG_FOOTNOTE_SHORT_ANCHORS.includes(index) ? flowNote(number, [LONG_FOOTNOTE_TEXTS.shortNote(number++)]) : ''
    return `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${LONG_FOOTNOTE_TEXTS.body(index)}</hp:t>${note}${note ? '<hp:t/>' : ''}</hp:run><hp:linesegarray><hp:lineseg vertpos="${(index + 1) * 1600}" vertsize="1000"/></hp:linesegarray></hp:p>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${a4SecPr.replace('</hp:secPr>', `${footNotePr}</hp:secPr>`)}</hp:run><hp:run charPrIDRef="0"><hp:t>${LONG_FOOTNOTE_TEXTS.title}</hp:t></hp:run></hp:p>
  ${body.join('\n  ')}
</hs:sec>`
}

export function createLongFootnoteHwpx(directory: string, fileName = 'han-flow-long-footnote.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(longFootnoteSection()))
  zip.writeZip(path)
  return path
}

/**
 * 편집 범위 확장 검증용 합성 문서(직접 작성, 개인정보 없음). A4 쪽 2쪽.
 * - 구역 첫 문단: 구역 정의와 머리말·꼬리말(양쪽 쪽에 같은 것이 나온다)
 * - 각주가 붙는 문단(각주 본문 앞에 자동 번호 control), 표만 든 문단(표 앞·뒤 글자 없음), 표 뒤 빈 `<hp:t/>` 문단
 * - 둘째 쪽(pageBreak) 문단에 미주
 * verify:matrix가 표 앞·뒤 글자·각주·미주 본문·머리말·꼬리말에 입력하고 저장한 뒤 다시 열어 글자를 확인한다.
 */
export const EDIT_SCOPE_TEXTS = {
  header: '편집 범위 머리말',
  footer: '편집 범위 꼬리말',
  title: '편집 범위 시험 문서',
  footnoteLead: '각주가 붙는 문장',
  footnoteBody: '각주 본문',
  tableCell: (row: number, column: number) => `표 ${row + 1}-${column + 1}`,
  afterTable: '표 뒤 문단',
  secondPage: '둘째 쪽 문단',
  endnoteBody: '미주 본문'
} as const

const scopeNote = (name: 'hp:footNote' | 'hp:endNote', number: number, text: string) =>
  `<hp:ctrl><${name} number="${number}" suffixChar="41" instId="${name === 'hp:footNote' ? 9100 : 9200}"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:ctrl><hp:autoNum num="${number}" numType="${name === 'hp:footNote' ? 'FOOTNOTE' : 'ENDNOTE'}"><hp:autoNumFormat type="DIGIT" suffixChar=")" supscript="0"/></hp:autoNum></hp:ctrl><hp:t>${text}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p></hp:subList></${name}></hp:ctrl>`
const scopeTable = (id: string) => `<hp:tbl id="${id}" rowCnt="1" colCnt="2" pageBreak="CELL" repeatHeader="0"><hp:sz width="40000" height="2000"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:tr>${[0, 1].map((column) => `<hp:tc borderFillIDRef="1" header="0"><hp:cellAddr colAddr="${column}" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="20000" height="2000"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/><hp:subList vertAlign="CENTER"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${EDIT_SCOPE_TEXTS.tableCell(0, column)}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p></hp:subList></hp:tc>`).join('')}</hp:tr></hp:tbl>`
const scopeLine = (top: number, height = 1000) => `<hp:linesegarray><hp:lineseg vertpos="${top}" vertsize="${height}"/></hp:linesegarray>`
const editScopeSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${a4SecPr}<hp:ctrl><hp:header id="1" applyPageType="BOTH"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${EDIT_SCOPE_TEXTS.header}</hp:t></hp:run></hp:p></hp:subList></hp:header></hp:ctrl><hp:ctrl><hp:footer id="2" applyPageType="BOTH"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="BOTTOM"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${EDIT_SCOPE_TEXTS.footer}</hp:t></hp:run></hp:p></hp:subList></hp:footer></hp:ctrl></hp:run><hp:run charPrIDRef="0"><hp:t>${EDIT_SCOPE_TEXTS.title}</hp:t></hp:run>${scopeLine(0)}</hp:p>
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${EDIT_SCOPE_TEXTS.footnoteLead}</hp:t>${scopeNote('hp:footNote', 1, EDIT_SCOPE_TEXTS.footnoteBody)}<hp:t/></hp:run>${scopeLine(1600)}</hp:p>
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${scopeTable('scope-table')}</hp:run>${scopeLine(3200, 2000)}</hp:p>
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${scopeTable('scope-table-trailing')}<hp:t/></hp:run>${scopeLine(5400, 2000)}</hp:p>
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${EDIT_SCOPE_TEXTS.afterTable}</hp:t></hp:run>${scopeLine(7600)}</hp:p>
  <hp:p paraPrIDRef="0" pageBreak="1"><hp:run charPrIDRef="0"><hp:t>${EDIT_SCOPE_TEXTS.secondPage}</hp:t>${scopeNote('hp:endNote', 1, EDIT_SCOPE_TEXTS.endnoteBody)}<hp:t/></hp:run>${scopeLine(0)}</hp:p>
</hs:sec>`

export function createEditScopeHwpx(directory: string, fileName = 'han-flow-edit-scope.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(editScopeSection))
  zip.writeZip(path)
  return path
}

/**
 * 글자처럼 취급하지 않는 개체(`hp:pos treatAsChar="0"`) 합성 문서(직접 작성, 개인정보 없음). A4, 머리말·꼬리말 여백 2835.
 * - 1쪽: 용지 기준 글 앞 글상자(`textBox`), 쪽 아래·오른쪽 기준 자리 차지 그림(`picture`, 본문 아래 띠), 문단 기준 글 옆 그림,
 *   문단 기준 자리 차지 글상자(단 가운데), 쪽 가운데 글 뒤 사각형
 * - 쪽 나눔 문단(마지막 쪽): 쪽 위 가운데 기준 자리 차지 표(`table`, 셀 글 편집 가능, 본문 위 띠)
 * verify:matrix가 화면 개체 상자 위치를 아래 기대값(HWPUNIT, 용지 왼쪽 위 기준)과 비교하고 자리 차지 개체와 본문 글이 겹치지 않는지 본다.
 */
export const FLOATING_OBJECT_TEXTS = {
  title: '떠 있는 개체 시험 문서',
  textBoxInner: '용지 기준 글상자 글',
  bandBoxInner: '문단 기준 글상자 글',
  tableCell: '쪽 위 표 셀 글',
  body: (index: number) => `본문 ${index + 1}번 문단입니다. 원본 위치에 놓인 개체를 피해 흘러야 하는 글을 두 줄 넘게 이어 쓰려고 일부러 길게 적었습니다. 화면과 PDF의 글자 수가 같아야 합니다.`
} as const
export const FLOATING_OBJECT_PAGE = { width: 59528, height: 84188, left: 5669, right: 5669, top: 5669, bottom: 4252, header: 2835, footer: 2835 } as const
/** 쪽 본문 위 끝·아래 끝(용지 기준). 한/글처럼 위쪽 여백 + 머리말 여백 아래에서 시작해 꼬리말 여백 + 아래쪽 여백 위에서 끝난다. */
const FLOATING_BODY_TOP = FLOATING_OBJECT_PAGE.top + FLOATING_OBJECT_PAGE.header
const FLOATING_BODY_BOTTOM = FLOATING_OBJECT_PAGE.height - FLOATING_OBJECT_PAGE.bottom - FLOATING_OBJECT_PAGE.footer
/** 화면에서 기대하는 개체 상자(HWPUNIT, 용지 왼쪽 위 기준). */
export const FLOATING_OBJECT_EXPECTED = {
  // 용지 기준(왼쪽 30000, 위 40000).
  textBox: { page: 1, x: 30000, y: 40000, width: 20000, height: 6000 },
  // 쪽 본문 오른쪽 아래에서 안쪽으로 가로 1000·세로 2000.
  picture: { page: 1, x: 59528 - 5669 - 14000 - 1000, y: FLOATING_BODY_BOTTOM - 9000 - 2000, width: 14000, height: 9000 },
  // 쪽 본문 위 가운데.
  table: { x: 5669 + (59528 - 5669 * 2 - 30000) / 2, y: FLOATING_BODY_TOP, width: 30000 }
} as const

const floatingPos = (vertRelTo: string, horzRelTo: string, vertAlign: string, horzAlign: string, vertOffset: number, horzOffset: number) =>
  `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="${vertRelTo}" horzRelTo="${horzRelTo}" vertAlign="${vertAlign}" horzAlign="${horzAlign}" vertOffset="${vertOffset}" horzOffset="${horzOffset}"/>`
const floatingTextBox = (id: number, wrap: string, width: number, height: number, pos: string, text: string) =>
  `<hp:rect id="${id}" zOrder="${id}" numberingType="PICTURE" textWrap="${wrap}" textFlow="BOTH_SIDES" lock="0" ratio="0"><hp:offset x="0" y="0"/><hp:orgSz width="${width}" height="${height}"/><hp:curSz width="${width}" height="${height}"/><hp:lineShape color="#1F4E79" width="57" style="SOLID"/><hc:fillBrush><hc:winBrush faceColor="#EAF1FB" hatchColor="#000000" alpha="0"/></hc:fillBrush><hp:drawText lastWidth="${width}" name="" editable="0"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList><hp:textMargin left="283" right="283" top="283" bottom="283"/></hp:drawText><hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>${pos}<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:rect>`
const floatingPicture = (id: number, wrap: string, width: number, height: number, pos: string, outMargin = 0) =>
  `<hp:pic id="${id}" zOrder="${id}" numberingType="PICTURE" textWrap="${wrap}" textFlow="BOTH_SIDES" lock="0" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="${width}" height="${height}"/><hp:curSz width="${width}" height="${height}"/><hc:img binaryItemIDRef="image1"/><hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>${pos}<hp:outMargin left="${outMargin}" right="${outMargin}" top="${outMargin}" bottom="${outMargin}"/></hp:pic>`
const floatingParagraph = (runs: string, pageBreak = false) =>
  `<hp:p paraPrIDRef="0"${pageBreak ? ' pageBreak="1"' : ''}><hp:run charPrIDRef="0">${runs}</hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>`
const floatingBody = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => floatingParagraph(`<hp:t>${FLOATING_OBJECT_TEXTS.body(from + index)}</hp:t>`)).join('\n  ')
const floatingSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="${FLOATING_OBJECT_PAGE.width}" height="${FLOATING_OBJECT_PAGE.height}"><hp:margin left="${FLOATING_OBJECT_PAGE.left}" right="${FLOATING_OBJECT_PAGE.right}" top="${FLOATING_OBJECT_PAGE.top}" bottom="${FLOATING_OBJECT_PAGE.bottom}" header="${FLOATING_OBJECT_PAGE.header}" footer="${FLOATING_OBJECT_PAGE.footer}"/></hp:pagePr></hp:secPr></hp:run><hp:run charPrIDRef="0"><hp:t>${FLOATING_OBJECT_TEXTS.title}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>
  ${floatingParagraph(`<hp:t>${FLOATING_OBJECT_TEXTS.body(0)}</hp:t>${floatingTextBox(9501, 'IN_FRONT_OF_TEXT', 20000, 6000, floatingPos('PAPER', 'PAPER', 'TOP', 'LEFT', 40000, 30000), FLOATING_OBJECT_TEXTS.textBoxInner)}`)}
  ${floatingParagraph(`<hp:t>${FLOATING_OBJECT_TEXTS.body(1)}</hp:t>${floatingPicture(9502, 'TOP_AND_BOTTOM', 14000, 9000, floatingPos('PAGE', 'PAGE', 'BOTTOM', 'RIGHT', 2000, 1000), 283)}`)}
  ${floatingParagraph(`${floatingPicture(9503, 'SQUARE', 8000, 5000, floatingPos('PARA', 'COLUMN', 'TOP', 'RIGHT', 0, 0), 283)}<hp:t>${FLOATING_OBJECT_TEXTS.body(2)} ${FLOATING_OBJECT_TEXTS.body(3)}</hp:t>`)}
  ${floatingParagraph(`${floatingTextBox(9504, 'TOP_AND_BOTTOM', 24000, 3000, floatingPos('PARA', 'COLUMN', 'TOP', 'CENTER', 300, 0), FLOATING_OBJECT_TEXTS.bandBoxInner)}<hp:t>${FLOATING_OBJECT_TEXTS.body(4)}</hp:t>`)}
  ${floatingParagraph(`<hp:rect id="9505" zOrder="0" numberingType="PICTURE" textWrap="BEHIND_TEXT" textFlow="BOTH_SIDES" lock="0" ratio="0"><hp:offset x="0" y="0"/><hp:orgSz width="30000" height="8000"/><hp:curSz width="30000" height="8000"/><hp:lineShape color="#999999" width="33" style="SOLID"/><hc:fillBrush><hc:winBrush faceColor="#F2F2F2" hatchColor="#000000" alpha="0"/></hc:fillBrush><hp:sz width="30000" widthRelTo="ABSOLUTE" height="8000" heightRelTo="ABSOLUTE" protect="0"/>${floatingPos('PAGE', 'PAGE', 'CENTER', 'CENTER', 0, 0)}<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:rect><hp:t>${FLOATING_OBJECT_TEXTS.body(5)}</hp:t>`)}
  ${floatingBody(6, 12)}
  ${floatingParagraph(`<hp:tbl id="floating-table" zOrder="9506" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" rowCnt="1" colCnt="1" pageBreak="NONE" repeatHeader="0"><hp:sz width="30000" widthRelTo="ABSOLUTE" height="3000" heightRelTo="ABSOLUTE" protect="0"/>${floatingPos('PAGE', 'PAGE', 'TOP', 'CENTER', 0, 0)}<hp:outMargin left="0" right="0" top="0" bottom="567"/><hp:tr><hp:tc borderFillIDRef="1" header="0"><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="30000" height="3000"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/><hp:subList vertAlign="CENTER"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${FLOATING_OBJECT_TEXTS.tableCell}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl><hp:t>${FLOATING_OBJECT_TEXTS.body(18)}</hp:t>`, true)}
  ${floatingBody(19, 4)}
</hs:sec>`
// 2×2 파란 그림(위치 확인용).
const solidPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGPwqj3iVXuEAUIBAClaBi1M089YAAAAAElFTkSuQmCC', 'base64')

export function createFloatingObjectHwpx(directory: string, fileName = 'han-flow-floating-objects.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(floatingSection))
  zip.addFile('BinData/image1.png', solidPng)
  zip.writeZip(path)
  return path
}

/**
 * 쪽 본문보다 높은 그림 두 개가 든 A4 합성 문서(직접 작성, 개인정보 없음): 글자처럼 놓인 그림(30000×150000, 줄 배치도 그 높이)과
 * 문단 기준 자리 차지 그림(20000×140000). 자리 표시와 같은 규칙으로 너비·높이를 같은 비율로 줄여 한 쪽 안에 그려야 한다.
 */
export const LONG_PICTURE_TEXTS = { before: '긴 그림 앞 문단', middle: '긴 그림 사이 문단', after: '긴 그림 뒤 문단' } as const
export const LONG_PICTURE_SIZES = { inline: { width: 30000, height: 150000 }, positioned: { width: 20000, height: 140000 } } as const
const longPicture = (id: number, size: { width: number; height: number }, inline: boolean) =>
  `<hp:pic id="${id}" zOrder="${id}" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="${size.width}" height="${size.height}"/><hp:curSz width="${size.width}" height="${size.height}"/><hc:img binaryItemIDRef="image1"/><hp:sz width="${size.width}" widthRelTo="ABSOLUTE" height="${size.height}" heightRelTo="ABSOLUTE" protect="0"/>${objectPos(inline)}<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>`
const longPictureSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${a4SecPr}</hp:run><hp:run charPrIDRef="0"><hp:t>${LONG_PICTURE_TEXTS.before}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${longPicture(9701, LONG_PICTURE_SIZES.inline, true)}</hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="${LONG_PICTURE_SIZES.inline.height}"/></hp:linesegarray></hp:p>
  ${plainParagraph(LONG_PICTURE_TEXTS.middle)}
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${longPicture(9702, LONG_PICTURE_SIZES.positioned, false)}<hp:t>${LONG_PICTURE_TEXTS.after}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>
</hs:sec>`

export function createLongPictureHwpx(directory: string, fileName = 'han-flow-long-pictures.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(longPictureSection))
  zip.addFile('BinData/image1.png', solidPng)
  zip.writeZip(path)
  return path
}

/**
 * 다단 배치 E2E용 합성 문서(직접 작성, 개인정보 없음). 쪽 30000×20000, 왼쪽·오른쪽·위·아래 여백 1500(본문 폭 27000). 구역마다:
 * - 구역 0(1쪽): 한 단 제목 → 문단 안 새 다단 정의(2단, 서로 다른 너비 9000·16500, 간격 1500, 실선 구분선) 6문단 → 다시 한 단.
 *   가운데 2단 영역은 같은 쪽 아래 한 단 영역이 이어지므로 단 높이를 맞춰 3문단씩 놓인다.
 * - 구역 1(2쪽): 오른쪽부터(`RIGHT`) 같은 너비 2단, 단 기준 가로 위치 그림(첫 단 왼쪽 끝), 각주, 단 나눔.
 * - 구역 2(3·4쪽): 맞쪽(`MIRROR`) 2단. 홀수 쪽은 왼쪽부터, 짝수 쪽은 오른쪽부터 놓인다.
 * - 구역 3(5쪽): 배분 다단(`BALANCED_NEWSPAPER`) 3단 6문단 → 구역 끝에서 2문단씩 놓인다.
 * - 구역 4(6쪽): 평행 다단(`PARALLEL`) 2단. 마지막 단의 단 나눔은 같은 쪽 아래 새 줄을 시작한다.
 * verify:matrix가 글자가 기대한 쪽·영역·단에 있고 단 가로 위치·구분선 위치가 기대값(HWPUNIT, 용지 왼쪽 기준)과 같은지 본다.
 */
export const COLUMN_LAYOUT_PAGE = { width: 30000, height: 20000, margin: 1500 } as const
const columnLayoutColPr = (attributes: string, children = '') => `<hp:ctrl><hp:colPr id="" ${attributes}>${children}</hp:colPr></hp:ctrl>`
const columnLayoutParagraph = (top: number, runs: string, flags = '') =>
  `<hp:p paraPrIDRef="0"${flags}><hp:run charPrIDRef="0">${runs}</hp:run><hp:linesegarray><hp:lineseg vertpos="${top}" vertsize="1000"/></hp:linesegarray></hp:p>`
const columnLayoutSection = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  ${body}
</hs:sec>`
const columnLayoutSecPr = `<hp:secPr><hp:pagePr width="${COLUMN_LAYOUT_PAGE.width}" height="${COLUMN_LAYOUT_PAGE.height}"><hp:margin left="${COLUMN_LAYOUT_PAGE.margin}" right="${COLUMN_LAYOUT_PAGE.margin}" top="${COLUMN_LAYOUT_PAGE.margin}" bottom="${COLUMN_LAYOUT_PAGE.margin}" header="0" footer="0"/></hp:pagePr></hp:secPr>`
const columnLayoutPicture = `<hp:pic id="9601" zOrder="9601" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="3000" height="3000"/><hp:curSz width="3000" height="3000"/><hc:img binaryItemIDRef="image1"/><hp:sz width="3000" widthRelTo="ABSOLUTE" height="3000" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PAGE" horzRelTo="COLUMN" vertAlign="CENTER" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>`
const columnLayoutFootnote = `<hp:ctrl><hp:footNote number="1" suffixChar="41" instId="9602"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:ctrl><hp:autoNum num="1" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" suffixChar=")" supscript="0"/></hp:autoNum></hp:ctrl><hp:t>단 각주</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p></hp:subList></hp:footNote></hp:ctrl>`
const sameColumns = (type: string, layout: string, count: number, line = '') =>
  columnLayoutColPr(`type="${type}" layout="${layout}" colCount="${count}" sameSz="1" sameGap="1500"`, line)
const columnLayoutSections = [
  columnLayoutSection([
    columnLayoutParagraph(0, `${columnLayoutSecPr}${columnLayoutColPr('type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"')}<hp:t>다단 영역 시험</hp:t>`),
    columnLayoutParagraph(1600, `${columnLayoutColPr('type="NEWSPAPER" layout="LEFT" colCount="2" sameSz="0" sameGap="0"', '<hp:colLine type="SOLID" width="0.12 mm" color="#3355AA"/><hp:colSz width="9000" gap="1500"/><hp:colSz width="16500" gap="0"/>')}<hp:t>가운데단1</hp:t>`),
    ...[2, 3, 4, 5, 6].map((index) => columnLayoutParagraph(1600 * index, `<hp:t>가운데단${index}</hp:t>`)),
    columnLayoutParagraph(11200, `${columnLayoutColPr('type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"')}<hp:t>한단끝문단</hp:t>`)
  ].join('\n  ')),
  columnLayoutSection([
    columnLayoutParagraph(0, `${sameColumns('NEWSPAPER', 'RIGHT', 2, '<hp:colLine type="DASH" width="0.4 mm" color="#AA3333"/>')}<hp:t>오른쪽첫단1</hp:t>${columnLayoutPicture}`),
    columnLayoutParagraph(1600, `<hp:t>오른쪽첫단2</hp:t>${columnLayoutFootnote}<hp:t/>`),
    columnLayoutParagraph(3200, '<hp:t>오른쪽둘째단1</hp:t>', ' columnBreak="1"')
  ].join('\n  ')),
  columnLayoutSection([
    columnLayoutParagraph(0, `${sameColumns('NEWSPAPER', 'MIRROR', 2)}<hp:t>맞쪽홀1</hp:t>`),
    columnLayoutParagraph(1600, '<hp:t>맞쪽홀2</hp:t>', ' columnBreak="1"'),
    columnLayoutParagraph(3200, '<hp:t>맞쪽짝1</hp:t>', ' pageBreak="1"'),
    columnLayoutParagraph(4800, '<hp:t>맞쪽짝2</hp:t>', ' columnBreak="1"')
  ].join('\n  ')),
  columnLayoutSection([
    columnLayoutParagraph(0, `${sameColumns('BALANCED_NEWSPAPER', 'LEFT', 3)}<hp:t>배분1</hp:t>`),
    ...[2, 3, 4, 5, 6].map((index) => columnLayoutParagraph(1600 * (index - 1), `<hp:t>배분${index}</hp:t>`))
  ].join('\n  ')),
  columnLayoutSection([
    columnLayoutParagraph(0, `${sameColumns('PARALLEL', 'LEFT', 2)}<hp:t>평행가1</hp:t>`),
    columnLayoutParagraph(1600, '<hp:t>평행나1</hp:t>', ' columnBreak="1"'),
    columnLayoutParagraph(3200, '<hp:t>평행가2</hp:t>', ' columnBreak="1"'),
    columnLayoutParagraph(4800, '<hp:t>평행나2</hp:t>', ' columnBreak="1"')
  ].join('\n  '))
]

const columnLeft = COLUMN_LAYOUT_PAGE.margin
const sameWidth2 = (27000 - 1500) / 2
const sameWidth3 = (27000 - 3000) / 3
/** 글자마다 기대하는 쪽(1부터)·영역·단(흐름 순서)과 그 단의 용지 기준 왼쪽 끝·폭(HWPUNIT). */
export const COLUMN_LAYOUT_EXPECTED = {
  pages: 6,
  columns: [
    { text: '다단 영역 시험', page: 1, region: 0, column: 0, left: columnLeft, width: 27000 },
    ...[1, 2, 3].map((index) => ({ text: `가운데단${index}`, page: 1, region: 1, column: 0, left: columnLeft, width: 9000 })),
    ...[4, 5, 6].map((index) => ({ text: `가운데단${index}`, page: 1, region: 1, column: 1, left: columnLeft + 10500, width: 16500 })),
    { text: '한단끝문단', page: 1, region: 2, column: 0, left: columnLeft, width: 27000 },
    { text: '오른쪽첫단1', page: 2, region: 0, column: 0, left: columnLeft + 27000 - sameWidth2, width: sameWidth2 },
    { text: '오른쪽첫단2', page: 2, region: 0, column: 0, left: columnLeft + 27000 - sameWidth2, width: sameWidth2 },
    { text: '오른쪽둘째단1', page: 2, region: 0, column: 1, left: columnLeft, width: sameWidth2 },
    { text: '맞쪽홀1', page: 3, region: 0, column: 0, left: columnLeft, width: sameWidth2 },
    { text: '맞쪽홀2', page: 3, region: 0, column: 1, left: columnLeft + sameWidth2 + 1500, width: sameWidth2 },
    { text: '맞쪽짝1', page: 4, region: 0, column: 0, left: columnLeft + sameWidth2 + 1500, width: sameWidth2 },
    { text: '맞쪽짝2', page: 4, region: 0, column: 1, left: columnLeft, width: sameWidth2 },
    ...[1, 2, 3, 4, 5, 6].map((index) => ({ text: `배분${index}`, page: 5, region: 0, column: Math.floor((index - 1) / 2), left: columnLeft + Math.floor((index - 1) / 2) * (sameWidth3 + 1500), width: sameWidth3 })),
    { text: '평행가1', page: 6, region: 0, column: 0, left: columnLeft, width: sameWidth2 },
    { text: '평행나1', page: 6, region: 0, column: 1, left: columnLeft + sameWidth2 + 1500, width: sameWidth2 },
    { text: '평행가2', page: 6, region: 1, column: 0, left: columnLeft, width: sameWidth2 },
    { text: '평행나2', page: 6, region: 1, column: 1, left: columnLeft + sameWidth2 + 1500, width: sameWidth2 }
  ],
  /** 단 사이 구분선(간격 한가운데, 용지 기준). */
  rules: [
    { page: 1, region: 1, x: columnLeft + 9000 + 750 },
    { page: 2, region: 0, x: columnLeft + sameWidth2 + 750 }
  ],
  /** 단 기준(`horzRelTo="COLUMN"`) 왼쪽 맞춤 그림: 오른쪽부터 놓인 첫 단의 왼쪽 끝. */
  picture: { page: 2, x: columnLeft + 27000 - sameWidth2, width: 3000 }
} as const

export function createColumnLayoutHwpx(directory: string, fileName = 'han-flow-column-layout.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  columnLayoutSections.forEach((section, index) => zip.addFile(`Contents/section${index}.xml`, Buffer.from(section)))
  zip.addFile('BinData/image1.png', solidPng)
  zip.writeZip(path)
  return path
}

/**
 * 표 선언 높이·쪽 기준 글 옆 배치·칸 안 원본 위치 개체 합성 문서(직접 작성, 개인정보 없음). A4(`FLOATING_OBJECT_PAGE`와 같은 여백).
 * - 머리말: 용지 기준 위·왼쪽(가로 3000, 세로 1000) 자리 차지 그림 2000×1000
 * - 쪽 위 왼쪽 기준 자리 차지 표(40000×12000, 1행 2열, 셀 안쪽 여백 500). 셀 글은 한 줄이라 선언 높이 12000으로 그려야 한다.
 *   첫 셀에 쪽 아래·오른쪽 기준 자리 차지 그림 3000×2000(셀 안쪽 여백 안 오른쪽 아래 끝)
 * - 쪽 위·오른쪽 기준 글 옆 배치(`SQUARE`, 양쪽) 그림 15000×12000(쪽 본문 위 끝에서 18000): 본문 글이 그림 왼쪽으로 흐른다.
 * - 용지 기준 글 앞 글상자(가로 30000, 세로 60000, 20000×10000, 안쪽 여백 283) 안 쪽 기준 위·왼쪽(1000, 1000) 그림 2000×2000
 * verify:matrix가 화면 개체 상자를 아래 기대값(HWPUNIT, 용지 왼쪽 위 기준)과 비교하고, 글 옆 배치 그림 옆에 본문 글이 흐르는지 본다.
 */
export const OBJECT_LAYOUT_TEXTS = {
  title: '개체 배치 시험 문서',
  header: '개체 배치 머리말',
  firstCell: '첫 셀 글',
  secondCell: '둘째 셀 글',
  textBox: '글상자 안 글',
  body: (index: number) => `개체 배치 본문 ${index + 1}번 문단입니다. 쪽 기준 글 옆 배치 그림의 왼쪽 빈 곳으로 줄이 좁아져 흘러야 하는 글을 여러 줄 이어 쓰려고 일부러 길게 적었습니다.`
} as const
const OBJECT_LAYOUT_TABLE = { width: 40000, height: 12000, cellWidth: 20000, cellMargin: 500 } as const
/** 화면에서 기대하는 개체 상자(HWPUNIT, 용지 왼쪽 위 기준, 쪽 본문은 위쪽 여백 + 머리말 여백 아래에서 시작). */
export const OBJECT_LAYOUT_EXPECTED = {
  header: { x: 3000, y: 1000, width: 2000, height: 1000 },
  table: { x: 5669, y: FLOATING_BODY_TOP, width: OBJECT_LAYOUT_TABLE.width, height: OBJECT_LAYOUT_TABLE.height },
  // 셀(안쪽 여백 포함)을 용지로, 안쪽 여백 안을 쪽 본문으로 본다.
  cellPicture: {
    x: 5669 + OBJECT_LAYOUT_TABLE.cellWidth - OBJECT_LAYOUT_TABLE.cellMargin - 3000,
    y: FLOATING_BODY_TOP + OBJECT_LAYOUT_TABLE.height - OBJECT_LAYOUT_TABLE.cellMargin - 2000,
    width: 3000,
    height: 2000
  },
  squarePicture: { x: 59528 - 5669 - 15000, y: FLOATING_BODY_TOP + 18000, width: 15000, height: 12000 },
  // 글상자(용지 기준 세로 60000) 테두리(57)·안쪽 여백(283) 안에서 (1000, 1000).
  textBoxPicture: { x: 30000 + 57 + 283 + 1000, y: 60000 + 57 + 283 + 1000, width: 2000, height: 2000 }
} as const
const layoutPicture = (id: number, wrap: string, width: number, height: number, pos: string) =>
  `<hp:pic id="${id}" zOrder="${id}" numberingType="PICTURE" textWrap="${wrap}" textFlow="BOTH_SIDES" lock="0" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="${width}" height="${height}"/><hp:curSz width="${width}" height="${height}"/><hc:img binaryItemIDRef="image1"/><hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>${pos}<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>`
const layoutCell = (column: number, runs: string) =>
  `<hp:tc borderFillIDRef="1" header="0"><hp:subList vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${runs}</hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p></hp:subList><hp:cellAddr colAddr="${column}" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${OBJECT_LAYOUT_TABLE.cellWidth}" height="${OBJECT_LAYOUT_TABLE.height}"/><hp:cellMargin left="${OBJECT_LAYOUT_TABLE.cellMargin}" right="${OBJECT_LAYOUT_TABLE.cellMargin}" top="${OBJECT_LAYOUT_TABLE.cellMargin}" bottom="${OBJECT_LAYOUT_TABLE.cellMargin}"/></hp:tc>`
const objectLayoutSection = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="${FLOATING_OBJECT_PAGE.width}" height="${FLOATING_OBJECT_PAGE.height}"><hp:margin left="${FLOATING_OBJECT_PAGE.left}" right="${FLOATING_OBJECT_PAGE.right}" top="${FLOATING_OBJECT_PAGE.top}" bottom="${FLOATING_OBJECT_PAGE.bottom}" header="${FLOATING_OBJECT_PAGE.header}" footer="${FLOATING_OBJECT_PAGE.footer}"/></hp:pagePr></hp:secPr><hp:ctrl><hp:header id="1" applyPageType="BOTH"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${layoutPicture(9601, 'TOP_AND_BOTTOM', 2000, 1000, floatingPos('PAPER', 'PAPER', 'TOP', 'LEFT', 1000, 3000))}<hp:t>${OBJECT_LAYOUT_TEXTS.header}</hp:t></hp:run></hp:p></hp:subList></hp:header></hp:ctrl></hp:run><hp:run charPrIDRef="0"><hp:t>${OBJECT_LAYOUT_TEXTS.title}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>
  ${floatingParagraph(`<hp:tbl id="object-layout-table" zOrder="9602" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" rowCnt="1" colCnt="2" pageBreak="NONE" repeatHeader="0"><hp:sz width="${OBJECT_LAYOUT_TABLE.width}" widthRelTo="ABSOLUTE" height="${OBJECT_LAYOUT_TABLE.height}" heightRelTo="ABSOLUTE" protect="0"/>${floatingPos('PAGE', 'PAGE', 'TOP', 'LEFT', 0, 0)}<hp:outMargin left="0" right="0" top="0" bottom="567"/><hp:tr>${layoutCell(0, `<hp:t>${OBJECT_LAYOUT_TEXTS.firstCell}</hp:t>${layoutPicture(9603, 'TOP_AND_BOTTOM', 3000, 2000, floatingPos('PAGE', 'PAGE', 'BOTTOM', 'RIGHT', 0, 0))}`)}${layoutCell(1, `<hp:t>${OBJECT_LAYOUT_TEXTS.secondCell}</hp:t>`)}</hp:tr></hp:tbl><hp:t>${OBJECT_LAYOUT_TEXTS.body(0)}</hp:t>`)}
  ${floatingParagraph(`${layoutPicture(9604, 'SQUARE', 15000, 12000, floatingPos('PAGE', 'PAGE', 'TOP', 'RIGHT', 18000, 0))}<hp:t>${OBJECT_LAYOUT_TEXTS.body(1)}</hp:t>`)}
  ${floatingParagraph(`<hp:rect id="9605" zOrder="9605" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" ratio="0"><hp:offset x="0" y="0"/><hp:orgSz width="20000" height="10000"/><hp:curSz width="20000" height="10000"/><hp:lineShape color="#1F4E79" width="57" style="SOLID"/><hc:fillBrush><hc:winBrush faceColor="#EAF1FB" hatchColor="#000000" alpha="0"/></hc:fillBrush><hp:drawText lastWidth="20000" name="" editable="0"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${OBJECT_LAYOUT_TEXTS.textBox}</hp:t>${layoutPicture(9606, 'IN_FRONT_OF_TEXT', 2000, 2000, floatingPos('PAGE', 'PAGE', 'TOP', 'LEFT', 1000, 1000))}</hp:run></hp:p></hp:subList><hp:textMargin left="283" right="283" top="283" bottom="283"/></hp:drawText><hp:sz width="20000" widthRelTo="ABSOLUTE" height="10000" heightRelTo="ABSOLUTE" protect="0"/>${floatingPos('PAPER', 'PAPER', 'TOP', 'LEFT', 60000, 30000)}<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:rect><hp:t>${OBJECT_LAYOUT_TEXTS.body(2)}</hp:t>`)}
  ${Array.from({ length: 10 }, (_, index) => floatingParagraph(`<hp:t>${OBJECT_LAYOUT_TEXTS.body(3 + index)}</hp:t>`)).join('\n  ')}
</hs:sec>`

export function createObjectLayoutHwpx(directory: string, fileName = 'han-flow-object-layout.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section0.xml', Buffer.from(objectLayoutSection))
  zip.addFile('BinData/image1.png', solidPng)
  zip.writeZip(path)
  return path
}

/**
 * 쪽 꾸밈·개체 회전·줄 단위 쪽 나눔 합성 문서(직접 작성, 개인정보 없음). A4(`FLOATING_OBJECT_PAGE`와 같은 여백, 머리말·꼬리말 여백 2835).
 * - 구역 1: 머리말·꼬리말·아래 가운데 쪽 번호. 용지 기준 글 앞 그림(8000×2000, 90도 회전), 서로 겹친 글 앞 글상자 둘(zOrder 20·10,
 *   문서 순서는 반대), 본문 문단 뒤 한 쪽보다 긴 문단 하나 → 쪽 사이에서 줄 단위로 나뉘어야 한다.
 * - 구역 2: 배분 다단(`BALANCED_NEWSPAPER`) 2단에 긴 문단 하나 → 두 단에 줄 단위로 나뉘어 높이를 맞춰야 한다.
 * verify:matrix가 쪽 번호가 꼬리말 띠 아래 끝(본문 밖)에 있고 본문과 겹치지 않는지, 회전 그림 상자, 쌓임 순서, 줄 단위 조각의 쪽,
 * 화면/PDF 글자 수와 나뉜 문단 앞 조각 편집→Save As→재열기를 본다.
 */
export const PAGE_FLOW_TEXTS = {
  title: '쪽 흐름 시험 문서',
  header: '쪽 흐름 머리말',
  footer: '쪽 흐름 꼬리말',
  front: '위 글상자',
  back: '아래 글상자',
  body: (index: number) => `쪽 흐름 본문 ${index + 1}번 문단입니다. 쪽 아래를 채우려고 두 줄 넘게 이어 쓴 글입니다. 화면과 PDF의 글자 수가 같아야 합니다.`,
  long: (index: number) => `긴 문단 ${index + 1}번째 문장은 쪽 아래에서 줄 단위로 나뉘어 다음 쪽 처음으로 이어져야 합니다.`,
  column: (index: number) => `배분 다단 ${index + 1}번째 문장은 두 단에 줄 단위로 나뉘어 높이가 맞아야 합니다.`
} as const
export const PAGE_FLOW_LONG_SENTENCES = 45
export const PAGE_FLOW_COLUMN_SENTENCES = 14
/** 화면에서 기대하는 상자(HWPUNIT, 용지 왼쪽 위 기준). */
export const PAGE_FLOW_EXPECTED = {
  /** 쪽 번호 상자 아래 끝: 꼬리말 띠 아래 끝(용지 높이 - 아래쪽 여백). 본문 아래 끝은 그보다 꼬리말 여백만큼 위다. */
  pageNumberBottom: FLOATING_OBJECT_PAGE.height - FLOATING_OBJECT_PAGE.bottom,
  bodyBottom: FLOATING_BODY_BOTTOM,
  /** 머리말 띠 위 끝(위쪽 여백)과 본문 위 끝. */
  headerTop: FLOATING_OBJECT_PAGE.top,
  bodyTop: FLOATING_BODY_TOP,
  /** 90도 회전 그림: 회전 중심(상자 가운데)은 그대로이고 화면 상자는 가로·세로가 바뀐다. */
  rotatedPicture: { page: 1, x: 30000 + 4000 - 1000, y: 15000 + 1000 - 4000, width: 2000, height: 8000 }
} as const
const pageFlowParagraph = (runs: string) =>
  `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${runs}</hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>`
const pageFlowTextBox = (id: number, zOrder: number, x: number, y: number, text: string, color: string) =>
  `<hp:rect id="${id}" zOrder="${zOrder}" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" ratio="0"><hp:offset x="0" y="0"/><hp:orgSz width="12000" height="4000"/><hp:curSz width="12000" height="4000"/><hp:lineShape color="#1F4E79" width="57" style="SOLID"/><hc:fillBrush><hc:winBrush faceColor="${color}" hatchColor="#000000" alpha="0"/></hc:fillBrush><hp:drawText lastWidth="12000" name="" editable="0"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList><hp:textMargin left="283" right="283" top="283" bottom="283"/></hp:drawText><hp:sz width="12000" widthRelTo="ABSOLUTE" height="4000" heightRelTo="ABSOLUTE" protect="0"/>${floatingPos('PAPER', 'PAPER', 'TOP', 'LEFT', y, x)}<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:rect>`
const pageFlowRotatedPicture = `<hp:pic id="9702" zOrder="30" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="8000" height="2000"/><hp:curSz width="8000" height="2000"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="90" centerX="4000" centerY="1000" rotateimage="1"/><hc:img binaryItemIDRef="image1"/><hp:sz width="8000" widthRelTo="ABSOLUTE" height="2000" heightRelTo="ABSOLUTE" protect="0"/>${floatingPos('PAPER', 'PAPER', 'TOP', 'LEFT', 15000, 30000)}<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>`
const pageFlowSecPr = `<hp:secPr><hp:pagePr width="${FLOATING_OBJECT_PAGE.width}" height="${FLOATING_OBJECT_PAGE.height}"><hp:margin left="${FLOATING_OBJECT_PAGE.left}" right="${FLOATING_OBJECT_PAGE.right}" top="${FLOATING_OBJECT_PAGE.top}" bottom="${FLOATING_OBJECT_PAGE.bottom}" header="${FLOATING_OBJECT_PAGE.header}" footer="${FLOATING_OBJECT_PAGE.footer}"/></hp:pagePr></hp:secPr>`
const pageFlowSections = [
  `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${pageFlowSecPr}<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl><hp:ctrl><hp:header id="1" applyPageType="BOTH"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${PAGE_FLOW_TEXTS.header}</hp:t></hp:run></hp:p></hp:subList></hp:header></hp:ctrl><hp:ctrl><hp:footer id="2" applyPageType="BOTH"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${PAGE_FLOW_TEXTS.footer}</hp:t></hp:run></hp:p></hp:subList></hp:footer></hp:ctrl></hp:run><hp:run charPrIDRef="0"><hp:t>${PAGE_FLOW_TEXTS.title}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>
  ${pageFlowParagraph(`${pageFlowRotatedPicture}${pageFlowTextBox(9703, 20, 6000, 30000, PAGE_FLOW_TEXTS.front, '#EAF1FB')}${pageFlowTextBox(9704, 10, 9000, 32000, PAGE_FLOW_TEXTS.back, '#FBEAEA')}<hp:t>${PAGE_FLOW_TEXTS.body(0)}</hp:t>`)}
  ${Array.from({ length: 13 }, (_, index) => pageFlowParagraph(`<hp:t>${PAGE_FLOW_TEXTS.body(index + 1)}</hp:t>`)).join('\n  ')}
  ${pageFlowParagraph(`<hp:t>${Array.from({ length: PAGE_FLOW_LONG_SENTENCES }, (_, index) => PAGE_FLOW_TEXTS.long(index)).join(' ')}</hp:t>`)}
  ${pageFlowParagraph(`<hp:t>${PAGE_FLOW_TEXTS.body(14)}</hp:t>`)}
</hs:sec>`,
  `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  ${pageFlowParagraph(`<hp:ctrl><hp:colPr id="" type="BALANCED_NEWSPAPER" layout="LEFT" colCount="2" sameSz="1" sameGap="1500"/></hp:ctrl><hp:t>${Array.from({ length: PAGE_FLOW_COLUMN_SENTENCES }, (_, index) => PAGE_FLOW_TEXTS.column(index)).join(' ')}</hp:t>`)}
</hs:sec>`
]

export function createPageFlowHwpx(directory: string, fileName = 'han-flow-page-flow.hwpx'): string {
  const path = join(directory, fileName)
  const zip = new AdmZip(undefined, { noSort: true })
  addMimetype(zip)
  zip.addFile('Contents/header.xml', Buffer.from(header))
  pageFlowSections.forEach((section, index) => zip.addFile(`Contents/section${index}.xml`, Buffer.from(section)))
  zip.addFile('BinData/image1.png', solidPng)
  zip.writeZip(path)
  return path
}
