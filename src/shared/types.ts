/**
 * @file HWPX 문서 구조를 위한 TypeScript 인터페이스 정의
 * @description OWPML(KS X 6101) 표준 스키마를 기반으로 HWPX XML 데이터를 타입스크립트 객체로 매핑하기 위한 인터페이스들을 정의합니다.
 */

// OWPML Root Element
export interface OWPML {
  "owp:hwpx": HWPXDocument;
}

// HWPX Document Structure
export interface HWPXDocument {
  "@_version": string;
  "@_id": string;
  "owp:head": OWPMLHead;
  "owp:body": OWPMLBody;
}

// Document Head (header.xml content)
export interface OWPMLHead {
  "hp:docData": DocData;
  "hp:fontFaces": FontFaces;
  "hp:borderFills": BorderFills;
  "hp:charProperties": CharProperties;
  "hp:paraProperties": ParaProperties;
  "hp:tabProperties": TabProperties;
  "hp:numberingPeriods": NumberingPeriods;
  "hp:bullets": Bullets;
  "hp:compatibleDocument": CompatibleDocument;
  "hp:trackChanges": TrackChanges;
}

export interface DocData {
  "hp:docOption": DocOption;
  "hp:docHistory": DocHistory;
  "hp:docEtc": DocEtc;
}

export interface DocOption {
  "@_lineWrap": string;
  "@_charBorder": string;
  "@_wordBreak": string;
  "@_autoHyphen": string;
  "@_spaceOptimize": string;
  "@_tabChar": string;
  "@_autoSpacing": string;
  "@_showGrid": string;
  "@_showOutline": string;
  "@_showRevision": string;
  "@_showHyperlink": string;
  "@_showBookmark": string;
  "@_showField": string;
  "@_showHiddenText": string;
  "@_showHeaderFooter": string;
  "@_showPageBorder": string;
  "@_showPageFill": string;
  "@_showDrawingObject": string;
  "@_showTable": string;
  "@_showPicture": string;
  "@_showChart": string;
  "@_showEquation": string;
  "@_showOLE": string;
  "@_showControl": string;
  "@_showMemo": string;
  "@_showTrackChange": string;
  "@_showComment": string;
  "@_showFootnote": string;
  "@_showEndnote": string;
  "@_showNote": string;
  "@_showLineNumber": string;
  "@_showForm": string;
  "@_showFormBorder": string;
  "@_showFormFill": string;
  "@_showFormText": string;
  "@_showFormPicture": string;
  "@_showFormChart": string;
  "@_showFormEquation": string;
  "@_showFormOLE": string;
  "@_showFormControl": string;
  "@_showFormMemo": string;
  "@_showFormTrackChange": string;
  "@_showFormComment": string;
  "@_showFormFootnote": string;
  "@_showFormEndnote": string;
  "@_showFormNote": string;
  "@_showFormLineNumber": string;
}

export interface DocHistory {
  "hp:history": HistoryEntry[];
}

export interface HistoryEntry {
  "@_id": string;
  "@_date": string;
  "@_time": string;
  "@_version": string;
  "@_creator": string;
  "@_description": string;
}

export interface DocEtc {
  // TODO: Add more specific types for DocEtc if needed
}

export interface FontFaces {
  "hp:fontFace": FontFace[];
}

export interface FontFace {
  "@_id": string;
  "@_name": string;
  "hp:font": Font;
}

export interface Font {
  "@_type": string;
  "@_family": string;
  "@_csFamily": string;
  "@_engFamily": string;
  "@_jpnFamily": string;
  "@_symFamily": string;
  "@_hangulFamily": string;
  "@_hanjaFamily": string;
  "@_userDefined": string;
}

export interface BorderFills {
  "hp:borderFill": BorderFill[];
}

export interface BorderFill {
  "@_id": string;
  "@_type": string;
  "@_fillBrush": string;
  "@_leftBorder": string;
  "@_rightBorder": string;
  "@_topBorder": string;
  "@_bottomBorder": string;
  "@_diagonal": string;
}

export interface CharProperties {
  "hp:charPr": CharPr[];
}

export interface CharPr {
  "@_id": string;
  "@_name": string;
  "@_fontRef": string; // Reference to FontFace ID
  "@_height": string;
  "@_textColor": string;
  "@_bold": string;
  "@_italic": string;
  "@_underline": string;
  "@_strikeout": string;
  "@_shadow": string;
  "@_emboss": string;
  "@_engrave": string;
  "@_outline": string;
  "@_subscript": string;
  "@_superscript": string;
  "@_spacing": string;
  "@_charOffset": string;
  "@_scale": string;
  "@_rotation": string;
  "@_kerning": string;
  "@_strikeoutColor": string;
  "@_underlineColor": string;
  "@_shadowColor": string;
  "@_shadowOffsetX": string;
  "@_shadowOffsetY": string;
  "@_shadowType": string;
  "@_strikeoutType": string;
  "@_underlineType": string;
}

export interface ParaProperties {
  "hp:paraPr": ParaPr[];
}

export interface ParaPr {
  "@_id": string;
  "@_name": string;
  "@_align": string;
  "@_lineSpacing": string;
  "@_lineSpacingType": string;
  "@_leftIndent": string;
  "@_rightIndent": string;
  "@_firstLineIndent": string;
  "@_topMargin": string;
  "@_bottomMargin": string;
  "@_breakSetting": string;
  "@_widowOrphan": string;
  "@_keepWithNext": string;
  "@_keepLines": string;
  "@_pageBreakBefore": string;
  "@_lineWrap": string;
  "@_fontAlign": string;
  "@_snapToGrid": string;
  "@_suppressLineNumbers": string;
  "@_contextualSpacing": string;
  "@_condense": string;
  "@_tabPrRef": string; // Reference to TabProperties ID
  "@_borderFillRef": string; // Reference to BorderFill ID
}

export interface TabProperties {
  "hp:tabPr": TabPr[];
}

export interface TabPr {
  "@_id": string;
  "@_autoTabLeft": string;
  "@_autoTabRight": string;
  "hp:tabItem": TabItem[];
}

export interface TabItem {
  "@_pos": string;
  "@_type": string;
  "@_leader": string;
}

export interface NumberingPeriods {
  "hp:numbering": Numbering[];
}

export interface Numbering {
  "@_id": string;
  "@_start": string;
  "hp:level": Level[];
}

export interface Level {
  "@_level": string;
  "@_start": string;
  "@_format": string;
  "@_charPrRef": string;
  "@_paraPrRef": string;
  "@_suffix": string;
  "@_text": string;
}

export interface Bullets {
  "hp:bullet": Bullet[];
}

export interface Bullet {
  "@_id": string;
  "@_charPrRef": string;
  "@_paraPrRef": string;
  "@_image": string;
}

export interface CompatibleDocument {
  // TODO: Add specific types if needed
}

export interface TrackChanges {
  // TODO: Add specific types if needed
}

// Document Body (sectionN.xml content)
export interface OWPMLBody {
  "hp:section": Section[];
}

export interface Section {
  "hp:p": Paragraph[];
}

export interface Paragraph {
  "@_paraPrRef": string; // Reference to ParaPr ID
  "@_charPrRef": string; // Reference to CharPr ID (default for paragraph)
  "hp:run": Run[];
  "hp:tbl": Table[];
  "hp:ctrl": Control[];
  // Other possible elements within a paragraph
}

export interface Run {
  "@_charPrRef": string; // Reference to CharPr ID
  "hp:t": Text;
  "hp:tab": Tab;
  "hp:lineBreak": LineBreak;
  // Other possible elements within a run
}

export interface Text {
  "#text": string;
}

export interface Tab {
  // Tab element is usually empty or has attributes
}

export interface LineBreak {
  // LineBreak element is usually empty or has attributes
}

export interface Table {
  "@_id": string;
  "@_width": string;
  "@_height": string;
  "@_colCount": string;
  "@_rowCount": string;
  "hp:cellZone": CellZone[];
  "hp:tr": TableRow[];
}

export interface CellZone {
  "@_colAddr": string;
  "@_rowAddr": string;
  "@_colSpan": string;
  "@_rowSpan": string;
}

export interface TableRow {
  "hp:tc": TableCell[];
}

export interface TableCell {
  "@_colSpan": string;
  "@_rowSpan": string;
  "hp:p": Paragraph[]; // A cell can contain paragraphs
}

export interface Control {
  "@_id": string;
  "@_type": string;
  // Generic control interface, specific controls will extend this
}

export interface Equation {
  "@_version": string;
  "@_baseLine": string;
  "@_textColor": string;
  "@_font": string;
  "@_size": string;
  "hp:script": string;
}

// Internal Normalized Document Model
export interface NormalizedDocument {
  metadata: {
    version: string;
    id: string;
    // Add other relevant metadata
  };
  styles: {
    fontFaces: { [id: string]: FontFace };
    borderFills: { [id: string]: BorderFill };
    charProperties: { [id: string]: CharPr };
    paraProperties: { [id: string]: ParaPr };
    tabProperties: { [id: string]: TabPr };
    numberingPeriods: { [id: string]: Numbering };
    bullets: { [id: string]: Bullet };
  };
  binData: { [id: string]: { data: string; ext: string; mime: string } };
  sections: NormalizedSection[];
}

export interface NormalizedSection {
  paragraphs: NormalizedParagraph[];
}

export interface NormalizedParagraph {
  id: string;
  styleId: string; // Reference to NormalizedDocument.styles.paraProperties
  content: NormalizedContentElement[];
}

export type NormalizedContentElement = NormalizedTextRun | NormalizedTable | NormalizedControl | NormalizedEquation | NormalizedImage;

export interface NormalizedTextRun {
  type: "text";
  text: string;
  styleId: string; // Reference to NormalizedDocument.styles.charProperties
}

export interface NormalizedTable {
  type: "table";
  id: string;
  width: number;
  height: number;
  colCount: number;
  rowCount: number;
  cells: NormalizedTableCell[][];
}

export interface NormalizedTableCell {
  id: string;
  colSpan: number;
  rowSpan: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
  styleId: string; // Reference to borderFill style
  paragraphs: NormalizedParagraph[];
}

export interface NormalizedEquation {
  type: "equation";
  id: string;
  script: string;
  styleId: string;
}

export interface NormalizedImage {
  type: "image";
  id: string;
  binDataId: string; // Reference to NormalizedDocument.binData
  width: number;
  height: number;
  styleId: string;
}

export interface NormalizedControl {
  type: "control";
  id: string;
  // TODO: Add more specific control properties
}
