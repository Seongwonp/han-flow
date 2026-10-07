// rhwp 페이지 SVG는 <img>로 그리므로 앱 문서와 분리된 SVG 이미지 문서가 된다. Chromium PDF는
// SVG 이미지 안의 글자를 원문 cluster(ActualText) 없이 기록하므로 PDF ToUnicode가 글꼴 cmap에만
// 의존한다. Noto Sans/Serif CJK(Source Han) 계열은 `locl` GSUB로 언어별 대체 glyph를 쓰는데,
// 대체 glyph는 cmap에 없어 ToUnicode가 U+0000이 된다. 화면과 PDF에는 보이지만 PDF 검색·복사·
// 추출에서 빠진다.
// - 언어 선언이 없거나 en이면(UI locale 기본값) latn 기본 `locl`이 ASCII 숫자를 바꾼다.
// - ko이면 latn/KOR `locl`이 괄호·마침표·빗금 같은 문장 부호를 바꾼다.
// 그래서 `locl`을 끄고 cmap 기본 glyph만 쓴다. rhwp는 글자마다 textLength로 폭을 고정하므로
// 배치는 바뀌지 않는다. 언어는 UI locale과 무관하게 한국어로 고정해 fallback 글꼴 선택을 맞춘다.
export const DEFAULT_HWP_PAGE_LANGUAGE = 'ko'
export const EXTRACTABLE_GLYPH_STYLE = 'font-feature-settings: "locl" 0'
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'

export function applyExtractableTextDefaults(root: Element, language = DEFAULT_HWP_PAGE_LANGUAGE): void {
  if (!root.hasAttributeNS(XML_NAMESPACE, 'lang') && !root.hasAttribute('xml:lang') && !root.hasAttribute('lang')) {
    root.setAttributeNS(XML_NAMESPACE, 'xml:lang', language)
  }
  // font-feature-settings는 상속 속성이라 root에 한 번 두면 모든 text/tspan과 fallback 글꼴에 적용된다.
  const style = root.getAttribute('style')?.trim().replace(/;+$/u, '')
  root.setAttribute('style', style ? `${style}; ${EXTRACTABLE_GLYPH_STYLE}` : EXTRACTABLE_GLYPH_STYLE)
}
