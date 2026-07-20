import { NormalizedDocument, NormalizedSection, NormalizedParagraph, NormalizedTextRun, NormalizedTable, CharPr, ParaPr, FontFace } from "../../shared/types";

/**
 * 정규화된 모델을 기반으로 CSS 스타일 객체를 생성하는 유틸리티
 */
export const StyleResolver = {
  /**
   * CharPr(글자 모양)을 CSS 스타일 객체로 변환
   */
  resolveCharStyle(charPr: CharPr, fontFaces: { [id: string]: FontFace }): React.CSSProperties {
    if (!charPr) return {};

    const style: React.CSSProperties = {
      fontSize: charPr["@_height"] ? `${parseInt(charPr["@_height"]) / 100}pt` : "10pt",
      color: charPr["@_textColor"] || "inherit",
      fontWeight: charPr["@_bold"] === "1" ? "bold" : "normal",
      fontStyle: charPr["@_italic"] === "1" ? "italic" : "normal",
      textDecoration: [
        charPr["@_underline"] !== "none" ? "underline" : "",
        charPr["@_strikeout"] !== "none" ? "line-through" : ""
      ].filter(Boolean).join(" ") || "none",
    };

    // 폰트 처리
    const fontRef = charPr["@_fontRef"];
    if (fontRef && fontFaces[fontRef]) {
      const fontFace = fontFaces[fontRef];
      // 한글 폰트를 우선적으로 사용 (시스템 폰트 매핑 필요)
      style.fontFamily = fontFace["hp:font"]?.["@_hangulFamily"] || fontFace["@_name"];
    }

    return style;
  },

  /**
   * ParaPr(문단 모양)을 CSS 스타일 객체로 변환
   */
  resolveParaStyle(paraPr: ParaPr): React.CSSProperties {
    if (!paraPr) return {};

    const style: React.CSSProperties = {
      textAlign: (paraPr["@_align"] as any) || "justify",
      lineHeight: paraPr["@_lineSpacing"] ? `${parseInt(paraPr["@_lineSpacing"]) / 100}` : "1.6",
      marginTop: paraPr["@_topMargin"] ? `${parseInt(paraPr["@_topMargin"]) / 100}mm` : "0",
      marginBottom: paraPr["@_bottomMargin"] ? `${parseInt(paraPr["@_bottomMargin"]) / 100}mm` : "0",
      marginLeft: paraPr["@_leftIndent"] ? `${parseInt(paraPr["@_leftIndent"]) / 100}mm` : "0",
      marginRight: paraPr["@_rightIndent"] ? `${parseInt(paraPr["@_rightIndent"]) / 100}mm` : "0",
      textIndent: paraPr["@_firstLineIndent"] ? `${parseInt(paraPr["@_firstLineIndent"]) / 100}mm` : "0",
    };

    // 한글 정렬 값 매핑
    const alignMap: { [key: string]: string } = {
      "justify": "justify",
      "left": "left",
      "right": "right",
      "center": "center",
      "distribute": "space-between"
    };
    if (paraPr["@_align"]) {
      style.textAlign = (alignMap[paraPr["@_align"]] as any) || "justify";
    }

    return style;
  }
};

/**
 * 전역 스타일 시트 생성 (클래스 기반 스타일링을 위함)
 */
export function generateGlobalStyles(doc: NormalizedDocument): string {
  let css = "";
  
  // 문단 스타일 생성
  Object.entries(doc.styles.paraProperties).forEach(([id, pr]) => {
    const s = StyleResolver.resolveParaStyle(pr);
    css += `.para-style-${id} { 
      text-align: ${s.textAlign}; 
      line-height: ${s.lineHeight};
      margin-top: ${s.marginTop};
      margin-bottom: ${s.marginBottom};
      margin-left: ${s.marginLeft};
      margin-right: ${s.marginRight};
      text-indent: ${s.textIndent};
    }\n`;
  });

  // 글자 스타일 생성
  Object.entries(doc.styles.charProperties).forEach(([id, pr]) => {
    const s = StyleResolver.resolveCharStyle(pr, doc.styles.fontFaces);
    css += `.char-style-${id} { 
      font-size: ${s.fontSize}; 
      color: ${s.color};
      font-weight: ${s.fontWeight};
      font-style: ${s.fontStyle};
      text-decoration: ${s.textDecoration};
      font-family: "${s.fontFamily}", sans-serif;
    }\n`;
  });

  return css;
}
