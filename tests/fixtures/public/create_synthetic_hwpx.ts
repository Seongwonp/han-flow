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
  firstSectionPageHeight?: number
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
  const firstSection = section0
    .replace(
      '<hp:pagePr width="10000" height="10000">',
      `<hp:pagePr width="10000" height="${options.firstSectionPageHeight ?? 10000}">`
    )
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
