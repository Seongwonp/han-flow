import type { ParagraphStructureBlock } from '../editing/paragraph_structure'
import type { MathElement } from './equation_script'
export type HwpUnit = number

/**
 * 구역 쪽 설정(OWPML `hp:secPr/hp:pagePr`). `width`·`height`는 화면에 놓는 용지 크기로, 가로 방향(`landscape="NARROWLY"`)이면
 * 원본 용지 크기를 돌린 값이다. `margin`은 쪽 본문 여백(위쪽 + 머리말 여백, 아래쪽 + 꼬리말 여백, 제본 여백을 더한 홀수 쪽 값)이고
 * `headerOffset`·`footerOffset`은 머리말·꼬리말 띠 높이다.
 * - `landscape`: 원본이 가로 방향이다.
 * - `mirrorMargins`: 맞쪽 제본(`gutterType="LEFT_RIGHT"`). 짝수 쪽은 왼쪽·오른쪽 여백을 바꾼다(`viewerPageFrameAt`).
 */
export interface ViewerPageSetup {
  width: HwpUnit
  height: HwpUnit
  margin: BoxSpacing
  headerOffset: HwpUnit
  footerOffset: HwpUnit
  landscape?: boolean
  mirrorMargins?: boolean
}

export interface ViewerDocument {
  /** 문서 첫 `hp:pagePr`의 쪽 설정. 구역마다의 쪽 설정은 `ViewerSection.page`이고, 없는 구역(옛 모델·test)은 이 값을 쓴다. */
  page: ViewerPageSetup
  fonts: Record<string, string>
  charStyles: Record<string, ViewerCharStyle>
  paraStyles: Record<string, ViewerParaStyle>
  cellStyles: Record<string, ViewerCellStyle>
  resources: Record<string, ViewerResource>
  sections: ViewerSection[]
  diagnostics: ViewerDiagnostic[]
}

export interface ViewerPageNumber {
  position: string
  formatType: string
  sideChar: string
  start?: number
  hiddenOnFirstPage: boolean
}

export interface ViewerHeaderFooter {
  id: string
  applyPageType: string
  paragraphs: ViewerParagraph[]
}

export interface ViewerParseTimings {
  packageOpenMs: number
  packageIndexMs: number
  decodeMs: number
  mainTotalMs: number
}

export interface BoxSpacing { top: HwpUnit; right: HwpUnit; bottom: HwpUnit; left: HwpUnit }
export interface ViewerDiagnostic { source: string; message: string; code?: string }
export interface ViewerCharStyle { id: string; height: HwpUnit; color: string; bold: boolean; italic: boolean; underline: boolean; strikeout: boolean; fontId?: string; fontFamily?: string }
/**
 * 문단 모양. `lineSpacing`은 줄 간격 값이고 종류(`lineSpacingType`, `hh:lineSpacing type`)에 따라 뜻이 다르다. 없거나 `PERCENT`면
 * 글자 높이에 대한 백분율, `FIXED`(고정 값)는 줄 높이, `BETWEEN_LINES`(여백만 지정)는 글자 높이에 더할 줄 사이 여백,
 * `AT_LEAST`(최소)는 줄 높이의 최솟값이다(뒤 셋은 HWPUNIT).
 */
export interface ViewerParaStyle { id: string; align?: string; lineSpacing?: number; lineSpacingType?: ViewerLineSpacingType; indent?: HwpUnit; margin: BoxSpacing; tabPrId?: string; heading?: ViewerHeadingStyle; breakSetting?: ViewerBreakSetting }
export type ViewerLineSpacingType = 'PERCENT' | 'FIXED' | 'BETWEEN_LINES' | 'AT_LEAST'
/**
 * 문단 나눔 설정(OWPML `hh:breakSetting`). 켜진 것만 true로 둔다.
 * - `widowOrphan`: 외톨이줄 보호. 쪽을 넘어 나눌 때 앞·뒤 조각에 줄을 둘 이상 둔다.
 * - `keepWithNext`: 다음 문단과 함께. 다음 문단 첫 줄이 같은 쪽에 들어가지 않으면 이 문단을 다음 쪽으로 넘긴다.
 * - `keepLines`: 문단 보호. 문단을 쪽 사이에서 나누지 않는다.
 * - `pageBreakBefore`: 문단 앞에서 항상 쪽을 나눈다.
 */
export interface ViewerBreakSetting { widowOrphan?: boolean; keepWithNext?: boolean; keepLines?: boolean; pageBreakBefore?: boolean }
export interface ViewerHeadingStyle { type: string; idRef: string; level: number; bullet?: string; numberPattern?: string; numberFormat?: string }
export interface ViewerBorder { type: string; widthMm: number; color: string }
export interface ViewerCellStyle { id: string; backgroundColor?: string; left: ViewerBorder; right: ViewerBorder; top: ViewerBorder; bottom: ViewerBorder }
export interface ViewerResource { id: string; path: string; mime: string; data: string }
/** 서로 다른 너비 단(`hp:colSz`)의 너비와 그 단 뒤 간격. 원본 값 그대로이고(한/글은 비율 값을 쓴다) 쪽 본문 폭에 맞춰 늘리거나 줄인다. */
export interface ViewerColumnDefinition { width: HwpUnit; gap: HwpUnit }
/** 단 사이 구분선(`hp:colLine`). */
export interface ViewerColumnLine { type: string; widthMm: number; color: string }
/**
 * 다단 정의(OWPML `hp:colPr`).
 * - `type`: `NEWSPAPER`(일반 다단)·`BALANCED_NEWSPAPER`(배분 다단)·`PARALLEL`(평행 다단).
 * - `layout`: `LEFT`(왼쪽 단부터)·`RIGHT`(오른쪽 단부터)·`MIRROR`(홀수 쪽은 왼쪽부터, 짝수 쪽은 오른쪽부터).
 * - `sameSize`면 단 너비가 같고 단 사이가 `sameGap`(HWPUNIT)이다. 아니면 `columns`의 단별 너비·간격을 쓴다.
 * - `line`: 단 사이 구분선. 없거나 종류가 `NONE`이면 그리지 않는다.
 */
export interface ViewerColumnLayout { type: string; layout: string; count: number; sameSize: boolean; sameGap: HwpUnit; columns: ViewerColumnDefinition[]; line?: ViewerColumnLine }
export interface ViewerSection {
  id: string
  /** 이 구역의 쪽 크기·여백(`hp:pagePr`, 없으면 앞 구역 것). 없으면 문서 `page`를 쓴다(`viewerSectionPage`). */
  page?: ViewerPageSetup
  blocks: ViewerParagraph[]
  pageNumber?: ViewerPageNumber
  columnLayout?: ViewerColumnLayout
  headers: ViewerHeaderFooter[]
  footers: ViewerHeaderFooter[]
  /** 구역 정의의 각주 모양(`hp:footNotePr`). 없으면 {@link DEFAULT_FOOTNOTE_SETTINGS}를 쓴다. */
  footnoteSettings?: ViewerFootnoteSettings
}

/**
 * 각주 모양(OWPML `hp:footNotePr`). 길이·간격은 HWPUNIT.
 * - `line.length`: 구분선 길이. 음수(-1)는 한/글 기본값(단 너비의 1/3로 그린다), 0은 선 없음.
 * - `spacing.aboveLine`: 본문과 구분선 사이, `belowLine`: 구분선과 첫 각주 사이, `betweenNotes`: 각주 사이.
 * - `numbering`: `CONTINUOUS`(문서 전체 이어서)·`ON_SECTION`(구역마다 새로)·`ON_PAGE`(쪽마다 새로), `newNum`은 시작 번호.
 * - `placement`: `EACH_COLUMN`·`MERGED_COLUMN`·`RIGHT_MOST_COLUMN`, `beneathText`면 쪽 아래가 아니라 본문 바로 아래에 둔다.
 */
export interface ViewerFootnoteSettings {
  format: { type: string; userChar: string; prefixChar: string; suffixChar: string; superscript: boolean }
  line: { type: string; length: HwpUnit; widthMm: number; color: string }
  spacing: { betweenNotes: HwpUnit; belowLine: HwpUnit; aboveLine: HwpUnit }
  numbering: { type: 'CONTINUOUS' | 'ON_SECTION' | 'ON_PAGE'; newNum: number }
  placement: { place: string; beneathText: boolean }
}

/** 한/글이 새 문서에 쓰는 각주 모양(공개 fixture의 `hp:footNotePr`과 같다). */
export const DEFAULT_FOOTNOTE_SETTINGS: ViewerFootnoteSettings = {
  format: { type: 'DIGIT', userChar: '', prefixChar: '', suffixChar: ')', superscript: false },
  line: { type: 'SOLID', length: -1, widthMm: 0.12, color: '#000000' },
  spacing: { betweenNotes: 283, belowLine: 567, aboveLine: 850 },
  numbering: { type: 'CONTINUOUS', newNum: 1 },
  placement: { place: 'EACH_COLUMN', beneathText: false }
}
export interface ViewerParagraph {
  id: string
  paraStyleId: string
  pageBreak: boolean
  columnBreak?: boolean
  /**
   * 구역 중간의 새 다단 정의(이 문단 안 `hp:colPr`). 이 문단부터 새 다단 영역이 같은 쪽에서 앞 영역 아래로 시작한다.
   * 구역의 첫 다단 정의는 `ViewerSection.columnLayout`에 둔다.
   */
  columnLayout?: ViewerColumnLayout
  /** 원본 줄 배치(`hp:lineseg`) 첫 줄의 세로 위치. 앞 문단보다 위로 되돌아가면 한/글은 새 쪽(단)에서 시작했다. */
  layoutTop?: HwpUnit
  /** 원본 줄 배치 마지막 줄의 세로 위치(첫 줄과 다를 때만). 한/글이 문단을 쪽 사이에서 나눴으면 첫 줄보다 작다. */
  layoutLastTop?: HwpUnit
  layoutHeight: HwpUnit
  /**
   * 쪽(단) 사이에서 줄 단위로 나눈 문단 조각(pagination이 만든다). `source`는 원본 문단, `head`는 앞 줄들(편집 중에는 원본 문단 전체를
   * `clipHeight`로 잘라 그 자리에서 입력), `rest`는 이어지는 줄들(편집 anchor 없는 읽기 전용 글자)이다. `continues`면 뒤 조각이 더 있다.
   */
  lineSplit?: ViewerLineSplit
  /** 본문 최상위 문단의 문단 나눔 설정(문단 모양 `hh:breakSetting`, 켜진 것이 있을 때만). pagination이 쓴다. */
  breakSetting?: ViewerBreakSetting
  marker?: string
  content: ViewerContent[]
  /**
   * 원본 문단이 문단 구조 command(Enter 분할·경계 병합·여러 문단 범위)의 대상이 될 수 없는 이유. 없으면 구조 규칙을 통과한다.
   * 편집 코어와 같은 규칙(`editing/paragraph_structure.ts`)으로 decoder가 채운다. 글자 입력 가능 여부와는 관계없다.
   */
  structureBlock?: ParagraphStructureBlock
}
export interface ViewerLineSplit {
  part: 'head' | 'rest'
  source: ViewerParagraph
  continues: boolean
  /** 원본 문단 줄 경계 index 범위(-1은 문단 처음, 경계 수는 문단 끝). */
  from: number
  to: number
  clipHeight?: HwpUnit
}
export type ViewerContent = ViewerText | ViewerTable | ViewerImage | ViewerObjectPlaceholder | ViewerNoteList
export interface ViewerSourceAnchor { sectionPath: string; textNodeId: string }
export interface ViewerText {
  type: 'text'
  text: string
  charStyleId: string
  sourceAnchor?: ViewerSourceAnchor
}
/**
 * 개체 회전과 대칭(OWPML `hp:rotationInfo angle`·`centerX`·`centerY`, `hp:flip horizontal`·`vertical`). `rotation`은 도 단위 시계
 * 방향(-180 초과 180 이하로 맞춤), `originX`·`originY`는 회전 중심을 개체 상자 폭·높이 비율(0~1)로 나타낸다(원본 중심이 상자 밖이거나
 * 없으면 0.5). 그리기만 바꾸고 자리(배치 상자·띠·줄 높이)는 회전 전 상자 그대로다.
 */
export interface ViewerObjectTransform {
  rotation: number
  flipHorizontal: boolean
  flipVertical: boolean
  originX: number
  originY: number
}

export interface ViewerImage {
  type: 'image'
  resourceId?: string
  width?: HwpUnit
  height?: HwpUnit
  /** 높이가 쪽 본문 한도를 넘어 너비·높이를 같은 비율로 줄였을 때 원래 크기와 비율(자리 표시의 `fitted`와 같은 규칙). */
  fitted?: { declared: { width: HwpUnit; height: HwpUnit }; scale: number }
  /** 글자처럼 취급하지 않는 그림(`hp:pos treatAsChar="0"`)의 원본 위치. 없으면 줄 안에 놓는다. */
  position?: ViewerObjectPosition
  /** 회전·대칭. 없으면 그대로 그린다. */
  transform?: ViewerObjectTransform
  /**
   * 그림 회전 안 함(`hp:rotationInfo rotateimage="0"`). 개체 틀(테두리)만 돌리고 그림은 돌리지 않는다(대칭은 그대로).
   */
  rotateImage?: false
  /**
   * 그림 자르기(`hp:imgClip`, 원본 그림 크기 `hp:imgDim` 기준)와 그림을 그리는 자리(`hp:imgRect`, `hp:orgSz` 기준). 모두 0~1 비율이다.
   * `frame`은 개체 상자 안 그림 자리, `source`는 원본 그림 가운데 보이는 부분이다. 자르지 않고 상자를 다 채우면 없다.
   */
  crop?: { frame: ViewerUnitRect; source: ViewerUnitRect }
  /** 그림 효과(`hc:img`): 밝기·대비(-100~100), 회색조·흑백(`effect`), 불투명도(0~1). 원본 그대로면 없다. */
  filter?: { brightness?: number; contrast?: number; effect?: 'GRAY_SCALE' | 'BLACK_WHITE'; opacity?: number }
  /** 그림 테두리(`hp:lineShape`). 없거나 `NONE`이면 없다. */
  border?: ViewerShapeStroke
}

/** 0~1 비율로 나타낸 직사각형. */
export interface ViewerUnitRect { left: number; top: number; width: number; height: number }

/** 개체와 본문 글의 배치 관계(OWPML `textWrap`). */
export type ViewerTextWrap = 'SQUARE' | 'TIGHT' | 'THROUGH' | 'TOP_AND_BOTTOM' | 'BEHIND_TEXT' | 'IN_FRONT_OF_TEXT'

/**
 * 글자처럼 취급하지 않는 개체(`hp:pos treatAsChar="0"`)의 원본 위치(OWPML `hp:pos`·`hp:sz`·`hp:outMargin`, 길이는 HWPUNIT).
 * - `vertRelTo`: `PAPER`(용지)·`PAGE`(쪽 본문)·`PARA`(개체를 둔 문단), `horzRelTo`: `PAPER`·`PAGE`·`COLUMN`(단)·`PARA`.
 * - `vertAlign`·`horzAlign`: 기준 영역 안에서 맞출 쪽. `vertOffset`·`horzOffset`은 맞춘 쪽 가장자리에서 안쪽으로 잰 거리다
 *   (아래·오른쪽 맞춤이면 위·왼쪽으로, 가운데면 아래·오른쪽으로). 원본의 32비트 부호 없는 음수 표현은 부호 있는 값으로 바꾼다.
 * - `flowWithText`: 세로 위치를 쪽 본문 안으로 제한한다.
 * - `width`·`height`: 화면에 그리는 개체 크기(선언 크기, 쪽보다 크면 줄인 크기).
 * - `outMargin`: 글이 개체에 붙지 않게 비우는 바깥 여백.
 * 본문 최상위 문단의 개체만 이 위치로 그리고, 표 셀·글상자·머리말·꼬리말·각주 안 개체는 줄 흐름 안에 둔다.
 */
export interface ViewerObjectPosition {
  wrap: ViewerTextWrap
  textFlow: string
  vertRelTo: 'PAPER' | 'PAGE' | 'PARA'
  horzRelTo: 'PAPER' | 'PAGE' | 'COLUMN' | 'PARA'
  vertAlign: 'TOP' | 'CENTER' | 'BOTTOM' | 'INSIDE' | 'OUTSIDE'
  horzAlign: 'LEFT' | 'CENTER' | 'RIGHT' | 'INSIDE' | 'OUTSIDE'
  vertOffset: HwpUnit
  horzOffset: HwpUnit
  flowWithText: boolean
  allowOverlap: boolean
  zOrder: number
  width: HwpUnit
  height: HwpUnit
  outMargin: BoxSpacing
}

/** viewer가 원본처럼 그리지 못하는 run 안 개체의 종류. */
export type ViewerObjectKind =
  | 'equation'
  | 'chart'
  | 'ole'
  | 'text-box'
  | 'shape'
  | 'form-control'
  | 'video'
  | 'footnote'
  | 'endnote'
  | 'memo'
  | 'field'
  | 'ruby'
  | 'unknown'

/**
 * 개체가 본문 흐름에서 차지하는 자리.
 * - `inline`: 글자처럼 취급(`hp:pos treatAsChar="1"`). 선언 크기만큼 줄 안에 자리를 잡는다.
 * - `block`: 자리 차지(`TOP_AND_BOTTOM`·`SQUARE` 등). 선언 크기만큼 한 줄을 차지한다.
 * - `floating`: 글 앞·뒤(`IN_FRONT_OF_TEXT`·`BEHIND_TEXT`)라 원본에서 본문 자리를 차지하지 않는다. 작은 표시만 둔다.
 * - `marker`: 각주·미주 번호처럼 글자 크기로 줄 안에 놓인다.
 */
export type ViewerObjectFlow = 'inline' | 'block' | 'floating' | 'marker'

/**
 * 원본 개체 자리 표시. 원본 bytes는 package에 그대로 남고 화면·PDF에는 이 상자로 나온다. 편집하지 않는다(읽기 전용).
 */
export interface ViewerObjectPlaceholder {
  type: 'object-placeholder'
  kind: ViewerObjectKind
  /** 원본 element 이름(예: `hp:equation`). */
  element: string
  /** `${sectionPath}#${element}:${section 안 같은 element의 문서 순서 번호}`. section을 모르면 `#${element}:N`. */
  sourcePath: string
  flow: ViewerObjectFlow
  /** `hp:curSz`(0이 아니면) 또는 `hp:sz`의 선언 크기(HWPUNIT). */
  size?: { width: HwpUnit; height: HwpUnit }
  /** 화면에 보이는 한국어 이름(예: "수식"). */
  label: string
  /** 도형·글상자·자리 표시 상자의 회전·대칭. 없으면 그대로 그린다. */
  transform?: ViewerObjectTransform
  /** 원본에서 읽은 대체 text(수식 script, 단추 caption, 덧말 본말 등). */
  fallbackText?: string
  /** 덧말(`hp:dutmal`)의 덧말 text와 위치. */
  ruby?: { text: string; position: 'top' | 'bottom' }
  /**
   * 글상자·도형 글(`hp:drawText/hp:subList`)이나 메모 본문에서 되살린 문단. 글자만 든 subList는 편집 anchor가 있고
   * (capability의 `TEXT_BOX_TEXT`·`MEMO_TEXT`), 개체가 든 subList는 anchor 없는 읽기 전용이다.
   */
  paragraphs?: ViewerParagraph[]
  /** 각주·미주 번호 표시(예: "1)"). */
  marker?: string
  /**
   * 각주(`kind: 'footnote'`)의 본문. 각주는 이 번호 표시가 놓인 쪽(단) 아래에 그린다(`pagination.ts`). 미주는 구역 끝
   * 목록(`ViewerNoteList`)에 모으므로 없다.
   */
  note?: ViewerNote
  /**
   * 선언 높이가 쪽 본문 높이를 넘어 `size`를 비율대로 줄였으면 원래 선언 크기와 배율. renderer는 줄였다는 표시를 하고
   * 되살린 글이 줄인 높이를 넘으면 글도 같은 한도에 맞춰 줄인다.
   */
  fitted?: { declared: { width: HwpUnit; height: HwpUnit }; scale: number }
  /** 글자처럼 취급하지 않는 개체의 원본 위치(`ViewerObjectPosition`). 본문 최상위 문단에서만 쓴다. */
  position?: ViewerObjectPosition
  /** 도형(사각형·타원·선·다각형)과 글상자 테두리를 그릴 선·채우기와 꼭짓점(개체 왼쪽 위 기준 HWPUNIT). */
  shape?: ViewerShapeStyle
  /**
   * 수식 script를 해석해 그릴 수 있으면 MathML 나무와 `hp:equation` 속성. 있으면 renderer는 자리 표시 대신 수식을 선언 상자에 맞춰
   * 그리고, 안내 배너의 "완전히 표시되지 않는 개체"에서 뺀다. 해석하지 못한 수식은 없고 script 글자 상자로 보여 준다.
   */
  equation?: ViewerEquation
}

export interface ViewerEquation {
  math: MathElement
  /** 기본 글자 크기(`baseUnit`, HWPUNIT: 1000 = 10pt). */
  baseUnit?: number
  /** 글자 색(`textColor`, `#RRGGBB`). */
  color?: string
  /** 상자 위에서 기준선까지 높이의 백분율(`baseLine`). */
  baseLine?: number
}

/**
 * 도형 선(`hp:lineShape`). 색·굵기(HWPUNIT)·모양(`SOLID`·`DASH`·`DOT`·`DASH_DOT`·`DASH_DOT_DOT`·`LONG_DASH`·`CIRCLE`·이중선 계열),
 * 끝 모양(`endCap`: `ROUND`·`FLAT`), 시작·끝 화살표(`headStyle`·`tailStyle`: `NORMAL`이면 없음, `ARROW`·`SPEAR`·`CONCAVE_ARROW`·
 * `EMPTY_DIAMOND`·`EMPTY_CIRCLE`·`EMPTY_BOX`·`FILLED_DIAMOND`·`FILLED_CIRCLE`·`FILLED_BOX`)와 크기(`SMALL_SMALL` ~ `LARGE_LARGE`,
 * 앞이 폭·뒤가 길이), 불투명도(0~1, `alpha`는 투명도 0~255).
 */
export interface ViewerShapeStroke {
  color: string
  width: HwpUnit
  style: string
  endCap?: 'ROUND' | 'FLAT'
  headStyle?: string
  tailStyle?: string
  headSize?: string
  tailSize?: string
  /** 화살표 속을 채우는지(`headfill`·`tailfill`). 없으면 채운다. */
  headFill?: boolean
  tailFill?: boolean
  opacity?: number
}

/**
 * 도형 면 채우기(`hc:fillBrush`).
 * - `solid`: 단색(`hc:winBrush faceColor`), `hatch`: 무늬(`hatchStyle` `HORIZONTAL`·`VERTICAL`·`BACK_SLASH`·`SLASH`·`CROSS`·
 *   `CROSS_DIAGONAL`, 바탕은 `faceColor`).
 * - `gradient`: 그러데이션(`hc:gradation`). `LINEAR`는 `angle`(도, 0이면 왼쪽→오른쪽, 시계 방향), `RADIAL`·`CONICAL`·`SQUARE`는 중심
 *   (`centerX`·`centerY`, 0~100%)에서 바깥으로 퍼지는 원형으로 그린다. 색은 같은 간격으로 놓는다.
 * `opacity`는 0~1(원본 `alpha`는 투명도 0~255).
 */
export type ViewerShapeFill =
  | { kind: 'solid'; color: string; opacity?: number }
  | { kind: 'hatch'; color: string; hatchColor: string; hatchStyle: string; opacity?: number }
  | { kind: 'gradient'; type: 'LINEAR' | 'RADIAL' | 'CONICAL' | 'SQUARE'; angle: number; centerX: number; centerY: number; colors: string[]; opacity?: number }

/**
 * 묶음 도형(`hp:container`) 안 도형 하나. 좌표는 묶음 개체 상자(왼쪽 위 0, HWPUNIT) 기준으로 이미 옮긴 값이다(안쪽 묶음의 위치·크기·
 * 회전·대칭을 모두 반영). `path`는 SVG path 자료이고 `closed`면 면을 채운다. 글은 묶음 개체 전체의 글상자로 따로 그린다.
 */
export interface ViewerShapePart {
  element: string
  path: string
  closed: boolean
  stroke?: ViewerShapeStroke
  fill?: ViewerShapeFill
  /** 열린 선(`hp:line`·`hp:connectLine`·`hp:curve`·호)의 시작·끝 방향(화살표). [끝점, 그 앞 점]. */
  start?: [{ x: number; y: number }, { x: number; y: number }]
  end?: [{ x: number; y: number }, { x: number; y: number }]
}

export interface ViewerShapeStyle {
  /** 선 색(`#RRGGBB`), 굵기(HWPUNIT), 모양(`SOLID`·`DASH`…)과 끝 모양·화살표. 선이 없으면(`NONE`) undefined. */
  stroke?: ViewerShapeStroke
  /** 면 색(`#RRGGBB`). 단색 채우기가 없거나 완전히 투명하면 undefined(글상자 배경에 쓴다). */
  fill?: string
  /** 면 채우기(단색·무늬·그러데이션). 도형 SVG가 쓴다. */
  fillPaint?: ViewerShapeFill
  /** 선(`hp:line`)의 두 끝점이나 다각형(`hp:polygon`)의 꼭짓점. */
  points?: Array<{ x: HwpUnit; y: HwpUnit }>
  /**
   * 호(`hp:arc`)·곡선(`hp:curve`)·연결선(`hp:connectLine`)의 SVG path 자료(개체 상자 기준 HWPUNIT). `closed`면 면을 채운다(부채꼴·활꼴,
   * 닫힌 곡선). `start`·`end`는 화살표 방향(끝점과 그 앞 점)이다.
   */
  path?: string
  closed?: boolean
  start?: [{ x: number; y: number }, { x: number; y: number }]
  end?: [{ x: number; y: number }, { x: number; y: number }]
  /** 묶음 도형(`hp:container`)을 이루는 도형들(문서 순서, 뒤가 위). */
  parts?: ViewerShapePart[]
  /** 글상자 안쪽 여백(`hp:drawText/hp:textMargin`)과 글의 세로 맞춤(`hp:subList vertAlign`). */
  textMargin?: BoxSpacing
  textVerticalAlign?: string
}

/** 구역 끝에 모아 보여 주는 미주 본문 목록. 각주는 번호 표시가 놓인 쪽 아래에 그린다. */
export interface ViewerNoteList {
  type: 'note-list'
  notes: ViewerNote[]
  /**
   * 목록을 쪽 사이에서 나눌 수 있게 decoder는 각주·미주 문단마다 block 하나를 만든다. 앞 block에 이어지는 block이면
   * 그 앞 block의 종류(같은 종류면 제목을 다시 쓰지 않는다)이고, 목록 첫 block이면 없다.
   */
  continuesKind?: ViewerNote['kind']
  /** 앞 block과 같은 각주·미주의 다음 문단이면 true(번호를 다시 쓰지 않는다). */
  continuesNote?: boolean
}
export interface ViewerNote {
  kind: 'footnote' | 'endnote'
  marker: string
  sourcePath: string
  paragraphs: ViewerParagraph[]
}
export interface ViewerTable {
  type: 'table'
  id: string
  rowCount: number
  columnCount: number
  width?: HwpUnit
  height?: HwpUnit
  pageBreak?: string
  repeatHeader: boolean
  rows: ViewerTableRow[]
  /** 글자처럼 취급하지 않는 표(`hp:pos treatAsChar="0"`)의 원본 위치. 없으면 문단 흐름 안에 놓는다. */
  position?: ViewerObjectPosition
}
export interface ViewerTableRow { cells: ViewerTableCell[]; fragmentHeight?: HwpUnit }
export interface ViewerTableCell {
  row: number
  column: number
  rowSpan: number
  columnSpan: number
  width: HwpUnit
  height: HwpUnit
  margin: BoxSpacing
  borderFillId?: string
  verticalAlign?: string
  header: boolean
  paragraphs: ViewerParagraph[]
  sourceCellId?: string
  splitTop?: boolean
  splitBottom?: boolean
}

/**
 * 편집 가능 여부를 정할 때 건너뛰는 읽기 전용 개체 자리 표시인지. 자리 표시는 원본 개체를 그리기만 하므로 같은 문단의
 * 글자 run 편집 가능 여부(자리 표시를 넣기 전과 같다)를 바꾸지 않는다. 편집 코어와 renderer가 같은 규칙을 쓴다.
 */
export function isObjectPlaceholder(item: ViewerContent): item is ViewerObjectPlaceholder {
  return item.type === 'object-placeholder'
}

/**
 * 문단에 번호 표시가 있는 각주(문서 순서). 표 셀·글상자 글 안 번호 표시도 센다. 각주 본문 안 각주는 세지 않는다(한/글은
 * 각주 안에 각주를 넣지 못한다).
 */
export function paragraphFootnotes(paragraph: ViewerParagraph): ViewerNote[] {
  const notes: ViewerNote[] = []
  const visit = (content: readonly ViewerContent[]): void => {
    for (const item of content) {
      if (item.type === 'object-placeholder') {
        if (item.note) notes.push(item.note)
        // 글상자 글처럼 개체 안에 되살린 문단의 각주도 그 개체가 놓인 쪽 아래에 둔다.
        else if (item.paragraphs) for (const nested of item.paragraphs) visit(nested.content)
      } else if (item.type === 'table') {
        for (const row of item.rows) for (const cell of row.cells) for (const nested of cell.paragraphs) visit(nested.content)
      }
    }
  }
  visit(paragraph.content)
  return notes
}

/** 구역 `sectionIndex`의 쪽 설정. 구역에 없으면 문서 첫 쪽 설정이다. */
export function viewerSectionPage(document: Pick<ViewerDocument, 'page' | 'sections'>, sectionIndex: number): ViewerPageSetup {
  return document.sections[sectionIndex]?.page ?? document.page
}

const mirroredFrames = new WeakMap<ViewerPageSetup, ViewerPageSetup>()

/**
 * 쪽 번호(1부터 센 문서 쪽 순서) `pageNumber` 쪽의 쪽 설정. 맞쪽 제본(`mirrorMargins`)의 짝수 쪽은 왼쪽·오른쪽 여백을 바꿔 제본
 * 여백이 안쪽(오른쪽)에 오게 한다. 본문 폭·높이는 홀수 쪽과 같아 쪽 나눔은 바뀌지 않는다.
 */
export function viewerPageFrameAt(page: ViewerPageSetup, pageNumber: number): ViewerPageSetup {
  if (!page.mirrorMargins || pageNumber % 2 !== 0) return page
  let mirrored = mirroredFrames.get(page)
  if (!mirrored) {
    mirrored = { ...page, margin: { ...page.margin, left: page.margin.right, right: page.margin.left } }
    mirroredFrames.set(page, mirrored)
  }
  return mirrored
}

/** 쪽 크기·본문 여백이 같은지(값으로 비교). */
export function sameViewerPageFrame(left: ViewerPageSetup, right: ViewerPageSetup): boolean {
  return left === right || (
    left.width === right.width && left.height === right.height &&
    left.margin.top === right.margin.top && left.margin.right === right.margin.right &&
    left.margin.bottom === right.margin.bottom && left.margin.left === right.margin.left &&
    left.headerOffset === right.headerOffset && left.footerOffset === right.footerOffset &&
    Boolean(left.mirrorMargins) === Boolean(right.mirrorMargins) && Boolean(left.landscape) === Boolean(right.landscape)
  )
}

/** 단이 여럿인 다단 정의인지. 모든 유형(`NEWSPAPER`·`BALANCED_NEWSPAPER`·`PARALLEL`)과 배치(`LEFT`·`RIGHT`·`MIRROR`)를 단별로 조판한다. */
export function supportsViewerColumnFlow(layout?: ViewerColumnLayout): layout is ViewerColumnLayout {
  return Boolean(layout && layout.count > 1)
}

/**
 * 단 너비(HWPUNIT, 흐름 순서). 같은 너비면 `(본문 폭 - 전체 간격) / 단 수`, 서로 다른 너비면 `hp:colSz` 너비·간격 합이 본문 폭이
 * 되게 비례로 늘리거나 줄인다(한/글은 합이 32768인 비율 값을 쓴다). 선언이 모자란 단은 남은 폭을 똑같이 나눈다.
 */
export function viewerColumnWidths(bodyWidth: HwpUnit, layout?: ViewerColumnLayout): { widths: HwpUnit[]; gaps: HwpUnit[] } {
  if (!supportsViewerColumnFlow(layout)) return { widths: [bodyWidth], gaps: [0] }
  const count = layout.count
  const declared = layout.columns.slice(0, count).filter((column) => Number.isFinite(column.width) && column.width > 0)
  if (layout.sameSize || !declared.length) {
    const gap = Math.max(layout.sameGap, 0)
    const width = Math.max((bodyWidth - gap * (count - 1)) / count, 0)
    return { widths: Array.from({ length: count }, () => width), gaps: Array.from({ length: count }, (_, index) => index < count - 1 ? gap : 0) }
  }
  const declaredGaps = declared.map((column, index) => index < count - 1 ? Math.max(Number.isFinite(column.gap) ? column.gap : 0, 0) : 0)
  // 선언이 모자라면 선언한 단의 평균 너비와 공통 간격으로 채운 뒤 전체를 본문 폭에 맞춘다.
  const averageWidth = declared.reduce((sum, column) => sum + column.width, 0) / declared.length
  const widths = Array.from({ length: count }, (_, index) => declared[index]?.width ?? averageWidth)
  const gaps = Array.from({ length: count }, (_, index) => index >= count - 1 ? 0 : index < declared.length ? declaredGaps[index] : Math.max(layout.sameGap, 0))
  const total = widths.reduce((sum, width) => sum + width, 0) + gaps.reduce((sum, gap) => sum + gap, 0)
  const scale = total > 0 ? bodyWidth / total : 0
  return { widths: widths.map((width) => width * scale), gaps: gaps.map((gap) => gap * scale) }
}

/** 첫 단(흐름 순서) 너비. 단이 하나면 본문 폭이다. */
export function viewerColumnContentWidth(bodyWidth: HwpUnit, layout?: ViewerColumnLayout): HwpUnit {
  return viewerColumnWidths(bodyWidth, layout).widths[0]
}
