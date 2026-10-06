import AdmZip from 'adm-zip'
import { join } from 'path'

const header = `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hh:fontfaces><hh:fontface lang="HANGUL"><hh:font id="0" face="HanFlow Test Sans"/></hh:fontface></hh:fontfaces>
  <hh:charProperties><hh:charPr id="0" height="1000" textColor="#123456"><hh:fontRef hangul="0"/><hh:bold/></hh:charPr></hh:charProperties>
  <hh:numberings><hh:numbering id="1"><hh:paraHead level="1" numFormat="DIGIT">^1.</hh:paraHead></hh:numbering></hh:numberings>
  <hh:bullets><hh:bullet id="1" char="-"/></hh:bullets>
  <hh:paraProperties><hh:paraPr id="0"><hh:align horizontal="LEFT"/><hh:heading type="NONE" idRef="0" level="0"/><hh:lineSpacing value="160"/><hh:margin><hc:left value="0"/><hc:right value="0"/><hc:prev value="0"/><hc:next value="0"/></hh:margin></hh:paraPr><hh:paraPr id="1"><hh:heading type="BULLET" idRef="1" level="0"/><hh:margin><hc:left value="0"/><hc:right value="0"/><hc:prev value="0"/><hc:next value="0"/></hh:margin></hh:paraPr><hh:paraPr id="2"><hh:heading type="NUMBER" idRef="1" level="0"/><hh:margin><hc:left value="0"/><hc:right value="0"/><hc:prev value="0"/><hc:next value="0"/></hh:margin></hh:paraPr><hh:paraPr id="3"><hp:switch><hp:case><hh:margin><hc:left value="120"/><hc:right value="240"/><hc:prev value="360"/><hc:next value="480"/></hh:margin><hh:lineSpacing type="PERCENT" value="130"/></hp:case><hp:default><hh:margin><hc:left value="1200"/><hc:right value="2400"/><hc:prev value="3600"/><hc:next value="4800"/></hh:margin><hh:lineSpacing type="PERCENT" value="200"/></hp:default></hp:switch></hh:paraPr></hh:paraProperties>
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

export function createMultiColumnFallbackHwpx(directory: string, fileName = 'han-flow-multi-column-fallback.hwpx'): string {
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
  <hp:p paraPrIDRef="4"><hp:run charPrIDRef="1"><hp:secPr><hp:pagePr width="59528" height="84188"><hp:margin left="5669" right="5669" top="2834" bottom="1417" header="1417" footer="1417"/></hp:pagePr></hp:secPr><hp:t>합성 행사 개최 계획</hp:t></hp:run></hp:p>
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
