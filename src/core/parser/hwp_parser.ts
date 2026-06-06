import { NormalizedDocument } from "../../shared/types";

/**
 * .hwp (바이너리, CFBF) 파일을 파싱하여 내부 JSON 모델로 변환하는 함수.
 * 현재는 구조 마련 단계이며, 실제 바이너리 파싱 로직(compound file binary format)이 추가될 예정입니다.
 * @param filePath 파싱할 HWP 파일의 경로
 * @returns 정규화된 문서 객체
 */
export async function parseHWP(filePath: string): Promise<NormalizedDocument> {
  console.log(`Starting binary HWP parsing for: ${filePath}`);
  
  // TODO: 
  // 1. CFBF (Compound File Binary Format) 라이브러리 연동 (예: compound-file-js)
  // 2. DocInfo, BodyText 스트림 추출
  // 3. zlib 압축 해제
  // 4. 바이너리 레코드 파싱 및 JSON 정규화
  
  throw new Error(".hwp 바이너리 파싱 기능은 현재 구현 중입니다. HWPX 형식을 권장합니다.");
}
