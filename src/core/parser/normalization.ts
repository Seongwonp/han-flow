import { HWPXDocument, OWPMLHead, OWPMLBody, NormalizedDocument, FontFace, BorderFill, CharPr, ParaPr, TabPr, Numbering, Bullet, NormalizedSection, NormalizedParagraph, NormalizedTextRun, NormalizedTable, NormalizedControl, Paragraph, Run, Table, Control, TableCell } from '../../shared/types';

/**
 * 파싱된 HWPX XML 데이터를 Han-Flow의 내부 데이터 모델로 정규화하는 함수.
 * 이 함수는 스타일 정보(단락, 표, 글꼴)를 효율적으로 JSON으로 맵핑하는 로직을 포함합니다.
 * @param headerData header.xml에서 파싱된 데이터
 * @param sectionsData sectionN.xml에서 파싱된 데이터 배열
 * @returns 정규화된 문서 객체
 */
export function normalizeDocument(headerData: OWPMLHead, sectionsData: OWPMLBody[]): NormalizedDocument {
  console.log("Normalizing document data...");

  // 1. 스타일 정보 추출 및 맵핑
  const fontFaces: { [id: string]: FontFace } = {};
  if (headerData["hp:fontFaces"] && headerData["hp:fontFaces"]["hp:fontFace"]) {
    (Array.isArray(headerData["hp:fontFaces"]["hp:fontFace"]) ? headerData["hp:fontFaces"]["hp:fontFace"] : [headerData["hp:fontFaces"]["hp:fontFace"]])
      .forEach(ff => fontFaces[ff["@_id"]] = ff);
  }

  const borderFills: { [id: string]: BorderFill } = {};
  if (headerData["hp:borderFills"] && headerData["hp:borderFills"]["hp:borderFill"]) {
    (Array.isArray(headerData["hp:borderFills"]["hp:borderFill"]) ? headerData["hp:borderFills"]["hp:borderFill"] : [headerData["hp:borderFills"]["hp:borderFill"]])
      .forEach(bf => borderFills[bf["@_id"]] = bf);
  }

  const charProperties: { [id: string]: CharPr } = {};
  if (headerData["hp:charProperties"] && headerData["hp:charProperties"]["hp:charPr"]) {
    (Array.isArray(headerData["hp:charProperties"]["hp:charPr"]) ? headerData["hp:charProperties"]["hp:charPr"] : [headerData["hp:charProperties"]["hp:charPr"]])
      .forEach(cp => charProperties[cp["@_id"]] = cp);
  }

  const paraProperties: { [id: string]: ParaPr } = {};
  if (headerData["hp:paraProperties"] && headerData["hp:paraProperties"]["hp:paraPr"]) {
    (Array.isArray(headerData["hp:paraProperties"]["hp:paraPr"]) ? headerData["hp:paraProperties"]["hp:paraPr"] : [headerData["hp:paraProperties"]["hp:paraPr"]])
      .forEach(pp => paraProperties[pp["@_id"]] = pp);
  }

  const tabProperties: { [id: string]: TabPr } = {};
  if (headerData["hp:tabProperties"] && headerData["hp:tabProperties"]["hp:tabPr"]) {
    (Array.isArray(headerData["hp:tabProperties"]["hp:tabPr"]) ? headerData["hp:tabProperties"]["hp:tabPr"] : [headerData["hp:tabProperties"]["hp:tabPr"]])
      .forEach(tp => tabProperties[tp["@_id"]] = tp);
  }

  const numberingPeriods: { [id: string]: Numbering } = {};
  if (headerData["hp:numberingPeriods"] && headerData["hp:numberingPeriods"]["hp:numbering"]) {
    (Array.isArray(headerData["hp:numberingPeriods"]["hp:numbering"]) ? headerData["hp:numberingPeriods"]["hp:numbering"] : [headerData["hp:numberingPeriods"]["hp:numbering"]])
      .forEach(np => numberingPeriods[np["@_id"]] = np);
  }

  const bullets: { [id: string]: Bullet } = {};
  if (headerData["hp:bullets"] && headerData["hp:bullets"]["hp:bullet"]) {
    (Array.isArray(headerData["hp:bullets"]["hp:bullet"]) ? headerData["hp:bullets"]["hp:bullet"] : [headerData["hp:bullets"]["hp:bullet"]])
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
    if (sectionBody["hp:section"] && sectionBody["hp:section"]["hp:p"]) {
      const rawParagraphs = Array.isArray(sectionBody["hp:section"]["hp:p"]) ? sectionBody["hp:section"]["hp:p"] : [sectionBody["hp:section"]["hp:p"]];
      rawParagraphs.forEach((p: Paragraph, pIdx: number) => {
        const content: (NormalizedTextRun | NormalizedTable | NormalizedControl)[] = [];
        
        // 텍스트 런 처리
        if (p["hp:run"]) {
          const runs = Array.isArray(p["hp:run"]) ? p["hp:run"] : [p["hp:run"]];
          runs.forEach((run: Run) => {
            if (run["hp:t"] && run["hp:t"]["#text"]) {
              content.push({
                type: "text",
                text: run["hp:t"]["#text"],
                styleId: run["@_charPrRef"] || p["@_charPrRef"] // 런에 스타일이 없으면 단락 기본 스타일 사용
              });
            }
            // TODO: 탭, 줄바꿈 등 다른 런 요소 처리
            if (run["hp:tab"]) {
              content.push({ type: "text", text: "\t", styleId: run["@_charPrRef"] || p["@_charPrRef"] });
            }
            if (run["hp:lineBreak"]) {
              content.push({ type: "text", text: "\n", styleId: run["@_charPrRef"] || p["@_charPrRef"] });
            }
          });
        }

        // 테이블 처리
        if (p["hp:tbl"]) {
          const tables = Array.isArray(p["hp:tbl"]) ? p["hp:tbl"] : [p["hp:tbl"]];
          tables.forEach((tbl: Table) => {
            // TODO: 테이블의 상세 속성 및 셀 내용 재귀적으로 처리
            const tableRows = Array.isArray(tbl["hp:tr"]) ? tbl["hp:tr"] : [tbl["hp:tr"]];
            const normalizedCells: NormalizedParagraph[][] = [];

            tableRows.forEach(row => {
              const rowCells: NormalizedParagraph[] = [];
              const cells = Array.isArray(row["hp:tc"]) ? row["hp:tc"] : [row["hp:tc"]];
              cells.forEach((cell: TableCell) => {
                // 셀 내부에 단락이 있을 수 있으므로 재귀적으로 처리
                if (cell["hp:p"]) {
                  const cellParagraphs = Array.isArray(cell["hp:p"]) ? cell["hp:p"] : [cell["hp:p"]];
                  cellParagraphs.forEach(cp => {
                    // 셀 내부 단락도 정규화해야 함. 여기서는 간단히 텍스트만 추출
                    const cellContent: (NormalizedTextRun | NormalizedTable | NormalizedControl)[] = [];
                    if (cp["hp:run"]) {
                      const cellRuns = Array.isArray(cp["hp:run"]) ? cp["hp:run"] : [cp["hp:run"]];
                      cellRuns.forEach(cr => {
                        if (cr["hp:t"] && cr["hp:t"]["#text"]) {
                          cellContent.push({ type: "text", text: cr["hp:t"]["#text"], styleId: cr["@_charPrRef"] || cp["@_charPrRef"] });
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
              cells: normalizedCells // 정규화된 셀 내용 추가
            });
          });
        }

        // 컨트롤 처리
        if (p["hp:ctrl"]) {
          const controls = Array.isArray(p["hp:ctrl"]) ? p["hp:ctrl"] : [p["hp:ctrl"]];
          controls.forEach((ctrl: Control) => {
            content.push({
              type: "control",
              id: ctrl["@_id"],
              // TODO: 컨트롤의 상세 속성 처리
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
  return {
    metadata: {
      version: headerData["hp:docData"]["hp:docOption"]["@_lineWrap"], // 임시로 docOption의 한 속성 사용
      id: "document-id-1" // 임시 ID
    },
    styles: normalizedStyles,
    sections: normalizedSections
  };
}
