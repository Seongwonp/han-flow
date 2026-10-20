# Han-Flow

<p align="center">
  <img src="build/icon.png" width="160" alt="Han-Flow 앱 아이콘" />
</p>

<p align="center">
  Windows와 macOS에서 HWPX와 HWP 5.0 문서를 안전하게 읽고 제한적으로 편집하는 데스크톱 도구<br />
  (Windows·Linux CI 자동 검증, macOS 관문은 하드웨어 대기)
</p>

Han-Flow는 상용 오피스를 복제하는 프로젝트가 아닙니다. 공공기관과 학교에서 받은 한글
문서를 Windows와 Mac에서 실제로 열고, HWPX의 지원 범위만 원본 package를 보존하며 수정하는
작고 안정적인 도구를 목표로 합니다. HWP는 읽기 전용이고 HWPX 편집도 아직 제한적입니다.

V1의 HWPX 뷰어와 V2의 HWP 5.0 읽기를 완료했습니다. V3에서는 HWPX 원본 package 보존,
검증형 Save As, transaction 기반 undo/redo와 제한된 문단·글자 모양·표 편집 UI를 패키지 앱에
연결했고 자동 관문을 통과했습니다. V3 완료에는 Windows 한/글 왕복과 실제 Mac의 물리 두벌식
입력 승인이 남아 있습니다.

현재 주 개발·자동 검증 환경은 Windows와 Linux입니다. Windows CI는 test·package·패키지 앱
E2E와 비서명 NSIS 설치본을, Linux CI는 package·xvfb 패키지 앱 E2E와 unpacked 앱을 만듭니다.
macOS 관문(물리 IME, 서명·공증, macOS 13+ 실행)은 기존 개발 Mac이 고장 나 하드웨어를 확보할
때까지 대기합니다. 서명을 포함한 사용자 배포는 V4 범위이며 현재 `1.0.0-rc.1`은 개인 검증용
비서명 빌드입니다.

## 현재 지원 범위

### HWPX

- OWPML XML 자식 순서와 미지원 package 항목을 보존하는 문서 모델
- 문단·글자 스타일, 표·병합 셀, 테두리·배경색과 이미지
- 목록, 구역별 머리말·꼬리말과 쪽 번호 재시작
- 다단(`hp:colPr`) 조판: 일반·배분·평행 다단, 왼쪽부터·오른쪽부터·맞쪽 배치, 서로 다른 단 너비·간격, 단 사이 구분선,
  구역 중간 다단 정의 변경(같은 쪽 아래 새 다단 영역)과 단 나눔
- 실제 DOM 높이를 사용하는 2-pass pagination
- 그대로 그리지 못하는 개체(수식·차트·OLE·글상자·도형·양식 컨트롤·동영상·각주/미주·메모·덧말)를 읽기 전용 자리 표시로
  표시하고, 수식 script·글상자 글·각주/미주 본문·메모 내용은 글자로 되살림. 상자 크기는 선언 크기를 참고하되 쪽보다 크면 줄여
  "(축소)"로 표시하며(쪽보다 높은 그림도 같은 한도로 가로세로 비율을 지켜 줄임), 회전과 개체 자체의 그림(수식 조판, 차트·OLE 그리기)은 재현하지 않음. 문서 안내 배너·상태 막대와 PDF
  내보내기 전 확인 대화상자로 개체 종류별 개수를 알림
- 본문 문단의 글자처럼 취급하지 않는 개체(`hp:pos treatAsChar="0"`: 그림·표·글상자·사각형·타원·선·다각형 등)를 원본
  기준(용지·쪽·단·문단)·맞춤·offset 위치에 그림(화면·PDF 같음). 글 뒤·글 앞 개체는 글 흐름에 영향 없이 글 아래·위에, 자리 차지
  개체는 그 세로 띠만큼 글을 비우고(쪽 기준이면 그 쪽 본문을 줄임), 문단 기준 글 옆 배치는 그 문단 글을 줄 단위로 개체 옆에
  흘림. 글상자는 원본 선·면 색·안쪽 여백 상자에 글을 읽기 전용으로, 사각형·타원·선·다각형은 원본 선·면 색으로 그림
- HWPX 각주를 번호 표시가 놓인 쪽(단) 아래에 구역 각주 모양(`hp:footNotePr`의 구분선·간격·번호 모양)대로 배치하고 본문을
  그 높이만큼 줄임. 한 쪽보다 긴 각주는 줄 단위로 나눠 다음 쪽 아래에 이어 그림(화면·PDF 같음). 미주는 구역 끝 목록
- 긴 표 셀의 continuation 행과 반복 머리글
- 모든 HWPX를 heap·timeout 한도의 decoder worker에서 해석하는 점진 decode와 페이지 가상화
- 원본 `hp:t` source anchor 기반의 제한된 일반 문단·표 body cell 텍스트 편집
- 표만 든 본문 문단의 표 앞·뒤 글자 입력(표 run 안 표 앞·뒤에 `hp:t`를 만들고 exact Undo/Redo)
- 쪽 아래 각주·구역 끝 미주 본문과 머리말·꼬리말(같은 것을 쓰는 모든 쪽에 반영)의 글자 입력·삭제·치환
- 글자만 든 글상자 글·메모 본문의 글자 입력·삭제·치환, 각주·미주·머리말·꼬리말·글상자 문단의 글자·문단 모양과 Enter 분할·경계 병합
- caret 자리에 각주 넣기(뒤 각주 번호를 다시 매김)와 각주 지우기(각주 본문의 [각주 지우기] 또는 번호 표시를 품은 범위 삭제)
- `hp:t` 내부 `hp:lineBreak` 왕복, Shift+Enter와 여러 줄 plain-text 붙여넣기
- 최상위 일반 텍스트 문단의 Enter 분할과 selection·Undo/Redo·Save As 복원
- 문단 경계 Backspace/Delete 병합과 앞 문단 서식·양쪽 글자 run 보존
- 최상위 여러 문단의 keyboard·pointer 선택, 구조적 치환과 exact Undo/Redo·Save As
- 편집 충돌·지원 제한·세션 종료·기록 한도·저장 실패를 구분하는 오류 안내
- 연속 음절 burst·스페이스바 조합 종료를 보존하는 한국어 IME commit과 앱 history 기반
  undo/redo(macOS `⌘Z`·`⇧⌘Z`, Windows·Linux `Ctrl+Z`·`Ctrl+Y`·`Ctrl+Shift+Z`)
- 원본을 보존하는 검증형 HWPX Save As(교체 확인이 없으면 기존 파일을 덮어쓰지 않음)와 저장 savepoint
- 파일 교체·창 닫기·앱 종료의 저장/버리기/취소 dirty 보호
- 단일 `hp:t` 전체 또는 부분 선택의 굵게·기울임·밑줄·취소선·글자 크기·글자색
- 최상위 일반 문단의 왼쪽·가운데·오른쪽·양쪽 정렬과 style 분할 뒤 여러 run 연속 입력
- 최상위 일반 문단의 100–300% 줄 간격과 0–72pt 문단 앞·뒤 간격
- 최상위 일반 문단의 −72–72pt 첫 줄 내어쓰기·들여쓰기
- 일반 body 표 셀의 여러 문단 편집과 격리된 테두리·배경 편집
- 단순 직사각형 표의 안전한 행 추가·삭제와 삭제 후 selection 재배치
- 단순 직사각형 표의 열 추가·삭제와 열 주소·표 너비·selection 갱신
- 동일한 모양의 현재 body 셀과 오른쪽 셀을 합치는 제한된 수평 1×2 병합
- 읽기 전용 병합 셀의 click·keyboard 선택, source anchor 추적과 선택 outline
- 다른 행의 열 너비 근거로 선택한 수평 1×2 병합 셀을 되돌리는 제한된 분할
- `파일`·`편집`·`서식`·`표`·`보기` 탭 리본(40px control, 편집 중 기본 `서식`, 표 안 caret은 `표` 탭 표시, 화살표 키 탭 이동)

### HWP 5.0

- `@rhwp/core` WASM 기반 fixed-page 화면과 PDF
- 첫 페이지 우선 렌더링과 전용 Web Worker 격리
- 좌표형 React text layer를 사용한 검색(`⌘F`/`Ctrl+F`)·선택·접근성
- 세로·가로 혼합 용지와 페이지별 크기를 보존하는 PDF
- 200 MiB 제한, CFB·`FileHeader`·5.x version 사전 검사
- 암호·배포용·DRM·비지원 version·손상 문서의 구조화된 오류

### 데스크톱 공통

- OS 파일 열기(macOS Finder `open-file`, Windows·Linux 명령줄·second-instance)를 포커스된 창에 전달
- 열기 대화상자와 드래그앤드롭, 창별 경로 허용목록(`DOCUMENT_PATH_NOT_ALLOWED`)
- macOS는 ⌘, Windows·Linux는 Ctrl 단축키와 platform별 리본 tooltip, Windows·Linux 기본 메뉴 제거
- OS별 글꼴 대체 체인(Windows 맑은 고딕·바탕, macOS Apple 글꼴, Linux Noto)과 한/영 family alias
- 트랙패드 pinch zoom, dark mode chrome과 화면의 페이지 구조를 사용하는 PDF 내보내기(문서 이름의 기본 파일 이름·PDF 제목)
- `<파일 이름> - Han-Flow` 창 제목

HWP와 HWPX는 preload에서 형식별 IPC를 노출하지 않습니다. main의 `DocumentImporter`가
공통 `document:import` 요청을 받아 HWP preflight 또는 HWPX 점진 decoder를 선택하고,
React loader는 성공·실패와 background 완료를 같은 계약으로 처리합니다.
main은 모든 IPC 요청이 Han-Flow 창의 최상위 renderer 문서(패키지 `index.html` 또는 개발 dev server)에서 왔는지 확인한 뒤에만
처리하고(`src/main/ipc_guard.ts`), 그 밖의 frame·문서가 보낸 요청은 거부합니다.

## 처리 구조

```text
OS open / dialog / drop  →  창별 경로 허용목록
          │
          ▼
  DocumentImporter
    ├─ HWPX package → decoder worker → ordered XML → ViewerDocument
    └─ HWP preflight → rhwp Worker → FixedPageDocument
          │
          ▼
 HWP read-only / HWPX guarded edit boundary
          │
          ▼
 React viewer → virtualization → PDF
```

HWP 5.0 레코드 parser를 처음부터 다시 구현하지 않았습니다. 비교 실험과 ADR을 거쳐
`@rhwp/core`를 production fixed-page engine으로, `kordoc`을 development-only semantic
oracle로 사용합니다. 자동 fallback은 두지 않습니다.

## 검증 결과

완료 주장은 단위 테스트만이 아니라 개인정보 없는 공개 fixture, 패키지 앱과 다시 생성한 PDF를
함께 사용해 검증합니다. 아래 첫 표는 현재 commit에서 누구나 다시 실행할 수 있는 결과이고, 과거
Mac·로컬 기기 측정은 별도 절로 분리합니다. 날짜별 상세는 [개발·검증 이력](docs/verification_history.md)에
기록합니다.

### 현재 재현 가능한 결과

Jest·probe·`verify:matrix`는 2026-10-18 Linux 컨테이너에서 다시 실행한 값이고, 날짜를 적은 행은 그때 측정한 값입니다.

| 관문 | 결과 |
| --- | --- |
| Jest (`npm test`) | 91 suites passed·7 skipped, 1,140 passed·18 skipped |
| parser·검증 script probe (`npm run test:probe`) | 36 passed |
| `verify:matrix` (Linux 패키지 앱, xvfb) | 통과 |
| 공개 HWPX corpus (`npm run verify:corpus`, 2026-09-28) | 39/39 (synthetic 11종 + 한/글 저장본 external 28종, invalid-package 1종 의도적 거부 포함) |
| 편집 가능 비율 (`npm run corpus:editing-coverage`, 정보용) | 외부 한/글 28종 373 run(2026-10-20): anchor 99.2%·text 편집 98.9%(글자 run 입력·삭제 coverage이지 일반 편집 완성도가 아님. 머리말·꼬리말과 각주·미주 표본은 각 2 run, 글상자 11·메모 2 run뿐)·글자 가중 98.9%·표 셀 66/66·글자 모양 81.2%·문단 모양 98.7%·문단 나눔 281/399(capability·코어 불일치 0)·글자 칸 없는 문단 46/46·표 앞·뒤 caret 19/19 (2026-10-14 96.0%·94.3%·77.7%·95.0%·270/399, 2026-10-07 89.8%·92.8%·90.2%·44/46, 2026-09-29 79.5%·89.3%·45/66·45.0%·44.8%, [측정](docs/editing_coverage.md)) |
| 공개 fixture catalog | HWPX 39종(synthetic 11·외부 공개 28)·HWP 1종, core/production/HWP pipeline ID 연결 |
| Windows CI (`windows-latest`) | test·typecheck·probe·corpus·build·package, 패키지 앱 HWPX·HWP matrix·PDF E2E, 비서명 NSIS artifact 통과 |
| Linux CI (`ubuntu-latest`, xvfb) | 같은 자동 관문과 `package:linux`, 패키지 앱 HWPX·HWP matrix·PDF E2E, unpacked artifact 통과 |
| macOS | CI 없음, 하드웨어 대기 |
| 배포 고지 | Apache-2.0, rhwp MIT, Third-Party Notices |

CI 패키지 앱 E2E의 공개 fixture 결과(Linux 기준):

| fixture | 결과 |
| --- | --- |
| HWPX baseline | 3쪽, 이미지 4개, overflow 0 |
| 15문단 표 cell | 2쪽, continuation과 반복 머리글, overflow 0 |
| 이미지·`rowSpan` | 1쪽, 이미지 12개, overflow 0 |
| 동일 너비 2단 | DOM 1쪽·단 2개, 양쪽 본문 17·43자 |
| large progressive | 15,003쪽 중 DOM 12개 mount, 원문 개체 비교는 15,003쪽을 넘기며 확인 |
| invalid package | crash 없는 사용자 오류 |
| HWP `synthetic-layout` | 5.0.3.2, 2쪽, 표 1·셀 9·이미지 1, 반복 머리말 2회, 결정적 생성 |
| HWP PDF | 2쪽 A4, 텍스트 보존율 98.6% |
| HWP 오류 입력 | 암호·배포용·DRM·비지원 version·손상 5종 |

대형 문서의 전체 쪽수는 대체 글꼴 metric에 따라 달라지며 판정 기준은 DOM mount 수와 overflow 0입니다.
개인정보 없는 고정 HWP는 자체 생성한 본문, 3×3 표, PNG 이미지와 반복 머리말로 구성하며 생성
코드와 SHA-256 manifest를 저장소에 함께 둡니다.

### 과거 macOS 측정 (2026-07~08, 현재 재현 불가)

다음 수치는 당시 로컬 Apple Silicon Mac의 macOS 패키지 앱(Electron 28)에서 측정했습니다. 해당
Mac을 사용할 수 없어 현재 commit(Electron 44)에서는 다시 측정하지 못했으므로 현재 성능이나
지원 상태를 보장하는 값이 아닙니다.

| 검증 | 결과 |
| --- | ---: |
| HWP cold open 20회 | p50 535ms / p95 614ms / max 722ms |
| HWP warm open 20회 | p50 203ms / p95 237ms |
| 저장소 밖 실사용 HWP | 7쪽, 3개 구역 혼합 용지, overflow 0, PDF 텍스트 99.08% |
| 80-section synthetic HWPX | 9,767쪽 중 DOM 12개 mount |
| macOS 두벌식 OS-level key matrix | 문단·표 셀 연속 입력, Backspace·Escape·양방향 치환·undo/redo 7 시나리오 통과 |
| macOS arm64 package | unsigned `.app` 생성 |

실사용 HWP 검증 과정에서 마지막 페이지 이미지 decode 전에 인쇄가 시작되던 race를 발견해
수정했습니다. 파일명·본문·캡처와 생성 PDF는 공개 저장소에 포함하지 않습니다.

### 과거 로컬 Windows 측정 (2026-09-07~13, CI 미포함)

| 검증 | 결과 |
| --- | --- |
| 표 구조 production E2E | 3×3 행·열 추가/삭제, 병합·분할, undo/redo·Save As·재개봉 topology 통과 |
| production matrix | 6종 통과, 대형 문서 19,503쪽 중 DOM 12개 mount |

자동 pagination 회귀에는 의도적으로 작은 용지 fixture를 유지합니다. 편집 사용성 검증은 별도의
A4 세로 fixture(`59528 × 84189 HWPUNIT`, 사방 20mm 여백)를 사용합니다.

## 로드맵

`V1–V4`는 제품 milestone, `Sprint N`은 실행 단위입니다. 대응 관계와 상태의 기준은
[장기 완성도 로드맵 §1](docs/long_term_roadmap.md#1-제품-계약)입니다.

| 단계 | 상태 | 범위 |
| --- | --- | --- |
| V1 — HWPX 뷰어 | 완료 | 읽기, 점진 로딩, PDF, 데스크톱 UX |
| V2 — HWP 5.0 읽기 | 완료 | fixed-page 화면·검색·PDF, 안전한 열기 |
| V3 — 제한적 HWPX 편집 | 자동 관문 완료·외부 승인 대기 | Windows 한/글 왕복·macOS 물리 IME 대기 |
| Sprint 0 — 기준선과 P0 방어 | 완료 | CI·resource budget·legacy 제거 |
| Sprint 4 — 호환성 corpus | 진행 중 | HWPX synthetic 11종·외부 공개 28종·HWP 1종, intake 계약 완료, 렌더링 품질 지표 확장 중 |
| Sprint 5 — Windows 배포 후보 | 진행 중 | 비서명 NSIS artifact, 실기·code signing 대기 |
| Sprint 6 — macOS 공개 배포 | macOS 하드웨어 대기 | macOS 13+ 실행, arm64 서명·공증·설치 |
| V4 — 사용자 배포 | 준비 중 | Sprint 5·6·7 |

단일 완료율은 범위와 검증 수준을 숨길 수 있어 공개 완료 판정으로 사용하지 않습니다.
기능은 코드, 공개 fixture, 실제 문서, 한/글 왕복과 OS별 검증을 순서대로 통과해야 완료입니다.

다음 구현은 미주 문서 끝 배치와 수식의 읽기 전용 모델·fallback입니다.

V3에서는 과거 `contentEditable` prototype을 완성된 기능으로 간주하지 않습니다. 모든 HWPX ZIP
entry와 unknown XML·binary를 identity round-trip하는 source package, command·transaction,
bounded undo/redo와 savepoint·dirty 상태는 창별 편집 worker thread가 소유하고, main process는 창별 session
목록과 상태 거울(dirty 등)·저장 목적지 결정만 맡으며 renderer에는 제한된 IPC만 노출합니다. 변경본은 실제로 바뀐 구조(본문·글자 모양·문단 모양·문단 구조·표 셀
모양·표 구조), 보존 정책과 Preview 상태를 확인한 뒤 검증된 HWPX로 저장합니다. 원본과 열린 편집
session의 원본은 덮어쓰지 않으며, 다른 기존 파일은 저장 대화상자에서 교체를 확인한 경우에만
교체합니다. 저장하지 않은 상태에서 다른 문서를 열거나 창·앱을 닫으면 저장, 버리기, 취소 중
하나를 선택해야 합니다. 앱이 강제 종료되거나 편집 엔진이 중단되어도 저장하지 않은 편집은 사용자 app data 폴더의
복구 기록에 남아, 다음에 앱을 열거나 같은 문서를 열 때(엔진 중단은 바로) [복구]·[버리기]·[나중에]를 묻습니다.
단, 한 session의 기록이 크기 한도(64 MiB·100,000단계)를 넘으면 그 session은 더 이상 복구 기록을 남기지 않으며,
상태 막대에 "복구 기록 중단"을 계속 표시해 바로 저장하도록 알립니다(아래 알려진 제한 참고).
`.hwp` 저장은 V3의 약속이 아닙니다.

## 알려진 제한

- HWPX 편집은 최상위 텍스트 문단과 일반 표 body cell의 단일 text run 문단을 지원합니다. 부분 style로
  나뉜 여러 run과 여러 최상위 문단은 키보드·pointer 범위 선택과 치환을 지원합니다.
- 머리글·병합(`rowSpan`·`colSpan`) 셀과 여러 run 문단이 있는 셀은 문단 하나 안에서 text 입력·삭제·치환과
  글자·문단 모양만 지원하고 구조·셀 모양 편집은 막습니다. 쪽을 넘어 나뉜 셀 조각(continuation fragment)은 읽기 전용입니다. 병합되지 않은 일반 body cell은 여러 문단의 단일 text run을 편집하고, 같은 cell 안에서
  문단을 가로지르는 범위 치환·Enter 분할·경계 Backspace/Delete 병합을 수행할 수 있습니다.
- 한/글이 빈 입력 칸으로 저장한 `<hp:t/>`에 입력하면 `<hp:t>…</hp:t>`로 펼치고, 실행 취소는 원래
  `<hp:t/>` bytes를 복원합니다.
- `hp:t`가 아예 없는 빈 문단·빈 셀(`<hp:run charPrIDRef="0"/>`, 구역 정의만 든 첫 문단, run 없는 `<hp:p/>`)도 caret을
  받습니다. 첫 입력이 그 run(또는 문단 style 글자 모양의 새 run)에 `hp:t`를 만들고, 실행 취소는 원래 bytes를 복원합니다.
  첫 글자를 넣기 전에는 문단 모양만 바꿀 수 있고 글자 모양, Enter 분할·Backspace/Delete 병합, 셀 모양·표 구조는
  막습니다. 빈 셀은 text 전용 셀로 다룹니다. 머리말·꼬리말·각주·글자만 든 글상자의 빈 문단도 첫 글자를 받습니다.
- 표만 든 본문 문단(`hp:run > hp:tbl`, 표 하나와 구역·쪽 정의만 든 run)은 편집 중 표 왼쪽 위·아래의 좁은 입력 칸으로 표 앞·뒤 caret을
  받습니다. 첫 글자가 같은 run 안 표 바로 앞(또는 뒤)에 `hp:t`를 만들고, 표 옆 빈 `<hp:t/>`나 이미 있는 표 앞·뒤 글자는 그대로 고칩니다.
  Enter 분할·경계 Backspace/Delete 병합·글자 모양은 막고(상태 막대에 이유 표시) 문단 모양은 글자를 넣은 뒤 바꿀 수 있습니다. 표 앞 글자와
  표 뒤 글자를 한 범위로 선택하지 않습니다. 표가 둘 이상이거나 그림·각주·필드가 함께 든 문단, 표 셀·머리말 안 표 문단은 대상이 아닙니다.
- 쪽 아래 각주·구역 끝 미주 본문과 머리말·꼬리말의 글자만 든 문단은 글자 입력·삭제·치환(문단 하나 안 여러 run 포함)을
  지원합니다. 각주 번호(`hp:autoNum`)와 본문 위치·머리말 정의는 저장할 때 byte 그대로이고, 머리말·꼬리말은 같은 머리말을 쓰는 모든 쪽에
  함께 반영되고, 칸 끝·처음의 방향 키(Shift 선택 포함)는 다른 쪽에 되풀이된 같은 칸으로 넘어가지 않고 지금 쪽 칸 안에서 멈춥니다. 표·그림이 든
  머리말 문단은 읽기 전용입니다. 쪽을 넘어 줄 단위로 나뉜 각주 문단은 앞 쪽 조각에서만 고칩니다(편집 중 앞 조각은 문단 전체를
  조각 높이로 잘라 보여 주므로 뒤쪽 줄로 caret을 옮기면 조각 안에서 글이 밀려 보이고, 다음 쪽의 이어지는 줄은 읽기 전용입니다).
- 글자만 든 글상자(도형 글)와 메모 본문은 편집 중 그 자리에서 글자를 입력·삭제·치환합니다(원본 위치 글상자는 편집 중에만 누를 수
  있고, 메모는 줄 안 "메모: …" 자리의 입력 칸입니다). 표·그림·도형·수식·각주·필드가 하나라도 든 글상자·메모는 전체가 읽기 전용입니다.
  메모 본문은 글자만 고치고 글자·문단 모양과 Enter는 막습니다.
- 각주·미주·머리말·꼬리말·글자만 든 글상자 문단은 본문과 같은 글자·문단 모양과 Enter 분할·경계 Backspace/Delete 병합을 지원합니다.
  한/글 저장본처럼 번호(`hp:autoNum`)와 글자가 한 run에 든 각주 첫 문단의 글자 모양은 번호를 원래 모양 run에 남기고 글자만 새 run으로
  나눕니다. 번호나 개체가 든 문단은 본문과 같은 이유로 Enter·병합을 막고(번호가 든 각주 첫 문단, 그 문단과 다음 문단의 병합), 문단을
  넘는 범위 선택은 하지 않습니다.
- 리본 `편집` 탭의 [각주 넣기]는 본문 문단(구역 직속) 글자 사이 caret에 한/글 모양의 각주를 넣고 새 각주 본문으로 caret을 옮깁니다.
  번호는 앞 각주 + 1이고 뒤 각주 번호(`number`·`autoNum num`, 이어 매기기면 뒤 구역까지)를 1씩 올립니다. [각주 지우기]는 caret이 든
  각주를 지우고, 본문 범위가 번호 표시를 품으면 범위 삭제가 그 각주도 지웁니다(뒤 번호를 내림). 실행 취소는 원래 bytes를 되살립니다.
  표 셀·글상자·머리말 안 각주 넣기, 미주 만들기·지우기, 쪽마다 새로 매기는(`ON_PAGE`) 구역의 각주 넣기·지우기는 지원하지 않습니다.
- HWPX 각주는 번호 표시가 든 본문 문단이 놓인 쪽(다단이면 그 단) 아래, 꼬리말 위에 그립니다. 문단과 그 각주가 함께 들어가지
  않으면 문단을 다음 쪽으로 넘기고, 각주가 빈 쪽에도 다 들어가지 않을 만큼 길면 문단 경계나 화면에서 잰 줄 경계에서 나눠 다음 쪽
  아래 처음에 이어 놓습니다(남은 각주가 있으면 다음 본문도 다음 쪽으로 갑니다). 본문은 문단 단위로만 쪽을 나누므로 번호 표시가 든
  문단 전체를 함께 옮깁니다(한/글은 번호가 든 줄만 옮깁니다). 글자 run이 아닌 개체(그림·수식 등)가 든 각주 문단과 측정 전 첫 화면은
  문단 경계에서만 나누고, 그런 문단 하나가 한 쪽보다 길면 넘칠 수 있습니다. 구분선 길이 `-1`(한/글 기본값)은 단 너비의 1/3로 그리고,
  다단 구역은 `MERGED_COLUMN`·`RIGHT_MOST_COLUMN`도 단마다(`EACH_COLUMN`) 둡니다. 번호는 원본 번호를 쓰고, 구역마다 새로
  매기기(`ON_SECTION`)는 시작 번호부터, 쪽마다 새로 매기기(`ON_PAGE`)는 Han-Flow 쪽 나눔 기준으로 다시 매깁니다. 미주는 `hp:endNotePr`
  위치가 문서 끝(`END_OF_DOCUMENT`)이어도 구역마다 구역 끝에 모아 보여 줍니다(구역별 증분 해석·편집 anchor를 유지하기 위해서). HWP 5.0
  문서의 각주는 `@rhwp/core` 쪽 그림을 그대로 씁니다.
- HWPX 다단은 단마다 그 단 너비로 다시 실측해 첫 단→다음 단→다음 쪽 순서로 채웁니다. `RIGHT`는 첫 단을 오른쪽 끝에, `MIRROR`는
  홀수 쪽은 왼쪽부터·짝수 쪽은 오른쪽부터 놓습니다(쪽 번호는 Han-Flow 쪽 순서). 서로 다른 단 너비(`sameSz="0"`의 `hp:colSz`)는
  한/글이 쓰는 비율 값으로 보고 너비·간격 합을 본문 폭에 맞춥니다. 단 나눔(`columnBreak`)과 측정 뒤 원본 줄 배치가 위로 되돌아가는
  문단은 다음 단으로 가되, 화면 글이 원본보다 커서 이미 다음 단으로 넘쳤으면 그 단이 원본의 단 시작을 받습니다. 구역 중간 문단의
  새 다단 정의는 같은 쪽 앞 영역 아래에서 새 영역을 시작하고 앞 영역 단 높이를 맞추며, 배분 다단(`BALANCED_NEWSPAPER`)은 구역 끝
  쪽에서도 단 높이를 맞춥니다. 본문은 문단 단위로만 단을 나누므로 높이 맞춤은 문단 경계에서 하고(한/글은 줄 단위), 단 나눔·원본 줄
  배치로 단을 넘긴 영역과 각주가 있는 영역은 맞추지 않습니다. 평행 다단(`PARALLEL`)은 근사입니다: 단 나눔마다 다음 단으로, 마지막
  단의 단 나눔은 같은 쪽 가장 긴 단 아래 새 줄로 가고, 한 단이 쪽보다 길면 일반 다단처럼 다음 단·쪽으로 이어집니다
  (`HWPX_PARALLEL_COLUMN_APPROXIMATED` 진단). 한 쪽에 다단 영역이 여럿이면 각주는 마지막 영역의 단 아래에 둡니다(앞 영역 단이 더
  많으면 남는 단의 각주는 마지막 단에 모읍니다). 단 너비가 다른 다단의 각주 높이는 첫 단 너비로 잽니다. 단 나눔이 한 단 구역에서는
  무시되고, 구분선은 단 사이 간격 한가운데에 원본 종류·굵기·색으로 그립니다(이중선 계열은 CSS 이중선으로 근사).
- 글자 모양은 단일 `hp:t` 전체 또는 내부 부분 선택의 굵게·기울임·밑줄·취소선·크기·색상을 지원합니다.
  최상위 문단, 최상위 표의 셀(병합·머리글 셀 포함) 직속 문단, 각주·미주·머리말·꼬리말·글자만 든 글상자 문단에 적용하며,
  셀 안에 다시 든 표, 메모 본문, 표와 같은 run의 글자는 거부합니다.
  글꼴은 문서 `HANGUL` font-face에 이미 선언된 family만 ID로 재사용하며 새 글꼴 추가·포함은 지원하지 않습니다.
- 부분 스타일로 여러 run이 된 최상위 문단은 run별 입력 surface와 좌우 경계 이동을 지원합니다.
- 여러 run에 걸친 글자 모양 적용은 아직 지원하지 않으며 해당 선택에서는 글자 모양 control과
  단축키를 비활성화합니다.
- 편집 capability는 최상위 문단, 안전한 표 셀 text, 여러 run·문단과 서로 다른 구조의 selection을
  구분합니다. 여러 문단 표 셀은 cell별 scope를 공유하되 다른 cell과 격리합니다. 표 셀에서도
  글자·문단 모양 control과 단축키를 본문과 같은 run·문단 조건으로 열고, 안전한 단일 셀에서는
  배경색과 사방 테두리 색·두께를 편집합니다.
  병합·span·반복 머리글·continuation 구조 편집은 요청 전에 차단합니다.
- 편집 결과의 selection anchor가 문서 갱신으로 달라지면 최신 main projection을 다시 받아
  offset을 안전한 UTF-16 경계로 조정합니다. 한 endpoint만 남으면 그 위치로 접고 둘 다
  사라지면 선택을 해제한 뒤 다시 선택하도록 안내합니다.
- Shift+Enter와 plain-text 붙여넣기의 줄바꿈은 `hp:t` 내부 `hp:lineBreak`로 저장합니다. 최상위
  일반 텍스트 문단과 안전한 일반 body cell은 Enter 분할과 문단 경계 Backspace/Delete 병합을
  지원합니다. 여러 문단 범위는 같은 section의 최상위 문단 또는 같은 표 cell 안에서만 연결하며
  서로 다른 cell·중첩 구조의 scope를 섞지 않습니다.
- 문단 모양은 최상위 일반 문단과 최상위 표 셀 직속 문단의 정렬 4종, 줄 간격, 문단 앞·뒤 간격과 첫 줄
  들여쓰기·내어쓰기를 지원합니다. 인라인 탭이 있는 문단도 같은 문단 모양을 바꿀 수 있으며,
  기존 `tabPrIDRef`와 글머리표·번호 매기기 `heading`은 복제·저장·undo/redo에서 유지합니다.
  사용자 정의 탭 위치와 목록 모양 자체를 새로 만들거나 바꾸는 기능은 아직 지원하지 않습니다.
- 일반 body cell의 기존 `borderFill`을 복제해 셀 배경색과 사방 테두리의 색·두께·없음을 적용합니다.
  공유 style 원본은 유지하므로 다른 셀에 변경이 번지지 않습니다. 단색 `winBrush`와 사방 border 정의가
  없는 셀, 머리글·병합·continuation 셀은 안전하게 거부합니다.
- 병합·중첩·복합 콘텐츠가 없는 직사각형 표에서는 현재 body 셀 아래에 같은 모양의 빈 행을
  추가할 수 있습니다. `rowCnt`와 뒤쪽 `rowAddr`를 함께 갱신하며 기존 반복 머리글은 보존합니다.
  현재 body 행 삭제도 지원하고 다음 또는 이전 body 행으로 선택을 안전하게 옮깁니다. 마지막 body
  행과 반복 머리글은 삭제하지 않습니다. 같은 안전 범위에서 오른쪽 빈 열 추가와 현재 열 삭제도
  지원하며 주소·표 너비와 선택을 함께 갱신합니다.
- 제한된 수평 1×2 병합은 기존 문단을 왼쪽에 순서대로 보존합니다. 분할은 다른 모든 unmerged
  행에서 두 논리 열의 너비가 일관된 경우에만 허용하며, 기존 문단은 왼쪽에 남기고 오른쪽에는
  같은 모양의 빈 문단을 만듭니다. 너비 근거가 없거나 기존 span·복합 콘텐츠가 있으면 거부합니다.
- HWPX Preview 미리보기는 현재 재생성하지 않습니다. 구조 편집이 남아 있으면 `stale`, 원문 상태로
  undo했으면 `current`, 원래 없으면 `omitted`로 저장 확인창과 완료 상태에 표시합니다.
- 현재 저장은 다른 이름으로 저장만 지원하며, 저장 대화상자에서 교체를 확인한 다른 기존 파일은 원자적으로 교체하지만 열려 있는 원본 문서 덮어쓰기는 항상 거부합니다. hard link를 지원하지 않는 파일 시스템(exFAT·FAT32·일부 SMB)에서는 새 파일 게시가 확인 후 rename으로 대체되어, 확인 직후 다른 프로그램이 같은 이름의 파일을 만드는 짧은 경쟁 구간이 남습니다. 저장 도중 앱이 강제 종료돼 저장 폴더에 남은 Han-Flow 임시 파일(`.<이름>.han-flow-<UUID>.tmp`)은 같은 폴더에 다시 저장할 때 1시간이 지난 것만 지웁니다.
- HWPX 편집 엔진은 창마다 별도 worker thread에서 실행되어 큰 문서를 편집·저장하는 동안에도 다른 창·메뉴·대화상자가 멈추지
  않습니다. 편집 처리 하나가 60초(편집 시작 120초, 저장 검증 180초)를 넘거나 메모리 한도(1.5 GiB)를 넘으면 편집 세션을
  끝내고 보기 모드로 돌아갑니다. 메모리 한도는 worker의 JavaScript heap에만 걸리며, 압축을 푼 ZIP entry `Buffer`는 heap 밖
  메모리라 이 한도에 들지 않고 package의 entry 개수·압축 해제 크기 한도로만 묶입니다. 응답까지 받은 편집은 복구 기록에 남아
  바로 복구를 묻고, 중단을 일으킨 그 요청 하나만 빠집니다. 원본 문서는 바뀌지 않고, 저장 중에 중단되어도 반쯤 쓴 저장 파일이나
  임시 파일을 남기지 않습니다. 검증을 마친 저장 파일을 게시한 뒤 마무리 단계에서 중단되면 저장 파일은 이미 만들어졌다고 알립니다.
- 저장하지 않은 편집의 복구 기록(`<userData>/recovery/<sessionId>/journal.hfj`)은 문서 bytes가 아니라 편집 command(입력한
  글자·XML 조각 포함)만 담고, 빠르게 입력하는 동안 0.5초마다 디스크에 내립니다. 기록은 편집 엔진이 응답한 편집만 담으므로,
  앱 process가 강제 종료되거나 OS가 꺼지면 마지막 약 0.5초의 입력과 그때 아직 편집 엔진이 처리 중이던(응답 전) 요청은 잃을 수
  있습니다(창 전환·저장·닫기 확인 직전에는 바로 내립니다). 복구는 편집을 시작할
  때의 원본 파일이 크기·수정 시각·SHA-256까지 그대로일 때만 하며(복구를 물을 때는 크기·수정 시각만 보고, SHA-256은 [복구]를
  고른 뒤 편집 엔진이 원본을 읽은 bytes로 비교합니다), 원본을 고치거나 옮겼으면 복구하지 않고 기록을 보관하거나
  버리게 합니다. 앱 시작·문서 열기 때는 기록의 첫 줄(header)만 읽으므로 큰 기록도 화면을 멈추지 않고, 복구 대화상자는 편집 수
  대신 기록 크기를 보여 줍니다(편집 수는 복구 뒤 상태 막대). 기록 뒷부분의 손상은 [복구]를 고른 뒤 드러나며 그때 격리합니다.
  Windows에서 기록의 원본 경로가 네트워크 공유(UNC)·장치 경로이면 앱 시작 때는 묻지 않고(원격 접속 방지) 그 문서를 직접 열 때
  묻습니다. 표 구조 편집(행·열 추가·삭제, 셀 병합·분할)은 표 전체가 아니라 바뀐 부분만 기록하므로 큰 표에서도 기록이 빨리
  커지지 않습니다(약 200 KiB 표의 행 추가·실행 취소 반복: 약 146회 → 약 1.1만 회까지 한도 안). 이전 형식(version 1·2) 기록도 복구하며,
  복구한 뒤 이어 쓰는 기록은 지금 형식(version 3, 표 앞·뒤 caret 입력을 담을 수 있음)입니다. 이전 앱은 자기가 모르는 새 version 기록을
  열지 않고 그대로 둡니다.
  기록이 64 MiB 또는 100,000단계를 넘으면 그 session의 기록을 멈추고 최신 상태를 담지 못하는 기록 파일을
  지웁니다. 이때부터 그 문서는 비정상 종료 때 되살릴 수 없으므로 상태 막대에 "복구 기록 중단 · 저장 필요"를 계속 표시합니다
  (디스크 쓰기 실패도 같습니다). 손상되었거나 편집이 만들 수 없는 command·문단·표 조각이 든 기록, 다시 적용하지 못한 기록은
  실행하지 않고 격리합니다. [저장하지 않음]으로 닫거나 앱을 끝내면 기록을 다 지운 뒤에 창을 닫고 앱을 끝냅니다. 한 기록은 한
  창에서만 복구합니다. 격리한 기록, [나중에]로 남긴 기록, 다른 version 기록은 마지막으로 바뀐 뒤 30일이 지나면 앱 시작 뒤
  지웁니다. HWP(읽기 전용) 문서에는 해당하지 않습니다.
- 수식·차트·OLE·호·곡선·연결선·묶음 도형·글맵시·양식 컨트롤·동영상은 그림으로 그리지 않고(수식 조판·차트 그리기 없음) 선언
  크기를 참고한 테두리 상자(자리 표시)로 보여 줍니다. 선언 높이가 쪽 본문의 85%를 넘으면 같은 비율로 줄여 "(축소)"로 표시하고,
  글상자 글도 그 높이에 맞춰 줄입니다. 그림도 높이가 같은 한도를 넘으면 가로세로 비율을 지켜 줄여 그립니다. 수식은 원문 script를 글자로 보여 줍니다. 각주·미주 번호는 본문에 위 첨자로 두고 각주 본문은 쪽 아래에(위 각주 항목), 미주 본문은 구역 끝에 모아
  표시하며 미주 목록이 길면 미주 사이에서 다음 쪽으로 이어집니다. 메모는 본문 안
  작은 상자, 덧말은 ruby로 비슷하게 보여 줍니다. 자리 표시와 그 안 글은 읽기 전용(각주·미주 본문은 글자 편집 가능)이고
  같은 문단의 일반 글자 편집 가능 여부는 바꾸지 않으며, 원본 개체 bytes는 HWPX 저장 때 그대로 보존합니다. PDF에는 화면과 같은 자리 표시가 나옵니다.
- 글자처럼 취급하지 않는 개체의 원본 위치는 본문 최상위 문단의 개체에만 씁니다. 표 셀·글상자·머리말·꼬리말·각주 안 개체는
  예전처럼 줄 흐름 안에 둡니다(글 앞·뒤 개체는 작은 표시). 그 밖의 근사:
  - 글 옆 배치(`SQUARE`·`TIGHT`·`THROUGH`)는 문단 기준이면 그 문단 글만 줄 단위로 개체 한쪽(단 왼쪽 반에 있으면 오른쪽, 아니면
    왼쪽, `textFlow`가 한쪽이면 그쪽)으로 흐르고 개체가 문단보다 길면 다음 문단은 개체 아래에서 시작합니다. 양쪽 흐름·`TIGHT`의
    윤곽선 감싸기·`THROUGH`의 빈 곳 흐름은 하지 않습니다. 용지·쪽 기준 글 옆 배치는 자리 차지처럼 세로 띠 전체를 비웁니다.
  - 용지·쪽 기준 자리 차지 개체의 띠는 그 개체를 둔 문단이 놓인 쪽에 생기고, pagination은 띠 높이만큼 그 쪽(모든 단) 본문을
    줄입니다. 본문 위 끝·아래 끝에 닿지 않는 가운데 띠는 글이 띠까지 차지 않아도 높이만큼 덜 채웁니다.
  - 문단 기준 개체는 세로 맞춤을 위로 보고, 자리 차지·글 옆 배치는 음수 세로 offset을 0으로(문단 위로 올리지 않음) 둡니다.
    자리 차지 개체는 문단 글보다 먼저(문단 위 끝에) 놓습니다.
  - 자리는 한/글이 쪽 배치에 쓰는 개체 크기(`hp:sz`)로 잡고, 글상자 글이 그보다 길면 상자는 아래로 넘쳐 그립니다.
  - Han-Flow 쪽 본문은 위쪽 여백에서 시작합니다(한/글은 위쪽 여백 + 머리말 여백 아래). 용지 기준 세로 위치는 한/글 본문 영역 안이면
    머리말 여백만큼 위로 옮겨 본문 글과의 관계를 맞춥니다. 글자 줄 높이가 한/글과 달라 개체와 주변 글의 간격은 조금 다를 수 있습니다.
  - 용지 밖으로 나가는 개체는 용지 안으로 옮기고(`flowWithText`면 쪽 본문 안), 겹침 허용(`allowOverlap`)·개체 회전·글 뒤
    개체끼리의 zOrder는 쓰지 않습니다(글 뒤는 모두 본문 글 아래, 그 밖은 위). 표는 셀 선언 높이가 아니라 내용 높이로 그립니다.
- 누름틀·하이퍼링크 같은 필드는 필드 안 글을 그대로 보여 주고 필드 테두리·안내문은 표시하지 않습니다.
- 한컴오피스와 픽셀 단위로 동일한 렌더링을 목표로 하지 않습니다.
- 원문 글꼴이 없으면 대체 글꼴 폭에 따라 HWPX 줄바꿈과 페이지 분배가 달라질 수 있습니다.
- 한 문단 내부의 줄 단위 페이지 분할은 아직 지원하지 않습니다.
- 복잡한 `rowSpan`과 단일 초대형 문단은 내용 보존을 우선한 fallback을 사용합니다.
- 암호·DRM·배포용 HWP는 해제하거나 렌더링하지 않고 분류된 오류를 표시합니다.
- Windows 설치본은 code signing 전이라 SmartScreen 경고가 표시됩니다. Windows Ctrl 단축키, 맑은 고딕
  대체 체인과 exFAT 등에서의 Save As는 자동 테스트와 CI 기준으로만 확인했고 Windows 11 실기 확인은
  남아 있습니다.
- Linux는 CI 검증용 unpacked 빌드만 제공하며 배포 대상 OS가 아닙니다.
- 현재 macOS 패키지는 Developer ID 서명과 Apple notarization을 하지 않았습니다.
- macOS 패키지는 Electron 44 요구사항에 따라 macOS 13 Ventura 이상에서만 실행되며(`minimumSystemVersion` 13.0), Apple Silicon arm64 전용이라 Intel Mac은 지원하지 않습니다. Electron 44 전환 뒤의 macOS 실행·물리 IME·Finder 연결은 Mac 하드웨어 확보 후 다시 검증합니다.

함초롬체는 제3자 앱 재배포 권한이 확인되지 않아 번들하지 않습니다. 시스템 설치본의
한글·영문 family 이름을 찾아 사용하며 자세한 근거는 [글꼴 전략](docs/font_strategy.md)에
기록했습니다.

## 개발

Node.js 22와 npm 10이 필요합니다. `.nvmrc`와 `package.json#engines`가 개발 기준선이며,
깨끗한 clone에서는 lockfile을 보존하는 `npm ci`를 사용합니다.

```bash
npm ci
npm run dev
```

PDF 회귀 관문은 Poppler의 `pdfinfo`, `pdftotext`, `pdftoppm`이 PATH에 있어야 합니다. Windows는
`winget install --id oschwartz10612.Poppler --exact`로 설치할 수 있으며 설치 후 새 터미널에서
검증 명령을 실행합니다.

프로덕션 빌드와 OS별 비서명 패키지:

```bash
npm test -- --runInBand
npm run build
npm run package:mac
npm run package:linux
npm run package:win:installer
```

macOS 패키지는 `release/mac-arm64/Han-Flow.app`에 생성됩니다. Linux CI는 `release/linux-unpacked`를 묶은 unpacked 앱을 7일 보관 artifact로 올립니다.
Ubuntu 24.04 이상은 비특권 user namespace를 제한하므로 이 unpacked `dir` 빌드를 실행하려면 `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`로 sandbox helper 권한을 주거나 `--no-sandbox`로 실행해야 하며, AppArmor profile을 포함한 deb/AppImage 패키지는 이후 과제입니다.
Windows CI는 비서명 NSIS 설치본(`Han-Flow-<version>-win-x64.exe`)과 unpacked 앱을 7일 보관 artifact로 올리며, code signing(V4) 전까지 SmartScreen 경고가 표시됩니다.

주요 회귀 관문:

```bash
npm run test:probe
npm run verify:notices
npm run verify:matrix
npm run verify:hwp-matrix
npm run verify:app -- /path/to/document.hwpx
npm run verify:app -- /path/to/document.hwp
npm run verify:pdf -- /path/to/document.hwpx
npm run verify:pdf -- /path/to/document.hwp
npm run fixture:v3-windows
npm run release:audit
```

`verify:pdf`는 화면과 PDF의 페이지별 글자 수를 code point 단위로 비교하고, 글꼴에 glyph가 없어 PDF에서
추출되지 않는 사설 영역 글자(한컴 문자표 글머리 등)는 양쪽에서 뺍니다. 그 제외가 다른 손실을 가리지 않도록 결과에는
통과 여부와 관계없이 페이지별 공백 외 전체 글자 수(`screenPageRawCounts`·`pdfPageRawCounts`), 제외한 사설 영역 글자 수
(`screenPagePrivateUseCounts`·`pdfPagePrivateUseCounts`·`excludedPrivateUse`), ASCII 숫자 수(`screenPageDigitCounts`·
`pdfPageDigitCounts`·`digits`)를 함께 남기고, 화면보다 PDF에서 숫자가 적은 페이지가 있거나 필수 문자열(fixture 옆
manifest의 `requiredPdfText` 또는 `HAN_FLOW_PDF_REQUIRED_TEXT` JSON 배열)이 PDF 텍스트에 없으면 실패합니다. 사설 영역
글자도 code point별로 비교해(`privateUseLosses`), PDF에서 빠진 글자가 한컴·기호 글꼴 PUA 표시 대체 표에 있고 PDF에 대체 문자가 있거나
이유와 함께 허용 목록(manifest `allowedPrivateUseLoss` 또는 `HAN_FLOW_PDF_ALLOWED_PUA`)에 있을 때만 통과합니다. PDF 제목과
기본 파일 이름이 문서 이름인지도 확인하며, `verify:matrix`는 표지·목차·본문 서식 fixture(`report-toc`)에 이 PDF 검증을
함께 실행합니다.

HWPX 화면은 rhwp가 한/글 PDF와 대조해 의미를 확인한 한컴 PUA 기호 표(MIT, `THIRD_PARTY_NOTICES.md`)에 있는 글자만
표준 Unicode로 바꿔 그립니다(예: U+F03DA → □). 바꾼 글자는 PDF에서도 추출됩니다. 원문·편집 입력 칸·저장 bytes는 원래
글자를 유지하고, 표에 없는 PUA는 그대로입니다. 원 숫자 ③ 자리(U+F028B)는 rhwp 표가
근거 문서를 찾지 못해 일부러 빼 두었으므로 Han-Flow 표에도 없습니다. 기호 글꼴(Wingdings) 사설 영역 글자(U+F020–U+F0FF,
예: U+F0E8 → ➔)는 rhwp(`@rhwp/core` 0.7.19)가 HWP 쪽 SVG에 그리는 것과 같은 표(MIT)로 HWP 쪽 글자 층(선택·검색·복사)과
HWPX 화면에 표준 기호로 보입니다.

`fixture:v3-windows`는 Windows 한/글 외부 승인에 사용할 공개 original·identity·일반 문단
편집본·표 셀 편집본·A4 문서와 SHA-256 검사 스크립트를 `artifacts/v3-windows/`에 만든다.
`release:audit`는 현재 macOS app의 target·Developer ID 준비 여부·도구·서명·architecture를
읽기 전용으로 진단한다. 기본 실행은 blocker를 보고만 하며 `-- --strict`를 붙이면 blocker가
있을 때 실패한다.

전체 RC 관문은 private reference HWPX 경로를 받아 test, package, HWPX/HWP 공개 matrix,
실사용 문서 smoke test와 PDF 검증을 순서대로 실행합니다.

```bash
npm run release:check -- /path/to/private-reference.hwpx
```

성능·메모리와 parser 비교 명령:

```bash
npm run benchmark:app -- /path/to/document.hwp
npm run benchmark:memory -- /path/to/document.hwp
xvfb-run -a npm run benchmark:edit-latency
HAN_FLOW_EDIT_LATENCY_MODE=bold xvfb-run -a npm run benchmark:edit-latency
npm run measure:package -- /path/to/v1/Han-Flow.app
npm run probe:hwp -- /path/to/document.hwp
npm run probe:hwp -- /path/to/document.hwp \
  --hwpx /path/to/reference.hwpx \
  --pdf /path/to/reference.pdf
```

`benchmark:edit-latency`는 합성 large-progressive(약 15,000쪽)에서 한 글자 입력부터 화면 반영까지를 재고, `bold`
mode는 [굵게]·[실행 취소]를 번갈아 눌러 글자 모양 변경 뒤 측정 DOM을 다시 재고 쪽을 다시 나눌 때까지와 다시 잰 section 수를
냅니다. 글자·문단·셀 모양 command는 바뀐 모양을 쓰는 section만 다시 잽니다(측정 p50 약 380ms → 약 39ms, 80 section → 1).

검증 명령은 본문 대신 페이지·구조 count, 비공백 문자 수, timing과 안정적인 오류 코드만
출력합니다. 임시 visual state와 Electron user-data는 검증 종료 후 삭제합니다.

## 저장소 구조

```text
src/
├── main/          # 창·파일 열기, 경로 허용목록, DocumentImporter, 편집 session, IPC와 PDF 출력
├── core/
│   ├── parser/    # HWPX source package 보존과 ordered XML decoder
│   ├── document/  # ViewerDocument, FixedPageDocument와 import 계약
│   ├── fonts/     # 시스템 글꼴 해석과 대체 진단
│   └── layout/    # 페이지·표 분할과 단위 변환
└── renderer/      # React flow/fixed-page renderer와 공통 viewer UI
tests/             # 공개 synthetic fixture 기반 회귀 테스트
scripts/           # 성능, 앱·PDF·라이선스 검증과 parser probe
docs/              # 아키텍처, 전략, ADR, 기준선과 검증 이력
```

## 문서

- [제품 비전과 V1–V4 로드맵](docs/vision_and_roadmap.md)
- [장기 완성도 로드맵, V·Sprint 대응과 품질 관문](docs/long_term_roadmap.md)
- [기술 아키텍처](docs/architecture.md)
- [파싱 전략](docs/parsing_strategy.md)
- [V3 HWPX 편집 조사와 구현 전략](docs/v3_editing_strategy.md)
- [표 셀 병합·분할 구현 전략](docs/table_merge_split_strategy.md)
- [편집 코어 tree 모델 전환 계획](docs/editing_core_refactor_plan.md)
- [공개 호환성 corpus 전략](docs/public_corpus_strategy.md)
- [HWP/HWPX 오픈소스 참고 프로젝트 검토](docs/open_source_reference_review.md)
- [V3 macOS 한국어 IME 수동 검증 matrix](docs/v3_ime_manual_matrix.md)
- [다음 작업](docs/next_steps.md)
- [V3 Windows 한/글 재열기 matrix](docs/v3_windows_round_trip_matrix.md)
- [V4 macOS 배포 조사와 구현 전략](docs/v4_release_strategy.md)
- [V2 HWP 5.0 조사와 도입 전략](docs/hwp_v2_strategy.md)
- [HWP parser bake-off](docs/hwp_v2_bakeoff.md)
- [ADR-0001: HWP parser와 renderer 역할](docs/adr/0001-hwp-parser-roles.md)
- [V1 기준선](docs/v1_baseline.md)
- [글꼴 전략과 라이선스 판단](docs/font_strategy.md)
- [Release Candidate 체크리스트](docs/release_checklist.md)
- [개발·검증 이력](docs/verification_history.md)
- [변경 기록](CHANGELOG.md)

## HWP 5.0 규격 고지

본 제품은 한글과컴퓨터의 한/글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

Han-Flow는 한글과컴퓨터와 제휴하거나 한글과컴퓨터의 보증을 받은 제품이 아닙니다.

## 라이선스

Han-Flow는 [Apache License 2.0](LICENSE)으로 배포합니다. HWP parser를 포함한 배포 고지는
[Third-Party Notices](THIRD_PARTY_NOTICES.md)에 기록합니다.
