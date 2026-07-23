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

v1에서는 **함초롬체를 앱에 번들하지 않는다**. 한컴의 공식 안내는 함초롬체의 권리자가
한글과컴퓨터이며 한컴오피스 밖에서 사용할 때 권리 관계를 확인해야 한다고 명시하지만,
제3자 앱의 글꼴 파일 내장·재배포 허가는 확인되지 않았다. 다운로드 가능 여부를 재배포
권한으로 해석하지 않으며 명시적인 서면 허가 전까지 다음 순서를 쓴다.

1. 문서가 요구한 정확한 PostScript/family 이름의 시스템 폰트
2. 명시적 alias map(예: 함초롬바탕/함초롬돋움의 이름 변형)
3. macOS 기본 한국어 serif/sans fallback
4. 이후 OFL 등 재배포가 명확한 한국어 폰트를 앱 fallback으로 번들하는 별도 결정

폰트가 대체되면 조용히 숨기지 않고 문서 진단에 `requested → resolved` 매핑을 표시한다.
PDF는 화면과 같은 resolved font를 사용해야 한다. 폰트 metric 차이로 줄바꿈이 달라지는
문서는 M1 시각 회귀에 반드시 포함한다.

공식 근거, 별칭과 번들 실험 결과는 [글꼴 전략](font_strategy.md)에 기록한다.

## 마일스톤 순서

- **M0 기준선(현재)**: 코드 감사, v1 계약, fixture 규칙, 파이프라인/폰트 결정
- **M1 한 문서 정확도**: ordered decoder, 결정적 모델, 단위 변환, 문단/표/이미지 layout,
  golden + 시각 회귀
- **M2 빠른 열기**: Finder file association, single-instance/open-file 처리, worker 기반
  점진 파싱, page virtualization, p95 계측
- **M3 PDF**: 동일 layout 기반 `webContents.printToPDF`, 페이지 크기/여백/배경 검증
- **M4 macOS 마감**: dark chrome(문서 용지는 독립), pinch zoom, drag/drop, 오류/폰트 진단,
  패키징과 실제 주간 사용 검증

### 현재 마일스톤 요약 (2026-07-23)

- **M0 완료**: 코드 감사, viewer-only v1 계약, private/public fixture 규칙, 파이프라인과
  글꼴 라이선스 결정을 문서화했다.
- **M1 완료**: 기준 문서의 ordered decode, 스타일·표·이미지·머리말/꼬리말/쪽 번호,
  8페이지 read-only 렌더와 overflow 0을 검증했다. 픽셀 동일성이 아닌 읽기 가능성과 내용
  보존이라는 완료 조건을 충족하며, 대체 글꼴 metric과 단일 문단 내부 줄 분할은 정확도
  후속 과제로 남긴다.
- **M2 핵심 완료**: Finder 열기, single-instance, worker 점진 decode, page virtualization,
  warm/cold p95 계측을 완료했다. 실제 대형 업무 HWPX 표본 확보와 재측정만 남았다.
- **M3 핵심 완료**: 화면과 동일한 8페이지 A4 PDF, 배경·이미지·쪽 번호와 continuation
  pagination을 검증했다. 일반 저장 대화상자의 수동 클릭과 font metric 분배 차이는 남아 있다.
- **M4 로컬 실사용 완료**: dark mode chrome, pinch zoom, drag/drop, 진단, 아이콘, Finder
  기본 앱 경로를 검증했다. 외부 배포를 위한 Developer ID 서명과 notarization은 미완료다.

## M2 빠른 열기 진행 현황 (2026-07-20)

- [x] 개인정보 없는 synthetic HWPX 생성기와 항상 실행되는 공개 회귀 테스트
- [x] 앱 시작 전 macOS `open-file` 이벤트를 보관해 첫 창에 전달
- [x] 실행 중 `open-file`과 두 번째 프로세스의 HWPX 인자를 기존 창에 전달
- [x] single-instance lock과 기존 창 복원·포커스
- [x] 파일 선택 및 IPC 파싱 입력을 `.hwpx`로 제한
- [x] 비서명 `.app` 패키징과 `.hwpx` document type/UTI 등록
- [x] LaunchServices로 패키지 앱에 HWPX를 전달해 8페이지/overflow 0 렌더 검증
- [x] Applications 설치 후 Finder 기본 앱 선택과 더블클릭 경로 검증
- [x] package open → index → decode → layout → first paint 구간 계측
- [x] 20 sections 이상 문서의 첫 section 우선 decode와 전체 모델 백그라운드 교체
- [x] 50페이지 초과 문서의 viewport 주변 page virtualization
- [x] section 압축 전 크기 기반 대형 단일 section 판정
- [x] 점진 decode worker thread 이동과 load ID 단위 취소·오류 전달

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

현재 패키지는 로컬 개발 검증용이며 서명·공증하지 않았고 사용자의 기본 앱 설정도 자동으로
변경하지 않는다. 전용 아이콘과 `/Applications` 설치, Finder 일반 열기 경로는 검증했다.
실제 배포 전에는 Developer ID 서명과 notarization을 준비한다.

### M2 첫 화면 성능 기준선

상태 표시줄은 ZIP central directory 열기, 패키지 인덱스, 전체 ViewerDocument 디코딩,
main 합계, IPC 요청부터 모델 수신, block pagination, 첫 paint를 각각 표시한다. 첫 paint는
페이지 DOM이 만들어진 뒤 두 번의 `requestAnimationFrame`이 지난 시점이다. 실행 중 파일
열기는 macOS 이벤트 수신 시각을 함께 전달하고, 최초 파일 열기는 main 모듈 시작 시각을
기준으로 앱 부팅을 포함한 `열기 → 첫 화면`도 별도로 측정한다.

private AIDA 기준 문서의 개발 앱 warm-open 유효 표본 5회는 **116, 109, 256, 102,
102ms**였고 관측 p95(표본이 5개이므로 최댓값)는 **256ms**다. 최초 개발 앱 문서 요청은
397ms였다. 대표 warm-open의 main 합계는 37~38ms이며 이 중 전체 디코딩이 34~36ms,
패키지 인덱스는 약 1ms였다. 패키지 앱을 종료한 뒤 LaunchServices로 다시 연 콜드 실행은
**열기 → 첫 화면 304ms**, 8페이지/overflow 0이었다.

2026-07-21 production 패키지 자동 측정에서 같은 프로세스의 warm open 20회는
**p50 86ms / p95 126ms**(min 78ms, max 127ms), 매회 새 프로세스를 사용한 cold open 20회는
**p50 468ms / p95 491ms**(min 451ms, max 498ms)였다. 두 조건 모두 현재 AIDA 문서에서
1초 목표를 충족했다. `npm run benchmark:app -- <fixture.hwpx>`가 격리된 Electron user-data
경로로 single-instance 충돌을 피하고 결과 JSON을 수집한다. 첫 warm 표본은 앱 기동 영향을
제거하기 위해 버리고 이어지는 20회만 집계한다.

이 측정은 한 기기와 0.93MB·8페이지 문서에 대한 기준선이며 모든 문서의 1초 보장을 뜻하지
않는다. cold 수치는 main 모듈 시작부터 재므로 macOS가 프로세스를 시작하기 전의 Finder 및
LaunchServices 지연은 포함하지 않는다. 실제 대형 HWPX를 확보하면 같은 명령으로 다시
측정해야 한다.

### 대형 문서 점진 로딩 기준선

공개 생성기는 section 수, 추가 section당 문단 수, image resource 크기를 조절할 수 있다.
2026-07-21에 80 sections, 19,502문단, 5MiB PNG resource 구성을 각각 20회 디코딩했다.
첫 section은 **p50 5.8ms / p95 14.6ms**, 전체 문서는 **p50 225.1ms / p95 255.2ms**로
p50 기준 약 **38.8배** 차이가 났다. 압축 파일 크기는 반복 텍스트와 0-byte padding의 높은
압축률 때문에 약 95KB이므로 실제 복잡한 5MiB 문서와 같은 I/O 기준으로 해석하면 안 된다.
또한 같은 프로세스에서 반복한 디코더 회귀 측정이므로 앱 기동·IPC·조판·paint를 포함하지 않는다.

정확도가 이미 검증된 작은 문서의 경로를 바꾸지 않기 위해 section이 20개 이상이거나 section
하나의 압축 전 크기가 2MiB 이상일 때 점진 로딩한다. worker thread가 header, 첫 section,
resource를 먼저 반환하고 전체 문서도 별도 worker 작업으로 decode해 같은 load ID의 renderer에
전달한다. 새 파일을 열면 이전 worker를 종료하고 늦게 도착한 결과는 무시한다. background
오류가 나도 첫 section은 유지하고 상태 표시줄에 오류를 표시한다. 실제 Electron 빠른 캡처에서
**2페이지 · 불러오는 중 1/80 · 요청→첫 화면
148ms**를 확인했고 전체 모델도 이후 80/80으로 교체됐다.

전체 모델은 synthetic 문단 높이 기준 2,499페이지였지만 50페이지 초과 시 viewport 주변만
렌더해 실제 `.viewer-page` DOM은 **12개**로 제한됐다. 이 상태의 개발 앱 열기→첫 화면은
655ms였다. 가상화 문서의 overflow 진단은 현재 마운트된 페이지에 한정되므로 상태 표시줄도
`보이는 페이지 넘침`으로 구분한다. worker 적용 후 80-section fixture는 실제 DOM 12개,
열기→첫 화면 641ms였다. 2 sections이지만 첫 section이 2,271,162 bytes인 fixture도 점진
경로로 판정됐고 최종 1,503페이지 중 DOM 12개, 실행 중 열기 357ms였다.
동일한 80-section fixture를 패키지 앱의 `app.asar` 환경에서도 열어 worker 번들 로딩,
2,499페이지 모델 교체, DOM 12개 제한을 확인했으며 열기→첫 화면은 284ms였다.

## 다음 구현 단위

M2 핵심 구현과 AIDA 앱 전체 warm/cold 20회 통계 검증은 완료했다. 공개 synthetic 디코더의
20회 p50/p95 측정 장치도 마련했다. 남은 것은 실제 대형 문서를 사용한 동일 검증이다.

1. 실제 대형 HWPX를 확보해 warm/cold 각 20회 이상 측정하고 1초 목표의 p50/p95 기록
2. 실제 사용에서 1초를 넘는 문서가 발견되면 참조 resource 우선 로딩 검토

현재 AIDA는 이미 목표 안쪽이므로 작은 문서의 숫자만 더 줄이는 최적화보다, 대형 문서에서도
첫 페이지를 먼저 보여 주고 메모리 사용량을 제한하는 구조를 우선한다.

## M3 PDF 내보내기 진행 현황 (2026-07-21)

- [x] toolbar PDF 버튼과 macOS 저장 대화상자
- [x] renderer 준비/완료 IPC와 폰트·이미지·paint 대기
- [x] 출력 중 page virtualization 해제와 완료 후 복원
- [x] print media에서 toolbar/status/shadow/gap 제거
- [x] HWPUNIT 용지 크기를 Electron custom page size의 inch 단위로 변환
- [x] 배경색 포함, 추가 margin 없는 `webContents.printToPDF`
- [x] private AIDA 출력 PDF 8페이지/A4 검증
- [x] `pageNum` 위치·숫자 형식·양옆 문자와 첫 쪽 숨김 해석
- [x] 일반 header/footer 본문과 구역별 쪽 번호 재시작 해석
- [ ] font metric 차이로 인한 페이지별 콘텐츠 분배 보정
- [x] production 패키지에서 파일 열기·연속 열기·PDF 생성 E2E 검증
- [ ] 패키지 앱에서 사용자 저장 대화상자 수동 클릭 검증

private AIDA를 실제 Electron renderer에서 출력한 결과는 **8페이지, 595.92 × 841.92pt
(A4), PDF 1.4**다. reference PDF도 8페이지 A4다. 출력 PDF의 1·2·8페이지를 Poppler로
다시 PNG 렌더링해 검은 제목 셀, 회색 cell fill, 표 테두리, 한글·영문 텍스트, 서명 PNG가
선명하게 유지되고 내용이 용지 밖으로 잘리지 않는 것을 확인했다. fixture, 출력 PDF, PNG는
개인정보 때문에 저장소에 포함하지 않는다.

reference와 픽셀 단위로 같지는 않다. 대체 폰트 metric 때문에 2페이지 이후 block 분배가
다르다. v1의 읽기 가능하고 깨지지 않는 PDF 기준은 충족하지만 이 차이는 known limitation으로
유지한다.

2026-07-22 페이지별 비공백 글자 수를 비교한 결과 reference는
`[867, 1650, 264, 1238, 174, 1138, 322, 424]`, Han-Flow는
`[866, 756, 1158, 1238, 174, 1138, 322, 424]`였다. 차이는 2·3페이지에 집중되며,
reference는 단일 표 셀 안의 15개 문단을 두 페이지에 나누지만 현재 renderer는 행 경계에서만
표를 나눌 수 있어 셀 전체를 다음 페이지로 보낸다. 단순 `layoutTop` 휴리스틱이나 행 복제는
뒤쪽 표를 9페이지로 밀어 회귀하므로 채택하지 않았다. 다음 보정은 셀 테두리와 rowSpan을
유지하는 문단 단위 table-cell fragment 모델로 설계한다.

2026-07-23 continuation pagination 연결 후 화면과 PDF의 페이지별 비공백 글자 수는 모두
`[867, 772, 1142, 1238, 174, 1138, 322, 424]`였다. 이전 결과보다 16자가 3페이지에서
2페이지로 이동했고 첫 페이지도 reference와 같아졌다. 2·3페이지 합계 1,914자는 reference와
동일하므로 누락·중복은 없다. Poppler로 다시 렌더링한 2·3페이지에서도 테두리 연결, 본문,
뒤쪽 표가 잘리지 않았다.

2페이지에 남은 큰 빈 공간은 continuation 실패가 아니다. 다음 원본 조각이 여러 줄을 가진
하나의 긴 문단이라 현재의 문단 원자성 규칙으로는 일부 줄만 잘라 넣을 수 없다. reference와
같은 1,650/264 분배를 얻으려면 line box 측정과 단일 문단 내부 줄 분할이 필요하다. 이는
문단 순서·스타일 보존과 중복 방지 계약을 새로 설계해야 하므로 v1 known limitation으로 두고,
편집 기능과는 별개의 향후 정확도 작업으로 분리한다.

별개로 문단 모양이 `hp:switch > hp:case/default` 안에 들어간 문서에서 margin과 PERCENT
lineSpacing이 0으로 사라지던 파서 누락을 수정했다. 지원되는 `hp:case`를 우선하고 direct 속성,
`hp:default` 순으로 해석하며 공개 synthetic fixture로 130% 줄 간격과 네 방향 margin을 고정했다.

셀 fragment 구현의 선행 작업으로 측정 표시를 표 셀 내부 문단까지 전파했다. 숨겨진 측정 표는
실제 colgroup을 사용하므로 각 문단 높이가 셀 너비 기준으로 수집된다. production AIDA는 이
변경 후에도 **8페이지 / 이미지 4개 / overflow 0**을 유지했다. 앱 전체 20회 재측정은 warm
**p50 108ms / p95 129ms**, cold **p50 606ms / p95 725ms**로 1초 p95 목표 안쪽이다.

다음 단계의 위험을 격리하기 위해 셀 문단 분할 계산을 `cell_fragment` 순수 함수로 먼저
추가했다. 문단 순서·참조의 완전 보존, 첫 문단 미수용, 전체 수용, 측정값 fallback, 단일
overflow cell 선택, rowSpan fallback, 단일 초대형 문단을 공개 테스트로 고정했다. 이 선행
단계에서는 실제 pagination과 renderer fragment에 연결하지 않아 페이지 분배를 바꾸지 않았다.

fragment renderer 선행 작업으로 각 원본 셀에 `sourceCellId`를 부여하고 continuation 전용
`splitTop/splitBottom` flag를 추가했다. flag가 있는 조각은 잘린 경계의 border·padding과 원본
min-height를 제거하고 top 정렬한다. renderer 마크업 테스트와 production AIDA에서
**8페이지 / 이미지 4개 / overflow 0**을 유지했으며 이 단계까지는 실제 문서에 flag를 생성하지
않았다.

Claude의 두 번째 설계 리뷰에서 pagination 통합 전 필수 조건으로 지적된 부분 행 높이와
`rowSpan` 안전장치를 반영했다. 부분 행은 `fragmentHeight`가 원본 행 DOM 실측값보다 우선하고,
`rowSpan > 1`인 셀이 하나라도 있는 표는 셀 분할 대상에서 제외한다. exact-fit,
bottom-padding-only overflow, 0 overflow, 일부 측정값 누락, `columnSpan`, 문단 누락·중복,
head/tail 경계와 네 가지 fragment key를 공개 테스트로 고정했다. 테두리 두께는 아직 수용량
계산 밖에 있으므로 실제 pagination 연결 단계에서 overflow 0을 다시 확인한다. 이 변경도
continuation 행을 생성하기 전의 안전장치 단계라 페이지 분배에는 영향을 주지 않았다.

이후 measured pagination에 continuation 행 생성을 연결했다. 개인정보 없는 전용 HWPX는 반복
header, 15개 문단의 단일 장문 셀, 뒤쪽 앵커 표로 구성한다. 합성 측정값과 패키지 앱의 실제 DOM
측정에서 모두 문단이 **8개 + 7개**로 나뉘고, 문단 ID 누락·중복 없이 두 페이지에 보존됐다.
두 페이지 모두 header가 반복되고 앵커 표는 두 번째 페이지에 남았으며 **2페이지 / overflow 0**을
확인했다. 같은 입력의 무측정 pass는 continuation flag 없이 기존 행 단위 3페이지를 유지한다.

production AIDA도 새 패키지에서 다시 열어 **8페이지 / 이미지 4개 / overflow 0**을 유지했다.
`rowSpan > 1`인 셀이 하나라도 있는 표, 복수 overflow 셀, 단일 초대형 문단은 계속 행 단위
pagination 또는 overflow 진단으로 fallback한다. 테두리 두께는 수용량 예산에 직접 포함하지
않지만 공개 fixture와 production 문서 양쪽의 실제 렌더 overflow 0으로 이번 통합을 검증했다.

Release Candidate 반복 검증을 위해 `npm run verify:app -- <fixture.hwpx>`를 추가했다.
검증기는 격리된 user-data로 production `.app`을 열고 전체/마운트 페이지 수, background
loading 완료, 이미지 decode, overflow와 페이지별 비공백 글자 수를 안전한 JSON으로 수집한
뒤 자동 종료한다. private AIDA 결과는 **pass / 8페이지 / 이미지 4개 / overflow 0**이며
글자 수는 화면·PDF 기준과 같은 `[867, 772, 1142, 1238, 174, 1138, 322, 424]`다.

실제 대형 HWPX 확보를 기다리지 않고 구조 회귀를 검사하기 위해 `verify:matrix`도 추가했다.
production 패키지 결과는 기본 fixture **3페이지 / mount 3 / 이미지 4 / overflow 0**,
cell continuation fixture **2페이지 / mount 2 / overflow 0**, 80-section progressive
fixture **9,767페이지 / mount 12 / overflow 0**이며 전체 matrix가 통과했다. 모든 입력과
격리 user-data는 종료 후 삭제된다.

대형 synthetic은 약 1만 9천 문단과 5MiB resource 조건으로 worker 교체와 virtualization을
강하게 검증하지만 반복 텍스트와 합성 resource의 압축률이 높다. 실제 업무 문서의 복잡한
이미지·폰트·표 구조와 디스크 I/O를 대체하지 않으므로, 실문서가 생기면 `verify:app` 결과를
별도 기준선으로 추가한다.

v1 RC 호환성 matrix를 이미지 12개와 `rowSpan=2` 표, 필수 header가 없는 손상 package까지
확장했다. production 결과는 이미지·병합 표 fixture **1페이지 / 이미지 12개 / overflow 0**,
손상 package는 **crash 0 / 비어 있지 않은 사용자 오류 표시**이며 5종 matrix 전체가 통과했다.

`verify:pdf`는 private AIDA를 production 앱에서 출력하고 Poppler로 다시 검사한다. 결과는
**화면 8페이지 = PDF 8페이지 / 595.92 × 841.92pt A4 / PDF 1.4 / 1,542,671 bytes**이며
페이지별 글자 수 `[867, 772, 1142, 1238, 174, 1138, 322, 424]`가 화면과 PDF에서
완전히 같았다. 1·4·8페이지 PNG를 직접 확인해 제목 셀, 긴 본문, 표, 이미지·서명, 쪽 번호와
마지막 동의서에 잘림·겹침이 없음을 확인했다.

프로젝트 버전은 `1.0.0-rc.1`로 올렸다. `release:check`는 전체 테스트, production 패키징,
공개 5종 matrix, private 앱 smoke test, private 화면/PDF 일치 검증을 하나의 실패 즉시 중단
관문으로 묶는다.

첫 통합 관문은 대형 progressive 문서가 full model로 교체된 직후 DOM 재측정 전 상태를
고정 타이머가 읽어 2,499페이지와 일시 overflow를 보고하면서 실패했다. renderer가
`documentLoading=false`와 measured layout 완료를 명시하고, page signature가 연속 3회
안정된 뒤에만 E2E 상태를 기록하도록 수정했다. 이후 대형 문서는 다시
**9,767페이지 / mount 12 / overflow 0**으로 확정됐다.

최종 `release:check`는 **41 tests / production package / 공개 5종 matrix / private AIDA
app / private AIDA PDF** 전 단계를 통과했다. 생성된 앱의 `CFBundleShortVersionString`과
`CFBundleVersion`도 모두 `1.0.0-rc.1`이다.

## M4 macOS 마감 진행 현황 (2026-07-21)

- [x] 시스템 dark mode에 맞춘 chrome과 독립된 흰색 문서 용지
- [x] HWPX drag-and-drop과 확장자 오류 안내
- [x] 트랙패드 pinch-to-zoom
- [x] `⌘+`, `⌘-`, `⌘0` 확대 단축키
- [x] 50–200% zoom 범위와 확대 기준점의 세로 스크롤 보존
- [x] 글꼴 대체·페이지 overflow·열기 시간 상태 진단
- [x] 전용 앱 아이콘과 ICNS 패키지 적용
- [x] `/Applications` 설치 후 Finder 기본 앱·더블클릭 검증
- [ ] Developer ID 서명과 notarization

트랙패드 pinch가 보내는 `ctrlKey + wheel delta`를 연속 zoom 값으로 변환하고, 버튼과 키보드는
10% 단계를 사용한다. 확대 직전 포인터 또는 viewport 중앙이 가리키던 문서 세로 좌표를 계산해
다음 frame의 `scrollTop`을 보정하므로 긴 문서에서 확대할 때 읽던 위치가 크게 튀지 않는다.
zoom 계산은 renderer 밖의 순수 함수로 분리해 최소·최대 범위와 방향을 공개 테스트로 고정했다.
핀치 줌 포함 production 패키지에서 private AIDA는 **8페이지 / 이미지 4개 / overflow 0 /
첫 화면 631ms**를 유지했다. 자동화 환경은 물리 트랙패드 gesture를 생성하지 못하므로 실제
손가락 감도와 관성은 패키지 앱 수동 확인 항목으로 남긴다.

전용 아이콘은 Han-Flow의 파란색 `#335eea` 계열 rounded tile, 흰 문서, 흐르는 선을 사용하며
글자 없이 작은 Dock 크기에서도 형태가 남도록 구성했다. 1024px 투명 PNG에서 ICNS를 생성해
`electron-builder`의 mac icon으로 연결했다. production `.app`의 `CFBundleIconFile`은
`icon.icns`이며 패키지 내부 파일의 SHA-256이 source ICNS와 일치한다. 생성 중간 자산은 제외하고
`build/icon.png`와 `build/icon.icns`만 저장소에서 추적한다. 아이콘 적용 production 앱도
**8페이지 / 이미지 4개 / overflow 0 / 첫 화면 635ms**로 기존 렌더 기준을 유지했다.

### Finder 기본 앱 실사용 검증

`/Applications/Han-Flow.app`에 production 패키지를 설치하고 LaunchServices에 등록했다.
이 Mac에서 `.hwpx`의 실제 content type은 과거 한컴 앱이 등록한
`com.haansoft.hancomofficeviewer.mac.hwpx`였으므로, Han-Flow 자체 `com.hanflow.hwpx`와 함께
단일 `CFBundleDocumentTypes`의 `LSItemContentTypes`에 선언했다. 개발용 `release` 복사본은
LaunchServices에서 등록 해제해 설치본과 같은 bundle ID가 중복 선택되지 않게 했다.

Finder 일반 열기는 기존 앱의 Editor 역할을 우선할 수 있어 Viewer와 Editor 기본 handler를
모두 `com.hanflow.viewer`로 지정했다. 이후 앱 이름을 지정하지 않은 일반 `open`이
`/Applications/Han-Flow.app/Contents/MacOS/Han-Flow`를 실행하는 것을 프로세스 경로로 확인했다.
이 역할 값은 파일 편집 기능을 활성화하지 않으며 Han-Flow의 UI와 문서 모델은 계속 읽기 전용이다.

AIDA의 첫 section에 있는 `pageNum(BOTTOM_CENTER, DIGIT, sideChar="-")`과 `startNum`,
`visibility`를 문서 모델로 옮기고 본문 조판에 영향을 주지 않는 page decoration으로 렌더한다.
재출력한 PDF의 1·2·8페이지에서 각각 `- 1 -`, `- 2 -`, `- 8 -`이 하단 중앙에 표시되고
잘리지 않는 것을 확인했다. AIDA에는 별도 header/footer 본문 정의가 없으므로 이번 검증 범위는
자동 쪽 번호까지다. 구역마다 번호 형식이나 시작 번호가 바뀌는 문서는 아래 공개 fixture로
별도 검증했다.

후속 공개 synthetic fixture는 첫 구역의 `BOTH` 머리말·꼬리말을 1·2쪽에 적용하고, 두 번째
구역에서 머리말을 교체하면서 쪽 번호를 5로 재시작한다. 새 꼬리말 정의가 없으면 앞 구역의
정의를 이어받는다. 페이지 결과 `[1, 2, 5]`, 머리말 교체, 꼬리말 상속을 회귀 테스트로
고정했다. 머리말·꼬리말 내부는 일반 문단 디코더를 재사용하므로 텍스트뿐 아니라 표와 이미지도
같은 read-only renderer 경로를 사용한다. `BOTH/EVEN/ODD` 적용 타입을 지원한다.

첫 시도에서 custom page size를 microns로 넘겨 비정상적으로 큰 용지가 생성됐으며, Electron
28의 `printToPDF` 계약에 맞게 inch로 수정했다. HWPUNIT→inch 단위 테스트를 추가해 A4가
약 8.27 × 11.69 inch로 변환되는지 회귀 검증한다.

## production 패키지·글꼴 기준선 (2026-07-21)

`release/mac-arm64/Han-Flow.app`을 개발 서버 없이 실행해 private AIDA를 열었다. 첫 실행은
588~615ms, 실행 중인 single-instance에 같은 문서를 다시 전달했을 때는 102ms였다. 두 경우
모두 8페이지, 이미지 4개 decode 완료, font substitution 16개, overflow 0이다. production
bundle의 PDF 자동 출력도 8페이지 A4로 완료됐다. 테스트 자동화는 일반 실행에서 비활성화되고
`HAN_FLOW_E2E=1`일 때만 capture/output 환경 변수를 허용한다.

reference PDF와 production PDF의 페이지별 텍스트 위치를 비교했다. 일반 본문 글꼴 중앙값은
9.33pt 대비 9.0pt, 큰 제목은 13.33pt 대비 13.0pt와 15.33pt 대비 15.0pt로 약 0.33pt 작다.
reference 249행 대비 출력 224행이며, 가장 큰 차이는 2·3페이지다. reference가 2페이지에
연속 배치한 창업팀 설명을 현재 block pagination은 3페이지로 넘겨 페이지별 텍스트 유사도가
각각 0.598, 0.318이지만 두 페이지 합계 글자 수는 동일하다. 4·5·7페이지는 1.0, 8페이지는
0.998로 텍스트 순서가 일치한다.

측정 중 6페이지의 넓은 비즈니스 모델 표가 오른쪽에서 잘리는 문제를 발견했다. table을 본문
폭 이하로 제한하고 overflow 진단에 `scrollWidth`를 추가했다. 수정 후 누락 차이는 한글·영문
0자였다.

OWPML `bullets`, `numberings/paraHead`, `paraPr/heading`을 연결해 문자 bullet과 DIGIT 번호
pattern을 문단 marker로 렌더한다. AIDA의 목록 하이픈 37개와 번호·마침표가 복원되어 reference
6,077자 대비 production PDF 6,076자다. 남은 1자는 화면에 보이지 않는 한글 채움 문자 `ㅤ`
뿐이며 표시 본문 유실은 0으로 본다. 공개 fixture는 `-`, `1.`, `2.` marker를 회귀 검증한다.

2·3페이지는 `lineseg vertpos` 되감기를 원본 페이지 경계로 적용하는 실험도 했다. 페이지 수는
8로 유지되고 기준 PDF 대비 2·3페이지 텍스트 유사도는 0.598/0.318에서 0.876/0.735로
높아졌지만, Apple 대체 글꼴의 폭 때문에 2페이지 DOM이 넘쳐 하단 본문이 PDF에서 잘렸다.
첫 화면은 652ms였다. 내용 보존을 우선하는 v1 안전 기준을 위반하므로 변경은 채택하지 않았다.
다음 정확도 과제는 원본 경계를 강제하기 전에 font metric과 실제 DOM block 높이를 layout
입력으로 되돌리는 것이다.

후속 구현에서 화면 밖 측정 레이어로 원본 block과 표 행의 실제 CSS 높이를 수집하고
CSS px를 HWPUNIT으로 환산해 두 번째 pagination에 전달했다. 실측값이 있으면 경험적 제목
경계 대신 실제 행 합계와 남은 페이지 용량을 비교하며, 표가 이미 다음 페이지로 분할된 경우
뒤 block의 `vertpos` 되감기를 중복 적용하지 않는다. AppleMyungjo 환경의 AIDA는 안전한 기존
분할을 선택해 **8페이지 / overflow 0 / 첫 화면 705ms / PDF 생성 완료**를 유지했다.

함초롬체처럼 metric이 더 가까운 시스템 글꼴이 설치되어 전체 행이 실제 남은 공간에 들어가면,
같은 코드가 표를 유지하고 다음 block의 원본 좌표 경계를 선택한다. 공개 단위 테스트는 이
조건 전환과 CSS px↔HWPUNIT 변환을 고정한다. 측정용 숨은 DOM은 production 이미지 진단에서
제외해 실제 페이지의 이미지 4개만 집계한다.

저장 대화상자 자체의 마우스 클릭은 현재 자동화 프로세스에 macOS 보조 접근 권한이 없어 수동 확인
항목으로 유지한다.

OFL-1.1 Noto Serif KR의 한국어 Regular/Bold WOFF2 약 2MB를 바탕·명조 fallback으로 넣는
production 실험도 수행했다. 8페이지, overflow 0, 첫 화면 623ms와 PDF 텍스트 6,075자는
유지했지만 기준 PDF 대비 2·3페이지 텍스트 유사도가 기존 0.598/0.318에서 0.555/0.210으로
낮아졌다. 본문 block 분배도 개선되지 않아 번들을 채택하지 않았으며 코드·의존성을 제거했다.
다음 정확도 작업은 글꼴 추가가 아니라 `lineseg`와 실제 block 높이를 결합한 pagination 보정이다.

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
- [x] 함초롬체 영문 family 별칭 해석과 번들 라이선스 게이트 결정
- [x] 고정 A4 viewport의 실제 overflow 측정 및 상태 표시
- [x] section 경계·pageBreak·lineseg 높이 기반 block pagination
- [x] `pageBreak=CELL` 표의 행 높이 기반 페이지 분할
- [x] measured pass의 표 셀 문단 continuation과 반복 header·뒤쪽 표 비회귀
- [ ] 단일 장문 문단의 line box 기반 페이지 내부 분할

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
- electron-builder macOS file association: https://www.electron.build/docs/api/electron-builder.interface.fileassociation/
- 한컴 줄 간격 도움말: https://help.hancom.com/hoffice/multi/ko_kr/hwp/format/paragraph/paragraph%28line_spacing%29.htm
