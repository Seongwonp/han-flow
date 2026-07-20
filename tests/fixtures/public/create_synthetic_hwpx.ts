import AdmZip from 'adm-zip'
import { join } from 'path'

const header = `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hh:fontfaces><hh:fontface lang="HANGUL"><hh:font id="0" face="HanFlow Test Sans"/></hh:fontface></hh:fontfaces>
  <hh:charProperties><hh:charPr id="0" height="1000" textColor="#123456"><hh:fontRef hangul="0"/><hh:bold/></hh:charPr></hh:charProperties>
  <hh:paraProperties><hh:paraPr id="0"><hh:align horizontal="LEFT"/><hh:lineSpacing value="160"/><hh:margin><hc:left value="0"/><hc:right value="0"/><hc:prev value="0"/><hc:next value="0"/></hh:margin></hh:paraPr></hh:paraProperties>
  <hh:borderFills><hh:borderFill id="1"><hh:leftBorder type="SOLID" width="0.12" color="#000000"/><hh:rightBorder type="SOLID" width="0.12" color="#000000"/><hh:topBorder type="SOLID" width="0.12" color="#000000"/><hh:bottomBorder type="SOLID" width="0.12" color="#000000"/><hc:fillBrush><hc:winBrush faceColor="#EEEEEE"/></hc:fillBrush></hh:borderFill></hh:borderFills>
</hh:head>`

const cell = (row: number, height: number, label: string, headerCell = false) => `<hp:tr><hp:tc borderFillIDRef="1" header="${headerCell ? 1 : 0}"><hp:cellAddr colAddr="0" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="6000" height="${height}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList vertAlign="CENTER"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${label}</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="${height}"/></hp:linesegarray></hp:p></hp:subList></hp:tc></hp:tr>`

const section0 = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="10000" height="10000"><hp:margin left="1000" right="1000" top="1000" bottom="1000"/></hp:pagePr></hp:secPr><hp:tbl id="public-table" rowCnt="4" colCnt="1" pageBreak="CELL" repeatHeader="1"><hp:sz width="6000" height="7500"/>${cell(0, 1000, '공개 헤더', true)}${cell(1, 3000, '긴 설명')}${cell(2, 500, '다음 제목')}${cell(3, 3000, '다음 본문')}</hp:tbl></hp:run></hp:p>
</hs:sec>`

const section1 = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:pic><hp:curSz width="1000" height="1000"/><hc:img binaryItemIDRef="image1"/></hp:pic><hp:t>이미지 뒤 텍스트</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>
</hs:sec>`

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X4nHCwAAAABJRU5ErkJggg==', 'base64')

export function createSyntheticHwpx(directory: string): string {
  const path = join(directory, 'han-flow-public.hwpx')
  const zip = new AdmZip()
  zip.addFile('mimetype', Buffer.from('application/hwp+zip'))
  zip.addFile('Contents/header.xml', Buffer.from(header))
  zip.addFile('Contents/section1.xml', Buffer.from(section1))
  zip.addFile('Contents/section0.xml', Buffer.from(section0))
  zip.addFile('BinData/image1.png', transparentPng)
  zip.writeZip(path)
  return path
}
