# Han-Flow v1 기준선과 실행 계획

작성일: 2026-07-20

## 제품 계약

Han-Flow v1은 macOS용 **읽기 전용 HWPX 뷰어**다. 받은 `.hwpx` 파일을 Finder에서
더블클릭해 1초 안에 첫 화면을 표시하고, 읽기 좋은 레이아웃으로 보여 주며, PDF로
내보내는 데 집중한다.

v1에서 하지 않는 일:

- 문서 편집, 저장, Undo/Redo, 입력기 처리
- `.hwp` 5.0 바이너리 직접 파싱
- 한컴과 픽셀 단위로 동일한 렌더링
- 수식 편집기, 표 편집기, 이미지 삽입, AI 기능

기능 요청이 이 목록에 들어오면 v3(편집) 또는 v2(`.hwp`) 백로그로 보내고 v1 작업을
중단하지 않는다.

## 2026-07-20 코드 감사

현재 `npm run build`는 통과한다. 그러나 정확도를 검증하는 테스트와 HWPX fixture는
없으며, 성공적인 빌드는 문서 호환성을 의미하지 않는다.

| 영역 | 살릴 것 | 교체하거나 격리할 것 | 판정 근거 |
| --- | --- | --- | --- |
| Electron shell | `hiddenInset`, 파일 대화상자, preload 경계 | 저장 확인, 이미지 삽입, 새 문서/새 창 편집 흐름 | 뷰어 shell의 출발점으로 충분하지만 v1 IPC가 넓다 |
| ZIP/XML 읽기 | `unzipper`, `fast-xml-parser`, main process 파일 접근 | 모든 섹션·이미지 동시 buffer/base64 로딩 | 작은 문서에는 동작하지만 점진 로딩과 메모리 목표에 반한다 |
| 정규화 | 스타일을 ID map으로 만드는 방향 | `any`, 무작위/시간 기반 ID, 객체 키 순회로 문서 순서 추론 | 결정적 snapshot 테스트가 불가능하고 혼합 자식 순서를 잃는다 |
| 문서 모델 | parser와 UI 사이에 모델을 둔 방향 | 편집 가능한 `NormalizedDocument`, 원본 속성의 조기 손실 | layout에 필요한 단위·페이지·배치 정보가 없다 |
| renderer-engine | 스타일 해석기를 별도 파일로 둔 점 | 문자열 CSS 생성, 잘못된 HWPUNIT 변환, layout 단계 부재 | 현재 구현은 style adapter이며 renderer/layout engine은 아니다 |
| React UI | 문서 canvas의 기본 골격, drag/drop 일부 | `contentEditable`, ribbon, 수식/표/이미지 편집 UI | 대부분이 v1 외 기능이고 검증 표면을 키운다 |
| Zustand | 앱 상태 저장소라는 선택 | 문서 전체 history/deep copy와 mutation action | 뷰어에는 load/session/viewport 상태만 필요하다 |
| serialization | v3 참고 구현으로 보관 가능 | v1 런타임과 IPC에서 제거 | 미지원 XML을 유실할 수 있어 기존 파일 저장은 위험하다 |
| `.hwp` parser | 없음 | v1 빌드 경로에서 제외 | 직접 파싱 금지 가드레일과 충돌한다 |

### 즉시 수정해야 할 정확도 문제

1. `fast-xml-parser`의 일반 객체 출력에 의존해 `run` 안의 텍스트, 탭, 줄바꿈,
   그림 순서를 보존하지 못한다. `preserveOrder` 기반 event/AST 입력 계층이 필요하다.
2. HWPUNIT는 1 inch = 7,200이므로 1 unit은 약 0.0035278 mm다. 현재 `/ 100`
   변환은 약 2.83배 크게 렌더링한다.
3. 섹션 파일을 파일명 숫자 기준으로 정렬하지 않는다. `section10.xml`과
   `section2.xml` 순서가 ZIP entry 순서에 의존한다.
4. `Date.now()`와 `Math.random()`으로 모델 ID를 생성한다. 동일 입력의 결과가 매번
   달라져 snapshot, 캐시, 시각 회귀 비교가 불가능하다.
5. 이미지 경로를 `includes(ref)`로 찾는다. `image1`과 `image10`처럼 부분 일치하는
   이름에서 잘못 연결될 수 있다.
6. 표를 문단의 형제 노드처럼 처리하지만 OWPML의 실제 혼합 콘텐츠 위치를 보존하지
   않는다. 셀 주소, span, margin, border/fill, row 높이도 layout 모델에 충분히
   전달되지 않는다.
7. 글꼴 참조와 글자/문단 속성 타입이 실제 XML 구조보다 지나치게 단순하다. 누락
   속성을 기본값으로 조용히 바꾸기보다 `unsupported` 진단을 남겨야 한다.

## 첫 마일스톤: M1 기준 문서 한 장 정확히 열기

기준 파일 이름은 `tests/fixtures/private/m1-weekly.hwpx`로 고정한다. 사용자가 매주 실제로
받는 문서 중 개인정보가 없거나 마스킹한 한 파일을 여기에 둔다. 이 디렉터리는 Git에서
제외하고, 해시와 기대 결과만 추적한다. 공개 CI에는 라이선스가 명확한 별도 synthetic
fixture를 둔다.

기준 문서는 최소한 다음을 모두 포함해야 한다.

- 2페이지 이상, 서로 다른 문단 정렬/들여쓰기/줄 간격
- 한글·영문 혼합 글자 스타일(크기, 굵게, 색상 중 2개 이상)
- 병합 셀이 있는 표 1개
- PNG 또는 JPEG 이미지 1개
- 실제 업무에서 사용하는 함초롬 계열 글꼴 참조

M1 완료 조건:

- `mimetype`, `Contents/header.xml`, 모든 `sectionN.xml`을 검사하고 구조 오류를 사용자에게
  설명한다.
- 텍스트/탭/줄바꿈/표/이미지의 원문 순서가 golden model과 일치한다.
- 문단 및 글자 스타일, 표 병합, 이미지가 수동 reference PDF와 비교해 읽기 가능한
  위치와 크기로 렌더된다.
- 앱 warm start에서 파일 선택부터 첫 페이지 표시까지 p95 1초 이내다. 측정값은
  `open → manifest`, `manifest → first section parsed`, `layout`, `first paint`로 나눈다.
- PDF 내보내기 결과를 다시 렌더링해 페이지 수와 주요 block bounding box를 비교한다.

## 뷰어 중심 파이프라인

```text
FileSource
  -> PackageReader (manifest, metadata, ordered section handles, resource handles)
  -> Ordered OWPML Decoder (loss-aware parsed nodes + diagnostics)
  -> ViewerDocument (semantic blocks, resolved styles, resource references)
  -> Layout Engine (pages, lines, table grid, positioned images; HWPUNIT canonical)
  -> Paint Tree (page-local immutable draw operations)
  -> React page shell + HTML/SVG renderer
  -> Electron printToPDF
```

의존성은 한 방향이어야 한다. parser는 React/CSS를 모르고, layout은 ZIP/XML을 모르며,
renderer는 원본 OWPML을 해석하지 않는다.

### 단계별 계약

1. **PackageReader**는 ZIP entry를 전부 buffer로 만들지 않는다. header와 첫 section만
   우선 읽고, 나머지는 숫자 순서의 handle로 제공한다. 이미지도 필요할 때 byte URL로
   변환한다.
2. **Decoder**는 XML 자식 순서를 보존하고, source path와 element index로 안정적인 ID를
   만든다. 알 수 없는 요소는 버리지 않고 진단과 raw metadata로 남긴다.
3. **ViewerDocument**는 읽기 전용이다. 길이는 HWPUNIT 정수로 유지하고 경계에서만 CSS
   px/mm로 변환한다. 원본 style ID와 resolved style을 모두 가진다.
4. **Layout**은 먼저 문단/표/inline 이미지만 지원한다. page definition의 용지 크기와
   여백을 적용하고, 지원하지 않는 floating object는 명시적 fallback box로 표시한다.
5. **Paint Tree**는 페이지별 불변 구조다. 화면 renderer와 PDF가 같은 layout 결과를
   사용해 화면/PDF 차이를 줄인다.
6. **Store**는 `idle/opening/ready/error`, document session, viewport, zoom, page cache,
   diagnostics만 가진다. 문서 mutation과 history는 없다.

### 점진 로딩 순서

1. ZIP central directory + header + section 목록
2. 첫 section decode/layout/paint 후 즉시 표시
3. viewport 다음 1~2페이지 선행 layout
4. idle 시간에 나머지 section을 worker에서 decode
5. 보이는 페이지와 인접 페이지만 DOM에 유지

## 폰트 전략 결정

v1 초기에는 **함초롬체를 앱에 번들하지 않는다**. 알려진 라이선스 문구는 개인·기업의
사용과 저작물 이용은 허용하지만 상업적 목적의 배포/수정을 제한하므로, 유료 앱 가능성을
배제하지 않은 Han-Flow가 임의로 번들하는 것은 안전한 기본값이 아니다. 한컴의 명시적
번들 허가를 받기 전까지 다음 순서를 쓴다.

1. 문서가 요구한 정확한 PostScript/family 이름의 시스템 폰트
2. 명시적 alias map(예: 함초롬바탕/함초롬돋움의 이름 변형)
3. macOS 기본 한국어 serif/sans fallback
4. 이후 OFL 등 재배포가 명확한 한국어 폰트를 앱 fallback으로 번들하는 별도 결정

폰트가 대체되면 조용히 숨기지 않고 문서 진단에 `requested → resolved` 매핑을 표시한다.
PDF는 화면과 같은 resolved font를 사용해야 한다. 폰트 metric 차이로 줄바꿈이 달라지는
문서는 M1 시각 회귀에 반드시 포함한다.

## 마일스톤 순서

- **M0 기준선(현재)**: 코드 감사, v1 계약, fixture 규칙, 파이프라인/폰트 결정
- **M1 한 문서 정확도**: ordered decoder, 결정적 모델, 단위 변환, 문단/표/이미지 layout,
  golden + 시각 회귀
- **M2 빠른 열기**: Finder file association, single-instance/open-file 처리, worker 기반
  점진 파싱, page virtualization, p95 계측
- **M3 PDF**: 동일 layout 기반 `webContents.printToPDF`, 페이지 크기/여백/배경 검증
- **M4 macOS 마감**: dark chrome(문서 용지는 독립), pinch zoom, drag/drop, 오류/폰트 진단,
  패키징과 실제 주간 사용 검증

## M2 빠른 열기 진행 현황 (2026-07-20)

- [x] 개인정보 없는 synthetic HWPX 생성기와 항상 실행되는 공개 회귀 테스트
- [x] 앱 시작 전 macOS `open-file` 이벤트를 보관해 첫 창에 전달
- [x] 실행 중 `open-file`과 두 번째 프로세스의 HWPX 인자를 기존 창에 전달
- [x] single-instance lock과 기존 창 복원·포커스
- [x] 파일 선택 및 IPC 파싱 입력을 `.hwpx`로 제한
- [x] 비서명 `.app` 패키징과 `.hwpx` document type/UTI 등록
- [x] LaunchServices로 패키지 앱에 HWPX를 전달해 8페이지/overflow 0 렌더 검증
- [ ] Applications 설치 후 Finder 기본 앱 선택과 더블클릭 검증
- [ ] open → package index → decode → layout → first paint 구간 계측
- [ ] 첫 section 우선 decode와 뒤 section 점진 로딩
- [ ] viewport 주변 page virtualization

공개 fixture는 테스트 시 임시 디렉터리에 결정적인 ZIP으로 생성하며 section 정렬, 혼합
콘텐츠 순서, 글자·셀 스타일, PNG resource, `pageBreak=CELL` 표 분할과 반복 header를
private AIDA 문서 없이 검증한다. 실행 중 파일 열기는 개발 앱을 빈 화면으로 시작한 뒤
두 번째 Electron 프로세스에 private fixture 경로를 넘기는 방식으로 확인했고, 기존 창이
8페이지/overflow 0 문서로 전환됐다. 캡처와 fixture는 저장소에 포함하지 않는다.

`electron-builder`로 Apple Silicon용 `Han-Flow.app`을 생성한다. 앱 식별자는
`com.hanflow.viewer`이며 `Info.plist`에 `.hwpx`, 문서 역할 `Viewer`, MIME
`application/hwp+zip`, UTI `com.hanflow.hwpx`가 포함된다. 생성된 비서명 앱을 macOS
LaunchServices의 앱 지정 열기로 실행해 private AIDA 문서가 8페이지/overflow 0으로
표시되는 것을 확인했다.

현재 패키지는 로컬 개발 검증용이다. 기본 Electron 아이콘을 사용하고 서명·공증하지
않았으며 사용자의 기본 앱 설정도 자동으로 변경하지 않는다. 실제 배포 전에는 전용 아이콘,
Developer ID 서명, notarization을 준비하고 `/Applications` 설치 후 Finder의 “다음으로
열기” 및 더블클릭을 수동 검증한다. M2의 다음 구현 단위는 패키징 꾸미기가 아니라 1초
목표를 판단할 수 있는 로딩 구간 계측이다.

## 다음 구현 단위

M1은 아래 순서로만 진행한다.

1. private fixture와 reference PDF를 배치하고 SHA-256/기대 요소 수 manifest 작성
2. 순서 보존 PackageReader/Decoder 및 결정적 snapshot test
3. HWPUNIT 유틸리티와 style resolver test
4. viewer-only store와 read-only page component로 UI 교체
5. 표/이미지까지 한 페이지씩 시각 비교

fixture가 없는 상태에서 UI를 더 만드는 작업은 정확도를 증명하지 못하므로 진행하지 않는다.

## 구현 현황 (2026-07-20)

- [x] private AIDA 기준 문서와 8페이지 reference PDF 확보
- [x] HWPX mimetype/필수 entry 검증 및 section 숫자 정렬
- [x] XML 혼합 자식 순서를 보존하는 ordered AST
- [x] source 위치 기반 결정적 문단/표/셀 ID
- [x] HWPUNIT → mm/CSS px 변환과 A4 크기 테스트
- [x] 읽기 전용 `ViewerDocument` 기본 모델
- [x] 페이지 크기·여백, 한글 font table, 글자/문단 style 해석
- [x] 표 행/열, cell address, row/column span, 크기·여백, 셀 문단 해석
- [x] border/fill 상세 style 해석과 이미지 resource loading
- [x] 기존 편집 리본/contentEditable 제거 및 read-only A4 페이지 UI 연결
- [x] OWPML pageBreak 기반 초기 페이지 분리와 줌/드래그앤드롭
- [x] Electron 실앱 캡처와 reference PDF 첫 페이지 구조 비교
- [x] 병합 셀 기반 열 폭 복원, 세로 정렬, 이미지 CSP 보정
- [ ] 폰트 metric 기반 줄바꿈 및 페이지 하단 정밀 보정
- [x] 시스템 글꼴 조회와 결정적 `요청 → 대체` font resolution
- [x] 고정 A4 viewport의 실제 overflow 측정 및 상태 표시
- [x] section 경계·pageBreak·lineseg 높이 기반 block pagination
- [x] `pageBreak=CELL` 표의 행 높이 기반 페이지 분할

검증 참고: `npm test`와 `npm run build`는 통과한다. 저장소 전체 `tsc --noEmit`은 기존
편집 프로토타입의 미사용 import, `NormalizedDocument.binData` 누락, core 경로의
`tsconfig` include 누락 때문에 실패한다. viewer 전환 시 구 편집 경로를 격리하면서 별도
typecheck script를 품질 관문으로 추가한다.

현재 화면은 semantic model을 HWPUNIT 기반 HTML table/image로 직접 표시하는 초기 renderer다.
화면에 표시되지만 아직 paint tree나 줄 조판 엔진은 아니므로 reference PDF와의 시각
정합을 M1 완료로 간주하지 않는다. 다음 단계에서 첫 페이지 캡처와 PDF 기준 이미지를
비교해 줄 높이, 폰트 fallback, 셀 크기, 페이지 넘침을 보정한다.

### 첫 시각 검증 결과

Electron 자체 `capturePage`로 private fixture를 자동 로드한 실앱 화면을 캡처해 reference
PDF 1페이지와 비교했다. 검은 제목 표, 회색 header cell, 13×11 병합 표, 신청자/구성원
영역, 서명 PNG의 순서와 배치가 정상이다. 첫 행의 병합 셀만으로 HTML 열 폭을 정하던
문제는 전체 cell address/width를 모아 11개 열을 복원하고 표 너비로 정규화해 해결했다.
`data:` 이미지가 CSP에 차단되던 문제도 `img-src 'self' data:`로 제한 허용해 해결했다.

현재 차이는 일부 긴 소속명과 본문 줄바꿈이다. macOS에 원문 글꼴이 없을 때 fallback
font metric이 달라지는 것이 주원인이며, 픽셀 동일성을 추구하기보다 페이지 넘침 없이
읽기 좋은 상태를 우선한다. 다음 시각 회귀 단계에서는 page bounding box와 overflow를
수치화하고 font resolution diagnostic을 화면에 노출한다.

### 글꼴·페이지 진단 결과

시스템 글꼴 목록과 문서의 한글 font table을 비교해 정확한 family가 있으면 그대로 쓰고,
없으면 명조/바탕 계열은 `AppleMyungjo`, 고딕 계열은 `Apple SD Gothic Neo`를 우선한다.
상태 표시줄은 대체 font 수와 실제 A4 element의 `scrollHeight > clientHeight` 여부를
페이지 번호와 함께 표시한다.

AIDA 실앱 결과는 **8페이지 / 글꼴 대체 16 / overflow 0**이며 reference PDF의 페이지 수와
일치한다. section 경계와 명시적 pageBreak에 더해 `pageBreak=CELL` 표는 셀의 선언 높이와
내부 문단 `lineseg` 높이 중 큰 값을 행 높이로 사용한다. 남은 페이지 공간을 넘는 행 앞에서
표를 page fragment로 나누고, `repeatHeader=1`이며 header로 표시된 행은 다음 fragment에
반복한다. AIDA의 긴 설명 행 다음에는 작은 제목 행과 별도의 긴 본문 행이 이어지므로,
페이지를 충분히 채우는 큰 행 뒤의 자연스러운 제목 경계도 분할 후보로 사용했다.

Electron `capturePage`로 private fixture를 다시 열어 상태 표시줄의 8페이지와 overflow 0,
첫 페이지의 표·이미지 유지 여부를 확인했다. 캡처에는 개인정보가 포함되므로 fixture와
함께 저장소에 넣지 않는다. M1의 남은 정확도 과제는 원문 글꼴 부재에 따른 줄바꿈 차이를
허용 범위로 정의하고, 공개 synthetic fixture로 표 분할 회귀 테스트를 옮기는 것이다.

현재 AIDA fixture의 golden 기준은 section 3개, 최상위 문단 `[11, 1, 20]`, 전체 문단
303개, 표 15개, 그림 개체 4개, 이미지 resource 2개다. section은 페이지가 아니므로
8페이지 reference PDF와 직접 대응시키지 않는다.

## 참고 자료

- 한컴 공개 OWPML 모델: https://github.com/hancom-io/hwpx-owpml-model
- HWPX 포맷 개요: https://tech.hancom.com/hwpxformat/
- OWPML 표준 안내: https://www.hancom.com/etc/hwpDownload.do
