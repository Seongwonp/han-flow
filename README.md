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
- 동일 너비 `NEWSPAPER/LEFT` 다단의 단별 흐름 조판과 미지원 유형 fallback 진단
- 실제 DOM 높이를 사용하는 2-pass pagination
- 그대로 그리지 못하는 개체(수식·차트·OLE·글상자·도형·양식 컨트롤·동영상·각주/미주·메모·덧말)를 문단 흐름 안의
  읽기 전용 자리 표시로 표시하고, 수식 script·글상자 글·각주/미주 본문·메모 내용은 글자로 되살림. 상자 크기는 선언 크기를
  참고하되 쪽보다 크면 줄여 "(축소)"로 표시하며, 원본 위치(쪽·문단 기준 좌표, 글 앞·뒤 배치)·회전·쪽 배치와 개체 자체의
  그림(수식 조판, 차트·OLE·도형 그리기)은 재현하지 않음. 각주·미주 본문은 쪽 아래가 아니라 구역 끝에 모아 표시. 문서 안내
  배너·상태 막대와 PDF 내보내기 전 확인 대화상자로 개체 종류별 개수를 알림
- 긴 표 셀의 continuation 행과 반복 머리글
- 모든 HWPX를 heap·timeout 한도의 decoder worker에서 해석하는 점진 decode와 페이지 가상화
- 원본 `hp:t` source anchor 기반의 제한된 일반 문단·표 body cell 텍스트 편집
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

### 현재 재현 가능한 결과 (2026-09-28)

| 관문 | 결과 |
| --- | --- |
| Jest (`npm test -- --runInBand`) | 43 suites passed·2 skipped, 292 passed·12 skipped |
| parser probe (`npm run test:probe`) | 18 passed |
| 공개 HWPX corpus (`npm run verify:corpus`) | 39/39 (synthetic 11종 + 한/글 저장본 external 28종, invalid-package 1종 의도적 거부 포함) |
| 편집 가능 비율 (`npm run corpus:editing-coverage`, 정보용) | 외부 한/글 28종 373 run: anchor 95.7%·text 편집 89.8%·글자 가중 92.8%·표 셀 66/66·글자 모양 77.7%·문단 모양 90.2%·문단 나눔 270/399(capability·코어 불일치 0)·글자 칸 없는 빈 문단 44/46 (2026-09-29 79.5%·89.3%·45/66·45.0%·44.8%, [측정](docs/editing_coverage.md)) |
| 공개 fixture catalog | HWPX 9종·HWP 1종, core/production/HWP pipeline ID 연결 |
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
| large progressive | 15,003쪽 중 DOM 12개 mount |
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
| Sprint 4 — 호환성 corpus | 진행 중 | HWPX 9종·HWP 1종, intake 계약 완료·실제 파일 0종, 30–50종 목표 |
| Sprint 5 — Windows 배포 후보 | 진행 중 | 비서명 NSIS artifact, 실기·code signing 대기 |
| Sprint 6 — macOS 공개 배포 | macOS 하드웨어 대기 | macOS 13+ 실행, arm64 서명·공증·설치 |
| V4 — 사용자 배포 | 준비 중 | Sprint 5·6·7 |

단일 완료율은 범위와 검증 수준을 숨길 수 있어 공개 완료 판정으로 사용하지 않습니다.
기능은 코드, 공개 fixture, 실제 문서, 한/글 왕복과 OS별 검증을 순서대로 통과해야 완료입니다.

다음 구현은 `RIGHT`·`MIRROR`와 비동일 너비 다단 조판이며, 이어서 각주·미주와 수식의
읽기 전용 모델·fallback을 추가합니다.

V3에서는 과거 `contentEditable` prototype을 완성된 기능으로 간주하지 않습니다. 모든 HWPX ZIP
entry와 unknown XML·binary를 identity round-trip하는 source package, command·transaction,
bounded undo/redo와 savepoint·dirty 상태를 main-process 편집 session이 소유하고 renderer에는
제한된 IPC만 노출합니다. 변경본은 실제로 바뀐 구조(본문·글자 모양·문단 모양·문단 구조·표 셀
모양·표 구조), 보존 정책과 Preview 상태를 확인한 뒤 검증된 HWPX로 저장합니다. 원본과 열린 편집
session의 원본은 덮어쓰지 않으며, 다른 기존 파일은 저장 대화상자에서 교체를 확인한 경우에만
교체합니다. 저장하지 않은 상태에서 다른 문서를 열거나 창·앱을 닫으면 저장, 버리기, 취소 중
하나를 선택해야 합니다. 앱이 강제 종료되거나 편집 엔진이 중단되어도 저장하지 않은 편집은 사용자 app data 폴더의
복구 기록에 남아, 다음에 앱을 열거나 같은 문서를 열 때(엔진 중단은 바로) [복구]·[버리기]·[나중에]를 묻습니다.
`.hwp` 저장은 V3의 약속이 아닙니다.

## 알려진 제한

- HWPX 편집은 최상위 텍스트 문단과 일반 표 body cell의 단일 text run 문단을 지원합니다. 부분 style로
  나뉜 여러 run과 여러 최상위 문단은 키보드·pointer 범위 선택과 치환을 지원합니다.
- 머리글·병합(`rowSpan`·`colSpan`) 셀과 여러 run 문단이 있는 셀은 문단 하나 안에서 text 입력·삭제·치환과
  글자·문단 모양만 지원하고 구조·셀 모양 편집은 막습니다. 쪽을 넘어 나뉜 셀 조각(continuation fragment)과 머리말·꼬리말은
  읽기 전용입니다. 병합되지 않은 일반 body cell은 여러 문단의 단일 text run을 편집하고, 같은 cell 안에서
  문단을 가로지르는 범위 치환·Enter 분할·경계 Backspace/Delete 병합을 수행할 수 있습니다.
- 한/글이 빈 입력 칸으로 저장한 `<hp:t/>`에 입력하면 `<hp:t>…</hp:t>`로 펼치고, 실행 취소는 원래
  `<hp:t/>` bytes를 복원합니다.
- `hp:t`가 아예 없는 빈 문단·빈 셀(`<hp:run charPrIDRef="0"/>`, 구역 정의만 든 첫 문단, run 없는 `<hp:p/>`)도 caret을
  받습니다. 첫 입력이 그 run(또는 문단 style 글자 모양의 새 run)에 `hp:t`를 만들고, 실행 취소는 원래 bytes를 복원합니다.
  첫 글자를 넣기 전에는 문단 모양만 바꿀 수 있고 글자 모양, Enter 분할·Backspace/Delete 병합, 셀 모양·표 구조는
  막습니다. 빈 셀은 text 전용 셀로 다룹니다. 표만 든 문단과 머리말·꼬리말·글상자 안 빈 문단은 아직 입력할 수 없습니다.
- HWPX 동일 너비 `NEWSPAPER/LEFT` 다단은 공통 간격을 제외한 단 폭으로 다시 실측하고,
  `columnBreak`와 높이에 따라 왼쪽 단→오른쪽 단→다음 페이지 순서로 표시합니다. `PARALLEL`,
  `RIGHT`·`MIRROR`와 서로 다른 단 너비는 모델에는 보존하지만 단일 흐름 fallback diagnostic을 남깁니다.
- 글자 모양은 단일 `hp:t` 전체 또는 내부 부분 선택의 굵게·기울임·밑줄·취소선·크기·색상을 지원합니다.
  최상위 문단과 최상위 표의 셀(병합·머리글 셀 포함) 직속 문단에 적용하며, 셀 안에 다시 든 표와
  머리말·꼬리말·글상자 문단은 거부합니다.
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
- 현재 저장은 다른 이름으로 저장만 지원하며, 저장 대화상자에서 교체를 확인한 다른 기존 파일은 원자적으로 교체하지만 열려 있는 원본 문서 덮어쓰기는 항상 거부합니다. hard link를 지원하지 않는 파일 시스템(exFAT·FAT32·일부 SMB)에서는 새 파일 게시가 확인 후 rename으로 대체되어, 확인 직후 다른 프로그램이 같은 이름의 파일을 만드는 짧은 경쟁 구간이 남습니다.
- HWPX 편집 엔진은 창마다 별도 worker thread에서 실행되어 큰 문서를 편집·저장하는 동안에도 다른 창·메뉴·대화상자가 멈추지
  않습니다. 편집 처리 하나가 60초(편집 시작 120초, 저장 검증 180초)를 넘거나 메모리 한도(1.5 GiB)를 넘으면 편집 세션을
  끝내고 보기 모드로 돌아갑니다. 응답까지 받은 편집은 복구 기록에 남아 바로 복구를 묻고, 중단을 일으킨 그 요청 하나만 빠집니다.
  원본 문서는 바뀌지 않고, 저장 중에 중단되어도 반쯤 쓴 저장 파일이나 임시 파일을 남기지 않습니다.
- 저장하지 않은 편집의 복구 기록(`<userData>/recovery/<sessionId>/journal.hfj`)은 문서 bytes가 아니라 편집 command(입력한
  글자·XML 조각 포함)만 담고, 빠르게 입력하는 동안 0.5초마다 디스크에 내립니다. 그래서 앱 process가 강제 종료되거나 OS가
  꺼지면 마지막 약 0.5초의 입력은 잃을 수 있습니다(창 전환·저장·닫기 확인 직전에는 바로 내립니다). 복구는 편집을 시작할
  때의 원본 파일이 크기·수정 시각·SHA-256까지 그대로일 때만 하며, 원본을 고치거나 옮겼으면 복구하지 않고 기록을 보관하거나
  버리게 합니다. 기록이 64 MiB 또는 100,000단계를 넘으면 그 session의 기록을 멈추고, 손상되었거나 다시 적용하지 못한 기록은
  실행하지 않고 격리합니다. HWP(읽기 전용) 문서에는 해당하지 않습니다.
- 수식·차트·OLE·도형·글맵시·양식 컨트롤·동영상은 그림으로 그리지 않고(수식 조판·차트 그리기 없음) 선언 크기를 참고한
  테두리 상자(자리 표시)로 보여 줍니다. 선언 높이가 쪽 본문의 85%를 넘으면 같은 비율로 줄여 "(축소)"로 표시하고, 글상자 글도
  그 높이에 맞춰 줄입니다. 수식은 원문 script를 글자로, 글상자는 안쪽 글·그림을 상자 안에 보여 주지만 원본 위치(쪽·문단 기준 좌표,
  글 앞·뒤 배치)·회전·쪽 배치·선·채우기는 재현하지 않고 문단 흐름 안에 둡니다. 글 앞·뒤에 떠 있는 개체는 자리를 차지하지 않는
  작은 표시만 둡니다. 각주·미주 번호는 본문에 위 첨자로, 본문은 쪽 아래가 아니라 구역 끝에 모아 표시하고 목록이 길면 각주 사이에서
  다음 쪽으로 이어집니다. 메모는 본문 안
  작은 상자, 덧말은 ruby로 비슷하게 보여 줍니다. 자리 표시와 그 안 글은 읽기 전용이고 같은 문단의 일반 글자 편집 가능
  여부는 바꾸지 않으며, 원본 개체 bytes는 HWPX 저장 때 그대로 보존합니다. PDF에는 화면과 같은 자리 표시가 나옵니다.
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
manifest의 `requiredPdfText` 또는 `HAN_FLOW_PDF_REQUIRED_TEXT` JSON 배열)이 PDF 텍스트에 없으면 실패합니다. PDF 제목과
기본 파일 이름이 문서 이름인지도 확인하며, `verify:matrix`는 표지·목차·본문 서식 fixture(`report-toc`)에 이 PDF 검증을
함께 실행합니다.

HWPX 화면은 rhwp가 한/글 PDF와 대조해 의미를 확인한 한컴 PUA 기호 표(MIT, `THIRD_PARTY_NOTICES.md`)에 있는 글자만
표준 Unicode로 바꿔 그립니다(예: U+F03DA → □). 바꾼 글자는 PDF에서도 추출됩니다. 원문·편집 입력 칸·저장 bytes는 원래
글자를 유지하고, 표에 없는 PUA와 HWP(rhwp `@rhwp/core` 0.7.19 SVG) 화면은 그대로입니다.

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
npm run measure:package -- /path/to/v1/Han-Flow.app
npm run probe:hwp -- /path/to/document.hwp
npm run probe:hwp -- /path/to/document.hwp \
  --hwpx /path/to/reference.hwpx \
  --pdf /path/to/reference.pdf
```

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
