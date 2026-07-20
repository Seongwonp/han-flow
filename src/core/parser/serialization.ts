import { NormalizedDocument, Paragraph, Run, Section, FontFace, CharPr, ParaPr } from '../../shared/types';
import { XMLBuilder } from 'fast-xml-parser';

/**
 * 정규화된 문서를 HWPX XML 구조로 변환하는 핵심 엔진
 */
export function serializeToHWPX(doc: NormalizedDocument): { [key: string]: string } {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    suppressEmptyNode: true
  });

  const files: { [key: string]: string } = {};

  // 1. Section XML 생성 (Contents/section0.xml)
  doc.sections.forEach((section, idx) => {
    const hpSection = {
      "@_xmlns:hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
      "@_xmlns:hs": "http://www.hancom.co.kr/hwpml/2011/section",
      "@_xmlns:hh": "http://www.hancom.co.kr/hwpml/2011/head",
      "@_xmlns:hc": "http://www.hancom.co.kr/hwpml/2011/core",
      "hp:p": section.paragraphs.map(p => {
        const runs = p.content.filter(c => c.type === 'text' || c.type === 'equation').map(c => {
          if (c.type === 'text') {
            return {
              "@_charPrRef": (c as any).styleId || "0",
              "hp:t": { "#text": (c as any).text }
            };
          } else if (c.type === 'equation') {
            const eq = c as any;
            return {
              "@_charPrRef": eq.styleId || "0",
              "hp:equation": {
                "@_version": "5.0",
                "@_baseLine": "0",
                "@_textColor": "000000",
                "@_font": "Batang",
                "@_size": "1000",
                "hp:script": { "#text": eq.script }
              }
            };
          }
          return null;
        }).filter(r => r !== null);

        const tbls = p.content.filter(c => c.type === 'table').map(t => {
          const tbl = t as any;
          return {
            "@_id": tbl.id,
            "@_width": tbl.width,
            "@_height": tbl.height,
            "@_colCount": tbl.colCount,
            "@_rowCount": tbl.rowCount,
            "hp:tr": tbl.cells.map((row: any) => ({
              "hp:tc": row.map((cell: any) => ({
                "@_colSpan": cell.colSpan || "1",
                "@_rowSpan": cell.rowSpan || "1",
                "@_borderFillRef": cell.styleId || "0",
                "@_backgroundColor": cell.backgroundColor || "", // 임시 속성
                "hp:p": cell.paragraphs.map((cp: any) => ({
                   "@_paraPrRef": cp.styleId || "0",
                   "hp:run": cp.content.map((cc: any) => {
                     if (cc.type === 'text') {
                       return {
                         "@_charPrRef": cc.styleId || "0",
                         "hp:t": { "#text": cc.text || "" }
                       };
                     } else if (cc.type === 'equation') {
                       return {
                         "@_charPrRef": cc.styleId || "0",
                         "hp:equation": {
                           "@_version": "5.0",
                           "hp:script": { "#text": cc.script }
                         }
                       };
                     }
                     return null;
                   }).filter((cr: any) => cr !== null)
                }))
              }))
            }))
          };
        });

        return {
          "@_paraPrRef": p.styleId || "0",
          "hp:run": runs,
          "hp:tbl": tbls.length > 0 ? tbls : undefined
        };
      })
    };

    files[`Contents/section${idx}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n` + builder.build({ "hs:sec": hpSection });
  });

  // 2. Header XML 생성 (Contents/header.xml)
  const header = {
    "@_xmlns:hh": "http://www.hancom.co.kr/hwpml/2011/head",
    "@_xmlns:hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
    "hp:beginNumber": { "@_page": "1", "@_footnote": "1", "@_endnote": "1", "@_pic": "1", "@_tbl": "1", "@_equation": "1" },
    "hp:fontFaces": {
      "hp:fontFace": Object.entries(doc.styles.fontFaces).map(([id, ff]) => ({
        "@_id": id,
        "@_name": ff["@_name"],
        "hp:font": ff["hp:font"]
      }))
    },
    "hp:charProperties": {
      "hp:charPr": Object.entries(doc.styles.charProperties).map(([id, cp]) => ({
        "@_id": id,
        ...cp
      }))
    },
    "hp:paraProperties": {
      "hp:paraPr": Object.entries(doc.styles.paraProperties).map(([id, pp]) => ({
        "@_id": id,
        ...pp
      }))
    },
    "hp:docData": {
      "hp:docOption": { "@_lineWrap": "break" }
    }
  };

  files['Contents/header.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n` + builder.build({ "hh:head": header });

  return files;
}
