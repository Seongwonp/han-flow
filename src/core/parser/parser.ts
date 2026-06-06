import { createReadStream } from 'fs';
import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';
import { OWPMLHead, OWPMLBody, NormalizedDocument } from '../../shared/types';
import { normalizeDocument } from './normalization';

/**
 * HWPX 파일을 파싱하여 내부 JSON 모델로 변환하는 함수.
 * ZIP 압축 해제 및 XML 스트림 처리를 담당합니다.
 * @param filePath 파싱할 HWPX 파일의 경로
 * @returns 정규화된 문서 객체
 */
export async function parseHWPX(filePath: string): Promise<NormalizedDocument> {
  try {
    // 1. ZIP 스트림 오픈
    const directory = await unzipper.Open.file(filePath);
    
    // 2. 핵심 파일 추출 (header.xml, section0.xml 등)
    const headerFile = directory.files.find(f => f.path === 'Contents/header.xml');
    const sectionFiles = directory.files.filter(f => f.path.startsWith('Contents/section'));

    if (!headerFile) {
      throw new Error('header.xml not found in HWPX file.');
    }

    // 3. XML to JSON 변환 (fast-xml-parser 활용)
    // OWPML(KS X 6101) 표준 스키마를 기반으로 XML을 파싱합니다.
    // ignoreAttributes: false, attributeNamePrefix: "@_" 설정으로 속성도 파싱하고 접두사를 붙입니다.
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    
    const headerData: OWPMLHead = parser.parse(await headerFile.buffer())['hp:head'];
    const sectionsData: OWPMLBody[] = await Promise.all(
      sectionFiles.map(async (f) => parser.parse(await f.buffer())['hp:body'])
    );

    // 4. Han-Flow 내부 모델로 정규화 (Normalization)
    return normalizeDocument(headerData, sectionsData);

  } catch (error) {
    console.error(`Error parsing HWPX file: ${error}`);
    throw error;
  }
}
