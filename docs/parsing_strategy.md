# HWPX 파싱 전략: Pipeline & Schema

HWPX는 ZIP 아카이브 내에 XML 파일들이 구조화된 형태(OPC, Open Packaging Conventions)를 가집니다. Han-Flow는 이를 효율적으로 분석하기 위해 스트리밍 파이프라인 방식을 채택합니다.

## 1. 파싱 파이프라인 (Node.js/TypeScript)

```typescript
/**
 * HWPX 파싱 파이프라인 로직 개요
 */
import { createReadStream } from 'fs';
import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

export async function parseHWPX(filePath: string) {
  // 1. ZIP 스트림 오픈
  const directory = await unzipper.Open.file(filePath);
  
  // 2. 핵심 파일 추출 (header.xml, section0.xml 등)
  const headerFile = directory.files.find(f => f.path === 'Contents/header.xml');
  const sectionFiles = directory.files.filter(f => f.path.startsWith('Contents/section'));

  // 3. XML to JSON 변환 (fast-xml-parser 활용)
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  
  const headerData = parser.parse(await headerFile.buffer());
  const sections = await Promise.all(
    sectionFiles.map(async (f) => parser.parse(await f.buffer()))
  );

  // 4. Han-Flow 내부 모델로 정규화 (Normalization)
  return normalizeDocument(headerData, sections);
}
```

## 2. 스타일 정보 맵핑 (JSON 스키마 예시)

HWPX의 스타일(단락, 표, 글꼴)을 렌더링 엔진이 이해하기 쉬운 형태로 맵핑합니다.

### 2.1 Paragraph Style (단락 스타일)
```json
{
  "id": "p-style-1",
  "name": "바탕글",
  "align": "justify",
  "lineHeight": "160%",
  "margin": {
    "top": 0,
    "bottom": 0,
    "left": 0,
    "right": 0
  },
  "indent": 0
}
```

### 2.2 Char Shape (글자 모양)
```json
{
  "id": "c-shape-1",
  "fontFamily": {
    "hangul": "함초롬바탕",
    "latin": "Times New Roman"
  },
  "fontSize": 10,
  "bold": true,
  "italic": false,
  "color": "#000000"
}
```

## 3. 효율적인 맵핑 전략
효율적인 맵핑 전략을 위해 `header.xml`에 정의된 `CharShape`와 `ParaShape`는 ID 기반 Map 객체로 캐싱되어 `section.xml` 파싱 시 즉시 참조됩니다. 대용량 문서의 경우 모든 섹션을 한 번에 파싱하는 대신, 사용자가 보고 있는 섹션부터 우선순위로 파싱하고 캐싱하는 Lazy Loading 방식을 적용하여 성능을 최적화합니다. 또한, Zod 또는 JSON Schema를 사용하여 파싱된 데이터의 무결성을 검증하고 레이아웃 깨짐의 잠재적 원인을 사전에 차단합니다.


## References

- [1] 한글과컴퓨터. (n.d.). *HWP/OWPML 형식*. Retrieved from [https://developer.hancom.com/hwpx-owpml-model](https://developer.hancom.com/hwpx-owpml-model)
- [2] 한컴테크. (2025, 2월 26일). *한/글 문서 파일 형식 : HWPX 포맷 구조 살펴보기*. Retrieved from [https://tech.hancom.com/hwpxformat/](https://tech.hancom.com/hwpxformat/)
