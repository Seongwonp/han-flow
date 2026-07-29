# HWP/HWPX 오픈소스 참고 프로젝트 검토

상태: 1차 검토 완료 — 의존성 추가와 코드 이식 없음

기준일: 2026-07-29

## 1. 검토 목적

Han-Flow의 현재 구현과 다음 V3-5 글자·문단 모양 편집, V4 macOS 배포에 참고할 공개
프로젝트 세 개를 실제 소스 기준으로 비교했다.

- [`chrisryugj/kordoc`](https://github.com/chrisryugj/kordoc)
- [`postmelee/alhangeul-macos`](https://github.com/postmelee/alhangeul-macos)
- [`treesoop/hwp-mcp`](https://github.com/treesoop/hwp-mcp)

README의 기능 주장만 비교하지 않고 라이선스, 고정 commit의 구현 파일, package 의존성과
최근 변경 상태를 함께 확인했다. 이번 검토로 production dependency를 추가하거나 코드를
복사하지 않았다. 채택이 필요하면 별도 spike, 라이선스 고지와 회귀 검증을 거친다.

## 2. 요약 판단

| 프로젝트 | 확인 기준 | Han-Flow에 가장 유용한 영역 | 판정 |
| --- | --- | --- | --- |
| Kordoc | `e4878dd`, 4.2.9, MIT | HWPX source map·splice patch, reflow, 재파싱 검증과 방대한 회귀 사례 | 개발 oracle과 실패 사례 참고 유지 |
| Alhangeul | `1e7f5df`, 공개 v0.1.9, MIT | macOS 파일 UX, Quick Look·thumbnail, 서명·공증·업데이트 운영, rhwp 0.8.2 통합 | V4 제품·배포 참고, rhwp upgrade 후보 |
| hwp-mcp | `4a93489`, 0.3.0, MIT | rhwp traversal, HWPX ZIP 부분 변경과 style 추가의 작은 비교 구현 | differential fixture와 반례 참고 |

세 프로젝트 모두 MIT이지만 라이선스가 허용한다는 사실만으로 코드 이식이 필요한 것은
아니다. Han-Flow는 Apache-2.0을 유지하고, 실제 코드를 포함할 때만 저작권 고지와 MIT
원문 포함 여부를 다시 판단한다.

## 3. Kordoc

### 3.1 확인한 구현

Kordoc은 HWP 3.x/5.x와 HWPX를 포함한 여러 형식의 추출·생성·patch·SVG 렌더를 한
TypeScript package에 제공한다. Han-Flow는 이미 4.2.7을 development-only semantic
oracle로 고정했고 production bundle에는 포함하지 않는다.

현재 main 4.2.9의 HWPX round-trip 경로는 DOM 전체 재직렬화 대신 section XML을
tokenize해 `hp:t`의 byte offset 범위를 만든다. 변경은 offset splice로 적용하고, text가
바뀐 section의 오래된 `linesegarray`를 제거한 뒤 결과를 다시 parse해 검증한다. 중첩 표,
머리말·꼬리말, 캡션처럼 같은 `hp:t`라도 소유권이 다른 영역을 barrier로 분류하는 점도
중요하다.

### 3.2 Han-Flow에 반영할 원칙

- 현재 source anchor와 원본 entry 보존 방식을 유지한다.
- V3-5 style command도 전체 header/section DOM 재생성보다 대상 definition과 reference의
  제한된 변경을 우선한다.
- section text나 style reference가 바뀌면 한컴 조판 cache가 stale해질 수 있으므로
  `linesegarray` 처리 정책을 명시하고 round-trip fixture로 검증한다.
- 새 style ID는 문서 전체 숫자 ID와 header의 기존 definition을 조사해 결정적으로 할당한다.
- 저장 성공 판정은 package 생성이 아니라 재파싱, reference 무결성과 visual/PDF 관문까지다.

### 3.3 그대로 채택하지 않는 부분

- Markdown을 편집 원본으로 삼는 block alignment 방식은 interactive selection을 가진
  Han-Flow의 문서 모델로 사용하지 않는다.
- 현재 4.2.7에서 4.2.9로 올리는 일은 V3 style 구현과 섞지 않는다. development oracle
  upgrade는 lockfile, probe 결과와 audit 변화가 보이는 별도 commit으로 다룬다.
- Kordoc의 생성·OCR·PDF optional dependency를 production 앱에 포함하지 않는다.

## 4. Alhangeul for macOS

### 4.1 확인한 구현

Alhangeul은 SwiftUI/AppKit shell, Rust C ABI bridge와 `rhwp` renderer를 결합한 macOS
HWP/HWPX 앱이다. 현재 공개 line은 WKWebView viewer/editor를 유지하면서 Quick Look,
Finder thumbnail, PDF·인쇄·공유, 최근 문서 bookmark, signed/notarized universal DMG와
Sparkle update를 제공한다.

렌더 surface가 하나가 아니라 HostApp WebView, Quick Look/thumbnail의 native render,
PDF와 print 경로로 나뉜다는 사실과 각 경로를 별도 smoke gate로 관리하는 방식이 특히
유용하다. HWP/HWPX signature 사전 검사, 큰 파일 fallback, security-scoped bookmark,
dirty close 조정과 extension 충돌 진단도 macOS 제품 운영의 실제 문제를 보여준다.

저장소의 Rust bridge는 `rhwp` v0.8.2를 고정한다. Han-Flow의 0.7.19보다 새 버전이므로
renderer 정합 개선을 얻을 가능성이 있지만, 0.x API와 페이지 출력 변화가 있어 즉시
upgrade하지 않는다.

### 4.2 Han-Flow에 반영할 원칙

- V4에서 Finder double-click뿐 아니라 Quick Look·thumbnail의 필요성과 구현 비용을
  별도 milestone로 판단한다.
- 서명, notarization, universal artifact, update feed와 extension 등록을 서로 다른
  release gate로 둔다.
- 화면과 PDF가 같은 renderer를 쓰지 않는 경우 page count와 시각 차이를 각각 기록한다.
- `@rhwp/core` 0.8.x upgrade는 HWP 공개 matrix와 private 실사용 문서의 page size,
  text preservation, overflow, memory를 0.7.19와 나란히 비교한 뒤 결정한다.
- 최근 문서와 sandbox를 도입할 때 macOS bookmark와 권한 만료 UX를 검토한다.

### 4.3 그대로 가져오지 않는 부분

- Swift/AppKit source는 Electron shell에 직접 이식하지 않고 UX·release checklist의
  근거로만 사용한다.
- 저장소의 `samples/` 문서는 출처와 재배포 권한이 파일별로 분명하지 않으면 Han-Flow
  fixture로 복사하지 않는다. 개인정보와 제3자 문서 권리도 별도로 점검한다.
- Quick Look과 thumbnail은 V3 편집 완료를 지연시키지 않으며 V4 범위로 유지한다.

## 5. hwp-mcp

### 5.1 확인한 구현

hwp-mcp는 `@rhwp/core` 0.7.x 위에 문서 traversal과 MCP tool을 얹고, HWPX 쓰기는
JSZip으로 `Contents/section*.xml`과 `header.xml`을 직접 바꾸는 adapter다. `mimetype`을
STORE 방식으로 유지하고 변경 package를 다시 만드는 경계는 Han-Flow의 package 보존
전략과 비교하기 좋다.

글자·문단 모양 구현은 첫 `charPr` 또는 `paraPr`를 복제하고 최대 ID에 1을 더한 definition을
header에 붙인 뒤 target run이나 paragraph의 reference를 바꾼다. 작고 이해하기 쉬운
실험이지만 production editor에서 그대로 사용하기에는 다음 제한이 있다.

- structured edit가 첫 section만 고르는 경로가 있다.
- target text가 여러 `hp:t`나 run에 걸치면 찾지 못한다.
- 정규식이 XML 구조와 namespace variant를 충분히 모델링하지 않는다.
- 일부 object ID는 난수로 만들며 문서 전체 충돌을 증명하지 않는다.
- 첫 style definition을 base로 복제해 선택한 run의 실제 style 상속을 보존하지 못할 수 있다.
- run 전체 reference를 바꾸므로 선택 범위 일부에만 style을 적용하지 못한다.

### 5.2 Han-Flow에 반영할 원칙

- hwp-mcp의 공개 fixture와 expected behavior를 dependency 없이 differential test 후보로
  사용한다.
- 첫 style slice는 임의 문자열 검색이 아니라 Han-Flow의 section path, paragraph와
  text-node source anchor로 대상을 지정한다.
- 선택 일부에 style을 적용할 때는 text/run split 결과, 양쪽 원본 style 보존과 inverse
  command를 함께 검증한다.
- ID allocation, header list count, reference 존재와 package 재열기를 하나의 transaction
  관문으로 묶는다.

## 6. V3-5에 적용할 구현 순서

이번 조사 결과 다음 순서를 V3-5 첫 vertical slice로 사용한다.

1. `ApplyCharacterStyleCommand`와 `ApplyParagraphStyleCommand`의 source-anchor 계약을
   정의한다.
2. 선택한 원본 `charPr`·`paraPr`를 기준으로 unknown attribute와 child를 보존한 clone을
   만들고 요청한 속성만 바꾼다.
3. 기존 style과 같은 signature면 재사용하고, 새 definition이 필요하면 문서 전체에서
   충돌하지 않는 결정적 ID를 할당한다.
4. header definition list와 count, section reference를 한 transaction으로 갱신한다.
5. undo/redo가 style definition과 reference를 모두 원복하고 savepoint·dirty가 기존
   text command와 같은 의미를 유지하는지 검사한다.
6. 공개 synthetic style fixture에서 untouched entry hash, XML parse, style reference,
   Han-Flow 재열기, rhwp 렌더와 PDF를 검증한다.
7. 첫 slice가 안정된 뒤 단일 `hp:t` 내부 부분 selection의 run split로 확장한다.

표 편집은 같은 milestone의 다음 관문이지만 style command와 한 commit에 섞지 않는다.

## 7. 출처

모든 링크는 2026-07-29에 확인했다. 구현 판단은 움직이는 branch 대신 검토한 commit에
고정한 링크를 우선한다.

### Kordoc

- [README, commit `e4878dd`](https://github.com/chrisryugj/kordoc/blob/e4878dd12e2d769361157cbf49520f2777b186f8/README.md)
- [MIT License, commit `e4878dd`](https://github.com/chrisryugj/kordoc/blob/e4878dd12e2d769361157cbf49520f2777b186f8/LICENSE)
- [HWPX source map](https://github.com/chrisryugj/kordoc/blob/e4878dd12e2d769361157cbf49520f2777b186f8/src/roundtrip/source-map.ts)
- [HWPX round-trip patcher](https://github.com/chrisryugj/kordoc/blob/e4878dd12e2d769361157cbf49520f2777b186f8/src/roundtrip/patcher.ts)
- [reflow layout](https://github.com/chrisryugj/kordoc/blob/e4878dd12e2d769361157cbf49520f2777b186f8/src/render/reflow.ts)

### Alhangeul for macOS

- [README, commit `1e7f5df`](https://github.com/postmelee/alhangeul-macos/blob/1e7f5df59684713745cb9d59c0a0e9dfdaaf0272/README.md)
- [MIT License, commit `1e7f5df`](https://github.com/postmelee/alhangeul-macos/blob/1e7f5df59684713745cb9d59c0a0e9dfdaaf0272/LICENSE)
- [HWP/HWPX input validation](https://github.com/postmelee/alhangeul-macos/blob/1e7f5df59684713745cb9d59c0a0e9dfdaaf0272/Sources/Shared/HwpDocumentInputValidator.swift)
- [PDF export controller](https://github.com/postmelee/alhangeul-macos/blob/1e7f5df59684713745cb9d59c0a0e9dfdaaf0272/Sources/HostApp/Services/RhwpStudioPDFExportController.swift)
- [recent document bookmark store](https://github.com/postmelee/alhangeul-macos/blob/1e7f5df59684713745cb9d59c0a0e9dfdaaf0272/Sources/HostApp/Services/RecentDocumentStore.swift)
- [`rhwp` core provenance lock](https://github.com/postmelee/alhangeul-macos/blob/1e7f5df59684713745cb9d59c0a0e9dfdaaf0272/rhwp-core.lock)

### hwp-mcp

- [README, commit `4a93489`](https://github.com/treesoop/hwp-mcp/blob/4a93489d4f7dd316279b5f6f5d83014d9a8063f4/README.md)
- [MIT License, commit `4a93489`](https://github.com/treesoop/hwp-mcp/blob/4a93489d4f7dd316279b5f6f5d83014d9a8063f4/LICENSE)
- [HWPX ZIP mutation](https://github.com/treesoop/hwp-mcp/blob/4a93489d4f7dd316279b5f6f5d83014d9a8063f4/src/core/hwpx-mutate.ts)
- [rhwp document traversal](https://github.com/treesoop/hwp-mcp/blob/4a93489d4f7dd316279b5f6f5d83014d9a8063f4/src/core/document.ts)

