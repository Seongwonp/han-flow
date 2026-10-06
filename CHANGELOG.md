# 변경 기록

## Unreleased

### Sprint 0 재현성과 P0 방어

- ZIP entry 압축 해제를 선언 크기 기준으로 스트리밍 중 차단하고, 크기와 무관하게 모든 HWPX 디코딩을 decoder worker로 옮겨 요청(첫 section·background 전체)마다 heap 한도·wall-clock timeout·구조화된 오류 code 적용
- Node.js 22·npm 10 개발 계약과 Windows install/test/probe/build CI 추가
- Linux `dir` 패키지 target과 xvfb 패키지 앱 matrix·HWP·PDF E2E, unpacked 앱 artifact를 올리는 Linux CI 추가
- 단일 완료율을 폐기하고 capability별 외부 승인까지 추적하는 장기 로드맵 추가
- HWPX read-only와 editing 경로의 entry·경로·암호화·압축 해제 제한 통합
- Electron renderer sandbox와 명시적 context isolation 활성화
- 새 창과 navigation의 외부 protocol을 HTTPS로 제한하고 정책 단위 테스트 추가
- 미사용 `electron-updater` 제거와 ZIP/XML production dependency 안전 버전 갱신
- production dependency audit 0 vulnerabilities 검증
- main·core·renderer 독립 TypeScript typecheck와 Windows CI 관문 추가
- CFB FileHeader·nullable window·PDF dialog·editable union·InputEvent 타입 오류 정리
- XML depth·node·text·DOCTYPE 사전 검사와 실제 깊이 폭탄 HWPX 회귀 fixture
- 이미지 개수·byte·decoded dimension·pixel budget과 dimension 폭탄 HWPX 회귀 fixture
- `BinData` resource를 순차적으로 읽어 일시적인 병렬 메모리 할당 제거
- production 진입점 기준 [legacy inventory](docs/legacy_inventory.md) 작성
- 손실성 초기 parser·normalization·renderer-engine·Zustand store와 구형 shared 타입 제거
- 미사용 `zustand`·`katex`·`@types/katex`·`react-icons` dependency 제거
- Windows x64 production `dir` package 명령과 OS별 V3 acceptance bundle 생성 지원
- OS별 글꼴 대체 체인(Windows 맑은 고딕 우선, 바탕은 한국어 보조 글꼴 설치 시)과 한/영 family alias, 미설치 시 CSS generic fallback, 글꼴 목록 실패 시 Windows는 맑은 고딕만 반환(자동 테스트 기준, Windows 실기 검증 대기)
- EOL Electron 28.3.3을 Electron 44.4.5(Chromium 152·Node 24)로 올리고 drag-and-drop `File.path` 제거를 `webUtils.getPathForFile`로, 대화상자 Downloads 기본 폴더 변경을 마지막 폴더 기억으로 대응
- Electron 44 요구사항에 맞춰 macOS 패키지 `minimumSystemVersion`을 13.0으로 지정
- OS 파일 열기 경로를 포커스된 창(없으면 최근 창·새 창)으로 전달하고 대화상자를 요청한 창에 연결, `document:import`·`editing:start`는 main이 건넨 경로와 끌어 놓은 일반 문서 파일만 창별 허용목록(실제 경로 비교)으로 받으며 미사용 `dialog:openImage` 제거

### Sprint 4 호환성 corpus

- 한/글 저장본 공개 테스트 HWPX 26종(hwpxlib·python-hwpx, Apache-2.0)을 sha256·출처와 함께 external corpus로 반입, 전부 열림
- 실제 한/글 HWPX용 `source: file` manifest(sha256·출처·라이선스·`personalData: false`)·catalog `external` provenance·`corpus:intake` helper와 확보 계획 추가
- 편집 가능 비율 측정 `corpus:editing-coverage`(run·문단·표 셀·표 구조별 capability와 patch dry-run, 거부 사유 histogram)와 기준선 추가: 외부 26종 text 편집 79.5%·글자 가중 89.3%(빈 `<hp:t/>`·표 셀 text 해제 후 89.8%·92.8%)

### Sprint 5 Windows 배포 후보

- 결정적 `icon:ico` 생성기와 비서명 x64 NSIS 설치본 target(한국어·설치 경로 선택·파일 연결), Windows CI의 패키지 앱 matrix·HWP·PDF E2E와 설치본·unpacked artifact 업로드 추가
- PDF 저장 대화상자 기본 이름을 `문서.pdf` 대신 열린 문서 이름(Windows 금지 문자 정리)으로, PDF 제목을 `Han-Flow` 대신 문서 이름으로 바꾸고 창 제목을 `<파일 이름> - Han-Flow`로 표시(Windows 경로 구분자에서 툴바가 전체 경로를 보이던 문제 포함)
- 모든 편집 control이 `홈` 탭 하나에 있던 리본을 `파일`·`편집`·`서식`·`표`·`보기` 탭으로 나누고 확대/축소·열기·PDF를 리본으로 옮김(편집 중 기본 `서식`, 표 안 caret은 탭 전환 없이 `표` 탭 표시, WAI-ARIA tabs 키보드 이동)
- HWPX XML 본문의 숫자처럼 보이는 글자(`1.`·`2017.`·`007`)를 숫자로 바꿔 목차 번호·날짜의 점을 잃던 문제 수정, 화면·PDF 글자 수 비교를 code point 단위로 하고 PDF로 추출되지 않는 사설 영역 글자를 제외, 표지·목차 보고서 합성 fixture와 matrix PDF 검증 추가
- 내어쓰기(음수 `hc:intent`) 문단의 첫 줄을 CSS `text-indent`로 왼쪽 여백 밖까지 당겨 PDF에서 문단 앞부분이 용지 밖으로 잘리던 문제를 첫 줄은 왼쪽 여백·둘째 줄부터 들임으로 고치고, HwpUnitChar `hp:case` 밖(한/글 2018 저장본의 직접 `hh:margin`·`hp:default`) 문단 여백·간격이 HWPUNIT 2배로 저장된 것을 반영(읽기 절반·쓰기 2배), 내어쓰기 합성 fixture·matrix PDF 비교·용지 밖 글자 E2E 검사 추가
- 보도자료 머리 표처럼 좁은 가운데 정렬 셀의 내어쓰기가 셀 안쪽 폭보다 커서 `배포`가 왼쪽 날짜 셀 끝과 겹치던 문제를 셀 안쪽 폭 안으로 내어쓰기를 줄여 수정, 합성 fixture에 머리 표와 표 셀 밖 글자 E2E 검사 추가

### V3 HWPX 편집 기반

- 과거 editor store·normalized model·serializer와 저장 IPC 감사
- KS X 6101·HWPX package, IME event, transaction과 안전 저장 1차 출처 조사
- source package·editable model·viewer projection 분리 전략
- loss report, 한국어 IME matrix와 단계별 round-trip 품질 관문
- 모든 HWPX entry의 bytes·compression·CRC를 보존하는 `HwpxSourcePackage`
- path traversal·duplicate·encrypted entry·압축 해제 크기 제한
- unknown XML·binary 공개 fixture와 entry SHA-256 identity round-trip
- 저장소 밖 실사용 HWPX의 privacy-safe identity 검증
- 잘못된 mimetype과 package 손실을 만들던 과거 serializer·저장 IPC 제거
- source span 기반 단일 `hp:t` text patch와 inverse command
- XML entity·공백·빈 node·Unicode boundary 검증
- preserved/modified entry와 Preview 상태를 구분하는 `LossReport`
- 임시 파일 flush·재개봉·viewer 검증 후 새 목적지에만 commit하는 Save As 코어
- 저장소 밖 실사용 HWPX 한 text patch·Save As와 원본 hash 불변 검증
- 여러 text command의 원자적 transaction과 역순 inverse
- transaction 결과의 기존 `ViewerDocument` projection 재생성
- snapshot 없는 100 entries·8 MiB bounded undo/redo history
- input type·selection·anchor·시간·composition 기반 typing grouping
- logical savepoint·dirty, undo branch와 redo 폐기
- 저장소 밖 실사용 HWPX transaction·undo·redo·Save As 검증
- source anchor 기반 `ApplyCharacterStyleCommand`와 `ApplyParagraphStyleCommand`
- 원본 style clone, 동일 definition 재사용과 결정적 style ID allocation
- `charProperties`·`paraProperties` item count와 section reference 원자적 변경
- 굵게와 문단 정렬 4종의 제한된 toolbar, `⌘B`와 selection 동기화
- style definition·reference를 함께 복원하는 undo/redo와 실사용 HWPX Save As 재열기 검증
- 단일 `hp:t` 부분 선택을 좌·선택·우 run으로 분할하는 글자 style command
- XML entity 의미와 선택 방향을 보존하는 새 source anchor 이동
- 분할 fragment와 추가 style definition을 byte 단위로 복원하는 undo/redo
- 저장소 밖 HWPX의 부분 선택·저장·재열기 E2E 관문
- 일반 표 body cell의 단일 문단·단일 run 텍스트 입력 surface
- 반복 머리글·병합·rowSpan·continuation cell의 중복 source anchor 편집 차단
- 공개 baseline 표 셀 undo/redo·Save As·재열기 검증
- 공개 HWPX matrix baseline에 표 셀 편집 release gate 추가
- 부분 style로 여러 run이 된 최상위 문단의 run별 입력 surface와 좌우 경계 이동
- style projection 뒤 stale DOM selection offset 방어와 run 수 변경 시 안전한 surface 재생성
- `ApplyCharacterStyleCommand`의 5–72pt 글자 크기와 `#RRGGBB` 글자색
- 글자 크기 증감·색상 선택 toolbar와 활성 source style 동기화
- Windows·Linux Ctrl 단축키(Ctrl+Y 포함)·tooltip 표기와 contentEditable 네이티브 undo/redo의 앱 history 우회(자동 테스트 기준, Windows 실기 검증 대기)
- 부분 글자 style·문단 정렬을 함께 적용한 package Save As·재개봉 통합 검증
- V3 자동 코드 관문 완료와 macOS 실제 두벌식·Windows 한/글 외부 승인 matrix 분리
- Save As를 같은 폴더 임시 파일로 쓰고, 새 파일은 hard link(목적지가 생기면 OS가 EEXIST로 거부)로, 교체를 확인한 기존 파일은 `rename`으로 원자적 게시하며 hard link 미지원 파일 시스템(exFAT·FAT32·일부 SMB)에서만 확인 후 `rename`으로 대체하고 열린 원본은 항상 거부(자동 테스트 기준, Windows 실기 검증 대기)
- 저장·PDF 파일 권한을 0o600 대신 umask를 적용한 기본값으로 게시하고, PDF 내보내기도 편집 중인 원본·심볼릭 링크 목적지를 PDF 전용 안내와 함께 거부
- 개발 빌드의 Windows·Linux에서 메뉴 없이 F12·Ctrl+Shift+I로 DevTools 열기
- 한/글이 빈 입력 칸으로 저장하는 자기 닫힘 `<hp:t/>`를 빈 text anchor로 인정해 입력 시 `<hp:t>…</hp:t>`로 펼치고 undo는 원래 tag bytes로 복원, viewer decoder와 편집 tokenizer의 `hp:t` ordinal·text를 공개 corpus 전체에서 교차 검증
- 표 셀 text 편집을 구조 편집 조건에서 분리해 병합·머리글·여러 run 셀도 문단 하나 안에서 입력·삭제·치환 허용(행·열·병합·분할·셀 style·문단 나눔은 기존대로 일반 body 셀만, 쪽을 넘어 나뉜 셀 조각은 계속 읽기 전용)
- 편집 코어 tree 전환 1단계: 원문 범위를 보존하는 source tree와 serializer로 text 입력·삭제·치환을 옮기고(출력 bytes는 전환 전과 동일, 공개 corpus identity·differential 관문), package별 tree cache로 대형 section 입력 비용을 keystroke당 약 4.1ms에서 1.2ms로 단축
- 텍스트 편집이 `hp:t`에서 바뀐 범위의 text node만 다시 써 inline `hp:tab`의 폭·채움 attribute, 비표준 entity 표기, 원문 CR/LF를 보존하고(빈 편집은 byte 단위로 동일), undo는 지운 범위의 원문 표기까지 복원
- 편집 코어 tree 전환 2단계: 글자·문단·셀 모양 command를 section·header.xml source tree 연산으로 옮기고(공개 corpus 4,782 command differential에서 출력 bytes·inverse·오류가 전환 전과 동일, 다른 attribute 값 안의 이름·줄바꿈 값·분할 조각 entity 표기를 잘못 다루던 잠재 버그 수정), package 전체 tree cache로 대형 문서의 굵게 toggle 비용을 약 6.3ms에서 1.5ms로 단축
- 편집 코어 tree 전환 3단계: 문단 분할(Enter)·경계 병합(Backspace·Delete)·여러 문단 범위 치환을 source tree로 옮겨 경계 `hp:t`의 inline `hp:tab` 폭·채움 attribute와 entity 표기를 보존하고(기본 표기 문단은 전환 전과 bytes·inverse·오류 동일, `hp:linesegarray`는 새로 만든 문단에서만 제거), 대형 section의 Enter+Backspace 비용을 약 18.9ms에서 5.4ms로 단축
- 편집 코어 tree 전환 4단계: 표 행·열 추가/삭제와 1×2 셀 병합·분할을 source tree로 옮기고(공개 corpus 401 command differential에서 오류·표 fragment·selection·bytes·inverse가 전환 전과 동일, CDATA·다른 attribute 값 안의 이름·문자 참조 주소를 잘못 읽고 둘째 문단에 줄 배치 정보가 있는 병합 셀 분할에서 잘못된 XML을 쓰던 잠재 버그 수정), 큰 표의 행 추가+실행 취소 비용을 약 6.0ms에서 4.0ms로 단축
- 편집 코어 tree 전환 정리: legacy 문자열 구현 4개와 정규식 attribute·`replaceRange`·`scanXmlElements`·CDATA `as-tag` scanner 경로를 제거하고, legacy differential을 공개 corpus 1,842 case의 SHA-256 golden 회귀와 exact undo·redo 검사로 대체해 `npm test` 시간을 약 168s에서 45s로 단축
- HWPX entry CRC-32를 byte 단위 JS 구현에서 Node 내장 `zlib.crc32`로 교체(없으면 JS 구현으로 대체, 모든 공개 fixture entry와 무작위 buffer에서 값 동일)해 대형 section 입력 비용을 keystroke당 약 1.1ms에서 0.3ms로, Enter+Backspace를 약 3.9ms에서 2.2ms로 단축
- 최상위 표의 셀(병합·머리글 셀 포함) 직속 문단에 글자 모양(굵게·기울임·밑줄·취소선·크기·색·글꼴, 부분 선택 run 분할 포함)과 문단 모양(정렬·줄 간격·앞뒤 간격·첫 줄 들여쓰기)을 허용하고 ribbon·단축키를 같은 capability로 열기(셀 안 표와 머리말·글상자는 계속 거부, 외부 26종 글자 모양 46.9% → 78.2%·문단 모양 49.4% → 79.1%)
- `hp:t`가 없는 빈 문단·빈 셀(`<hp:run/>`, 구역 정의만 든 첫 문단, run 없는 `<hp:p/>`)에 `#hp:p:N:empty` 합성 caret anchor를 두고 첫 입력 때 한/글 저장 방식대로 `hp:t`(필요하면 문단 style 글자 모양의 run)를 만들며 undo는 원래 bytes 복원, selection은 새 `hp:t` anchor로 이동(외부 26종 빈 문단 44/46·표 셀 49/66 → 66/66·문단 모양 79.1% → 90.2%)

### V2 HWP fixed-page

- HWP 페이지별 세로·가로 용지 크기를 보존하는 PDF 출력
- HWP PDF 페이지 크기·텍스트 보존·가로 페이지 PNG 자동 검증
- 기존 HWPX 화면/PDF 페이지별 글자 수 회귀 관문 유지
- HWP/HWPX cold peak working set과 V1 대비 package 증가량 측정
- 중복 rhwp WASM 제거와 MIT license resource 포함
- rhwp 파싱·페이지 처리를 전용 Web Worker로 분리
- 새 문서 열기 취소, Worker 강제 종료형 timeout과 crash 오류 격리
- Worker 격리 후 HWP cold/warm 20회 첫 화면 p95 614/237ms 검증
- Worker 격리 후 HWP cold 5회 aggregate working set peak p95 647.6MiB 기록
- ADR-0001에서 rhwp production visual engine과 kordoc development oracle 역할 확정
- HWP parser MIT 원문과 third-party notice를 production package에 포함
- package license·notice 원문 일치를 release gate에서 자동 검증
- 개인정보 없는 2쪽 HWP fixture와 결정적 SHA-256 manifest
- kordoc 구조 oracle·rhwp SVG·패키지 앱·PDF를 잇는 `verify:hwp-matrix`
- PDF 출력 전 모든 fixed-page SVG decode를 기다려 마지막 페이지 누락 race 수정
- 저장소 밖 실사용 HWP의 화면·PDF 텍스트 보존 재검증
- HWP CFB·FileHeader signature·5.x version main-process preflight
- 암호·배포용·DRM·비지원 version·손상 HWP 구조화 오류 코드와 사용자 안내
- 공개 HWP 변형 5종의 production 오류 E2E와 임시 저장소 정리 재시도
- 포트폴리오에 재사용할 수 있는 날짜별 검증 이력 문서
- HWP/HWPX를 하나의 `DocumentImporter`와 `document:import` IPC 계약으로 통합
- preload·React loader의 공통 성공·오류·background 완료 경계
- 항상 실패하던 과거 HWP CFB stream prototype 제거

## 1.0.0-rc.1 - 2026-07-23

Han-Flow의 첫 v1 Release Candidate다. macOS에서 HWPX를 빠르게 열어 읽고 같은 페이지 구조로
PDF를 내보내는 로컬 실사용 범위를 완성했다.

### 주요 기능

- ordered OWPML decode와 결정적 read-only 문서 모델
- 문단·글자 스타일, 표·병합 셀, 테두리·배경, 이미지 resource
- 머리말·꼬리말, 구역별 쪽 번호와 번호 재시작
- 실제 DOM 높이를 사용하는 2-pass pagination
- 표 셀 문단 continuation과 반복 header
- worker 기반 점진 decode와 50페이지 초과 page virtualization
- Finder 더블클릭, single-instance, drag-and-drop
- dark mode chrome, 트랙패드 pinch zoom, PDF 내보내기
- production 앱·PDF·공개 fixture 자동 검증
- background decode와 DOM measurement 완료를 기다리는 안정된 E2E 상태 수집

### 검증 기준

- 저장소 밖 실사용 HWPX: 페이지·이미지 보존과 overflow 0
- 실사용 HWPX PDF: 화면과 페이지별 글자 수 일치
- 공개 호환성 matrix: 기본, continuation, 이미지·rowSpan, 대형 progressive, 손상 package
- 대형 synthetic: 9,767페이지 중 DOM 12개 mount, overflow 0

### 알려진 제한

- 원문 글꼴이 없으면 대체 글꼴 metric으로 줄바꿈과 페이지별 분배가 달라질 수 있다.
- 한 문단 내부의 줄 단위 페이지 분할은 하지 않는다.
- 복잡한 `rowSpan`, 복수 overflow 셀과 단일 초대형 문단은 안전한 행 단위 fallback을 사용한다.
- `.hwp` 5.0 바이너리 직접 파싱과 편집은 v1 범위가 아니다.
- 현재 패키지는 서명·공증되지 않은 로컬 beta다.
