/**
 * 표 구조 command의 tree 전환(4단계) differential이 드러낸 전환 전 문자열 경로의 잠재 버그 최소 재현.
 * 공개 corpus에는 해당 표기가 없다. `createTableColumnHwpx` section(3×3 표, 첫 행이 반복 머리글)을 조금 바꾼 것이다.
 */

/** A1 셀의 표 앞 최상위 위치에 `>`와 가짜 `<hp:t>`가 든 CDATA를 둔다. */
export function cdataWithMarkup(xml: string): string {
  return xml.replace(
    '<hp:p id="1"',
    '<hp:p id="0" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>앞</hp:t></hp:run></hp:p><![CDATA[a><hp:t>x</hp:t>]]><hp:p id="1"'
  )
}

/** 표 앞에 짝 없는 작은따옴표가 든 CDATA를 둔다. */
export function cdataWithQuote(xml: string): string {
  return xml.replace('<hp:p id="1"', "<![CDATA[it's]]><hp:p id=\"1\"")
}

/** B1 셀 주소의 다른 attribute 값 안에 ` rowAddr='2'` 문자열을 둔다. */
export const NOTE_ADDRESS = `<hp:cellAddr note=" rowAddr='2'" colAddr="0" rowAddr="2"/>`
export function attributeInsideValue(xml: string): string {
  return xml.replace('<hp:cellAddr colAddr="0" rowAddr="2"/>', NOTE_ADDRESS)
}

/** B1 셀 주소의 `rowAddr`를 문자 참조로 쓴다. */
export function entityAttribute(xml: string): string {
  return xml.replace('<hp:cellAddr colAddr="0" rowAddr="2"/>', '<hp:cellAddr colAddr="0" rowAddr="&#50;"/>')
}

/** A1·A2를 문단 두 개짜리 수평 1×2 병합 셀로 바꾸고 둘째 문단에만 `hp:linesegarray`를 둔다. */
export function mergedCellWithTrailingLineSegments(xml: string): string {
  return xml.replace(
    /<hp:tc borderFillIDRef="1" header="0"><hp:cellAddr colAddr="0" rowAddr="1"\/>[\s\S]*?<\/hp:tc><hp:tc[\s\S]*?<\/hp:tc>/,
    '<hp:tc borderFillIDRef="1" header="0"><hp:cellAddr colAddr="0" rowAddr="1"/><hp:cellSpan colSpan="2" rowSpan="1"/>' +
      '<hp:cellSz width="4000" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/>' +
      '<hp:subList vertAlign="CENTER"><hp:p id="110" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>A1</hp:t></hp:run></hp:p>' +
      '<hp:p id="111" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>A2</hp:t></hp:run>' +
      '<hp:linesegarray><hp:lineseg vertpos="0" vertsize="2000"/></hp:linesegarray></hp:p></hp:subList></hp:tc>'
  )
}

/** 분할로 생기는 오른쪽 빈 셀의 기대 원문(병합 셀 첫 문단만 남기고 비움, 새 문단 ID 123). */
export const SPLIT_RIGHT_CELL =
  '<hp:tc borderFillIDRef="1" header="0"><hp:cellAddr colAddr="1" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="1"/>' +
  '<hp:cellSz width="2000" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/>' +
  '<hp:subList vertAlign="CENTER"><hp:p id="123" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t></hp:t></hp:run></hp:p></hp:subList></hp:tc>'
