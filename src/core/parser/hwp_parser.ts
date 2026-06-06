import { NormalizedDocument } from "../../shared/types";

/**
 * .hwp (바이너리, CFBF) 파일을 파싱하여 내부 JSON 모델로 변환하는 함수.
 * 현재는 구조 마련 단계이며, 실제 바이너리 파싱 로직(compound file binary format)이 추가될 예정입니다.
 * @param filePath 파싱할 HWP 파일의 경로
 * @returns 정규화된 문서 객체
 */
import * as CFB from 'cfb';
import * as zlib from 'zlib';

export async function parseHWP(filePath: string): Promise<NormalizedDocument> {
  console.log(`Starting binary HWP parsing for: ${filePath}`);
  
  try {
    const cfb = CFB.read(filePath, { type: 'file' });
    console.log("CFB streams:", cfb.FullPaths);
    
    // TODO: 
    // 1. FileHeader 스트림 확인 (HWP 5.0 여부)
    // 2. DocInfo 스트림 파싱 (스타일 정보)
    // 3. BodyText/SectionN 스트림 추출 및 zlib 압축 해제
    // 4. 레코드 단위 파싱
    
    throw new Error(".hwp 바이너리 파싱은 현재 스트림 추출 단계까지 구현되었습니다. 실제 내용 파싱은 개발 중입니다.");
  } catch (error) {
    console.error("HWP Binary parsing error:", error);
    throw error;
  }
}
