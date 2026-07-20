import { HWPXDocument, OWPMLHead, OWPMLBody, NormalizedDocument, FontFace, BorderFill, CharPr, ParaPr, TabPr, Numbering, Bullet, NormalizedSection, NormalizedParagraph, NormalizedTextRun, NormalizedTable, NormalizedControl, Paragraph, Run, Table, Control, TableCell } from '../../shared/types';

/**
 * 파싱된 HWPX XML 데이터를 Han-Flow의 내부 데이터 모델로 정규화하는 함수.
 * 이 함수는 스타일 정보(단락, 표, 글꼴)를 효율적으로 JSON으로 맵핑하는 로직을 포함합니다.
 * @param headerData header.xml에서 파싱된 데이터
 * @param sectionsData sectionN.xml에서 파싱된 데이터 배열
 * @returns 정규화된 문서 객체
 */
export function normalizeDocument(rawHeader: any, rawSections: any[], binDataMap: { [path: string]: string } = {}): NormalizedDocument {
  console.log("Normalizing document data...");
  
  const getVal = (obj: any, key: string) => {
    if (!obj) return undefined;
    if (obj[key] !== undefined) return obj[key];
    if (obj[`hp:${key}`] !== undefined) return obj[`hp:${key}`];
    if (obj[`hh:${key}`] !== undefined) return obj[`hh:${key}`];
    if (obj[`hs:${key}`] !== undefined) return obj[`hs:${key}`];
    return undefined;
  };

  const headerData = getVal(rawHeader, "head") || rawHeader;

  // 1. 스타일 및 바이너리 데이터 정보 추출
  const binDataInternal: { [id: string]: { data: string; ext: string; mime: string } } = {};
  const rawBinDataList = getVal(headerData, "binData");
  if (rawBinDataList) {
    const bdList = getVal(rawBinDataList, "binData") || rawBinDataList;
    (Array.isArray(bdList) ? bdList : [bdList]).forEach(bd => {
      const id = bd["@_id"];
      const ref = bd["@_binaryItemIDRef"];
      
      // binDataMap에서 실제 데이터 찾기 (단순 매칭 전략)
      const path = Object.keys(binDataMap).find(p => p.includes(ref));
      if (path) {
        const ext = path.split('.').pop() || 'png';
        binDataInternal[id] = {
          data: binDataMap[path],
          ext: ext,
          mime: `image/${ext === 'jpg' ? 'jpeg' : ext}`
        };
      }
    });
  }

  // 스타일 정보 (기존 로직 유지)
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
  const normalizedSections: NormalizedSection[] = rawSections.map((sectionBody, sIdx) => {
    console.log(`Normalizing section ${sIdx + 1}...`);
    const paragraphs: NormalizedParagraph[] = [];
    const sectionRoot = getVal(sectionBody, "sec") || sectionBody;
    const keys = Object.keys(sectionRoot);
    
    const processParagraph = (p: any, pIdx: number) => {
      const content: (NormalizedTextRun | NormalizedTable | NormalizedControl | NormalizedEquation | NormalizedImage)[] = [];
      const rawRuns = getVal(p, "run");
      if (rawRuns) {
        (Array.isArray(rawRuns) ? rawRuns : [rawRuns]).forEach((run: any) => {
          const runCharPrId = run["@_charPrRef"] || p["@_charPrRef"] || "0";
          
          // 텍스트 처리
          const t = getVal(run, "t");
          if (t) {
            const textContent = typeof t === 'string' ? t : (t["#text"] || "");
            content.push({
              type: "text",
              text: textContent,
              styleId: runCharPrId
            });
          }

          // 수식(Equation) 처리
          const equation = getVal(run, "equation");
          if (equation) {
            content.push({
              type: "equation",
              id: `eq-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              script: typeof equation.script === 'string' ? equation.script : (equation.script?.["#text"] || ""),
              styleId: runCharPrId
            });
          }

          // 이미지(Picture) 처리
          const pic = getVal(run, "pic");
          if (pic) {
            const img = getVal(pic, "img");
            const shapeObj = getVal(pic, "shapeObj");
            const sz = shapeObj ? getVal(shapeObj, "sz") : null;
            
            content.push({
              type: "image",
              id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              binDataId: img ? img["@_binaryItemIDRef"] : "0",
              width: sz ? parseInt(sz["@_width"]) / 100 : 100, // HWPUNIT -> mm (근사치)
              height: sz ? parseInt(sz["@_height"]) / 100 : 100,
              styleId: runCharPrId
            });
          }
          
          // 기타 요소(탭, 줄바꿈)
          if (!t && !equation && !pic) {
            if (getVal(run, "tab")) {
              content.push({ type: "text", text: "\t", styleId: runCharPrId });
            } else if (getVal(run, "lineBreak")) {
              content.push({ type: "text", text: "\n", styleId: runCharPrId });
            }
          }
        });
      }
      
      if (content.length === 0) content.push({ type: "text", text: "", styleId: p["@_charPrRef"] || "0" });
      
      return {
        id: `p-${sIdx}-${pIdx}-${Math.random().toString(36).substr(2, 4)}`,
        styleId: p["@_paraPrRef"] || "0",
        content: content
      };
    };

    const processTable = (tbl: any, tIdx: number): NormalizedParagraph => {
      const rawRows = getVal(tbl, "tr");
      const tableRows = Array.isArray(rawRows) ? rawRows : [rawRows];
      const normalizedCells: NormalizedTableCell[][] = [];

      tableRows.forEach((row) => {
        const rowCells: NormalizedTableCell[] = [];
        const rawTcs = getVal(row, "tc");
        const cells = Array.isArray(rawTcs) ? rawTcs : [rawTcs];
        
        cells.forEach((cell: any) => {
          const paragraphs: NormalizedParagraph[] = [];
          const cellRawPs = getVal(cell, "p");
          if (cellRawPs) {
            const cellParagraphs = Array.isArray(cellRawPs) ? cellRawPs : [cellRawPs];
            cellParagraphs.forEach((cp, cpIdx) => {
              paragraphs.push(processParagraph(cp, cpIdx) as NormalizedParagraph);
            });
          }

          rowCells.push({
            id: `cell-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            colSpan: parseInt(cell["@_colSpan"]) || 1,
            rowSpan: parseInt(cell["@_rowSpan"]) || 1,
            width: parseInt(cell["@_width"]),
            height: parseInt(cell["@_height"]),
            styleId: cell["@_borderFillRef"] || "0",
            paragraphs: paragraphs
          });
        });
        normalizedCells.push(rowCells);
      });

      return {
        id: `tbl-para-${sIdx}-${tIdx}`,
        styleId: "0",
        content: [{
          type: "table",
          id: tbl["@_id"] || `tbl-${Date.now()}`,
          width: parseInt(tbl["@_width"]) || 0,
          height: parseInt(tbl["@_height"]) || 0,
          colCount: parseInt(tbl["@_colCount"]) || 0,
          rowCount: parseInt(tbl["@_rowCount"]) || 0,
          cells: normalizedCells
        }]
      };
    };

    // 모든 요소 순차 처리
    keys.forEach((key, idx) => {
      const val = sectionRoot[key];
      if (key.includes(":p") || key === "p") {
        (Array.isArray(val) ? val : [val]).forEach((p, i) => paragraphs.push(processParagraph(p, idx + i) as NormalizedParagraph));
      } else if (key.includes(":tbl") || key === "tbl") {
        (Array.isArray(val) ? val : [val]).forEach((tbl, i) => paragraphs.push(processTable(tbl, idx + i) as NormalizedParagraph));
      }
    });

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
