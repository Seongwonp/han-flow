import { HWPXDocument, OWPMLHead, OWPMLBody, NormalizedDocument, FontFace, BorderFill, CharPr, ParaPr, TabPr, Numbering, Bullet, NormalizedSection, NormalizedParagraph, NormalizedTextRun, NormalizedTable, NormalizedControl, Paragraph, Run, Table, Control, TableCell } from '../../shared/types';

/**
 * 파싱된 HWPX XML 데이터를 Han-Flow의 내부 데이터 모델로 정규화하는 함수.
 * 이 함수는 스타일 정보(단락, 표, 글꼴)를 효율적으로 JSON으로 맵핑하는 로직을 포함합니다.
 * @param headerData header.xml에서 파싱된 데이터
 * @param sectionsData sectionN.xml에서 파싱된 데이터 배열
 * @returns 정규화된 문서 객체
 */
export function normalizeDocument(headerData: any, sectionsData: any[]): NormalizedDocument {
  console.log("Normalizing document data...");
  
  // 데이터가 없는 경우 빈 객체로 초기화
  if (!headerData) headerData = {};

  // 네임스페이스(hp:)가 있을 수도 있고 없을 수도 있으므로 유연하게 접근하는 헬퍼 함수
  const getVal = (obj: any, key: string) => {
    if (!obj) return undefined;
    return obj[key] || obj[`hp:${key}`] || obj[`hh:${key}`] || obj[`hs:${key}`];
  };

  // 1. 스타일 정보 추출 및 맵핑
  const fontFaces: { [id: string]: FontFace } = {};
  const rawFontFaces = getVal(headerData, "fontFaces");
  if (rawFontFaces && getVal(rawFontFaces, "fontFace")) {
    const ffList = getVal(rawFontFaces, "fontFace");
    (Array.isArray(ffList) ? ffList : [ffList])
      .forEach(ff => fontFaces[ff["@_id"]] = ff);
  }

  const borderFills: { [id: string]: BorderFill } = {};
  const rawBorderFills = getVal(headerData, "borderFills");
  if (rawBorderFills && getVal(rawBorderFills, "borderFill")) {
    const bfList = getVal(rawBorderFills, "borderFill");
    (Array.isArray(bfList) ? bfList : [bfList])
      .forEach(bf => borderFills[bf["@_id"]] = bf);
  }

  const charProperties: { [id: string]: CharPr } = {};
  const rawCharPr = getVal(headerData, "charProperties");
  if (rawCharPr && getVal(rawCharPr, "charPr")) {
    const cpList = getVal(rawCharPr, "charPr");
    (Array.isArray(cpList) ? cpList : [cpList])
      .forEach(cp => charProperties[cp["@_id"]] = cp);
  }

  const paraProperties: { [id: string]: ParaPr } = {};
  const rawParaPr = getVal(headerData, "paraProperties");
  if (rawParaPr && getVal(rawParaPr, "paraPr")) {
    const ppList = getVal(rawParaPr, "paraPr");
    (Array.isArray(ppList) ? ppList : [ppList])
      .forEach(pp => paraProperties[pp["@_id"]] = pp);
  }

  const tabProperties: { [id: string]: TabPr } = {};
  const rawTabPr = getVal(headerData, "tabProperties");
  if (rawTabPr && getVal(rawTabPr, "tabPr")) {
    const tpList = getVal(rawTabPr, "tabPr");
    (Array.isArray(tpList) ? tpList : [tpList])
      .forEach(tp => tabProperties[tp["@_id"]] = tp);
  }

  const numberingPeriods: { [id: string]: Numbering } = {};
  const rawNumbering = getVal(headerData, "numberingPeriods");
  if (rawNumbering && getVal(rawNumbering, "numbering")) {
    const npList = getVal(rawNumbering, "numbering");
    (Array.isArray(npList) ? npList : [npList])
      .forEach(np => numberingPeriods[np["@_id"]] = np);
  }

  const bullets: { [id: string]: Bullet } = {};
  const rawBullets = getVal(headerData, "bullets");
  if (rawBullets && getVal(rawBullets, "bullet")) {
    const bList = getVal(rawBullets, "bullet");
    (Array.isArray(bList) ? bList : [bList])
      .forEach(b => bullets[b["@_id"]] = b);
  }

  const normalizedStyles = {
    fontFaces,
    borderFills,
    charProperties,
    paraProperties,
    tabProperties,
    numberingPeriods,
    bullets,
  };

  // 2. 섹션 데이터 정규화
  const normalizedSections: NormalizedSection[] = sectionsData.map(sectionBody => {
    const paragraphs: NormalizedParagraph[] = [];
    const section = getVal(sectionBody, "section");
    if (section && getVal(section, "p")) {
      const rawParagraphs = getVal(section, "p");
      const pList = Array.isArray(rawParagraphs) ? rawParagraphs : [rawParagraphs];
      
      pList.forEach((p: any, pIdx: number) => {
        const content: (NormalizedTextRun | NormalizedTable | NormalizedControl)[] = [];
        
        // 텍스트 런 처리
        const rawRuns = getVal(p, "run");
        if (rawRuns) {
          const runs = Array.isArray(rawRuns) ? rawRuns : [rawRuns];
          runs.forEach((run: any) => {
            const t = getVal(run, "t");
            if (t && t["#text"]) {
              content.push({
                type: "text",
                text: t["#text"],
                styleId: run["@_charPrRef"] || p["@_charPrRef"]
              });
            }
            if (getVal(run, "tab")) {
              content.push({ type: "text", text: "\t", styleId: run["@_charPrRef"] || p["@_charPrRef"] });
            }
            if (getVal(run, "lineBreak")) {
              content.push({ type: "text", text: "\n", styleId: run["@_charPrRef"] || p["@_charPrRef"] });
            }
          });
        }

        // 테이블 처리
        const rawTbls = getVal(p, "tbl");
        if (rawTbls) {
          const tables = Array.isArray(rawTbls) ? rawTbls : [rawTbls];
          tables.forEach((tbl: any) => {
            const rawRows = getVal(tbl, "tr");
            const tableRows = Array.isArray(rawRows) ? rawRows : [rawRows];
            const normalizedCells: NormalizedParagraph[][] = [];

            tableRows.forEach(row => {
              const rowCells: NormalizedParagraph[] = [];
              const rawTcs = getVal(row, "tc");
              const cells = Array.isArray(rawTcs) ? rawTcs : [rawTcs];
              cells.forEach((cell: any) => {
                const cellRawPs = getVal(cell, "p");
                if (cellRawPs) {
                  const cellParagraphs = Array.isArray(cellRawPs) ? cellRawPs : [cellRawPs];
                  cellParagraphs.forEach(cp => {
                    const cellContent: (NormalizedTextRun | NormalizedTable | NormalizedControl)[] = [];
                    const cpRawRuns = getVal(cp, "run");
                    if (cpRawRuns) {
                      const cellRuns = Array.isArray(cpRawRuns) ? cpRawRuns : [cpRawRuns];
                      cellRuns.forEach(cr => {
                        const crT = getVal(cr, "t");
                        if (crT && crT["#text"]) {
                          cellContent.push({ type: "text", text: crT["#text"], styleId: cr["@_charPrRef"] || cp["@_charPrRef"] });
                        }
                      });
                    }
                    rowCells.push({
                      id: `cell-p-${pIdx}-${rowCells.length}`,
                      styleId: cp["@_paraPrRef"],
                      content: cellContent
                    });
                  });
                }
              });
              normalizedCells.push(rowCells);
            });

            content.push({
              type: "table",
              id: tbl["@_id"],
              width: tbl["@_width"],
              height: tbl["@_height"],
              colCount: parseInt(tbl["@_colCount"]),
              rowCount: parseInt(tbl["@_rowCount"]),
              cells: normalizedCells
            });
          });
        }

        // 컨트롤 처리
        const rawCtrls = getVal(p, "ctrl");
        if (rawCtrls) {
          const controls = Array.isArray(rawCtrls) ? rawCtrls : [rawCtrls];
          controls.forEach((ctrl: any) => {
            content.push({
              type: "control",
              id: ctrl["@_id"],
            });
          });
        }

        paragraphs.push({
          id: `p-${pIdx}`,
          styleId: p["@_paraPrRef"],
          content: content
        });
      });
    }
    return { paragraphs };
  });

  // 최종 정규화된 문서 객체 반환
  const docData = getVal(headerData, "docData");
  const docOption = docData ? getVal(docData, "docOption") : undefined;
  
  return {
    metadata: {
      version: docOption ? docOption["@_lineWrap"] : "1.0",
      id: "document-id-1"
    },
    styles: normalizedStyles,
    sections: normalizedSections
  };
}
