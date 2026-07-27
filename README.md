# Han-Flow

<p align="center">
  <img src="build/icon.png" width="160" alt="Han-Flow 앱 아이콘" />
</p>

macOS에서 한글 문서를 빠르게 열어 읽고 PDF로 내보내는 도구입니다. 현재 V1은 HWPX 읽기
전용이며, V2에서 HWP 5.0 열기, V3에서 편집을 추가합니다. 상용 편집기를 복제하기보다 실제로
매주 쓸 수 있는 작고 안정적인 도구를 목표로 합니다.

현재 버전은 **1.0.0-rc.1**입니다. 로컬 실사용과 unsigned beta 기준의 v1 기능은 완성됐으며,
V4 전까지 개인용으로 검증합니다. 공개 배포, Developer ID 서명과 Apple notarization은 V4에서
진행합니다.

## v1 목표

- Finder에서 HWPX 파일을 열어 1초 안에 첫 화면 표시
- 문단·글자 스타일, 표, 이미지, 머리말·꼬리말과 쪽 번호를 읽기 좋게 렌더링
- 화면과 같은 페이지 구조로 PDF 내보내기
- 대형 문서의 worker 기반 점진 파싱과 페이지 가상화

편집 기능은 v3 이후 범위입니다. `.hwp` 5.0 바이너리 직접 파싱은 하지 않으며 v2에서 기존
파서 활용을 검토합니다. 한컴오피스와 픽셀 단위로 같은 결과도 목표로 하지 않습니다.

## 로드맵

- **V1 — HWPX 뷰어:** 로컬 RC 완료. 열기, read-only 렌더, 점진 로딩, PDF와 macOS UX
- **V2 — HWP 5.0 읽기:** 기존 parser를 adapter로 검증·채택하고 같은 viewer/PDF 경험에 연결
- **V3 — 편집:** 한글 IME, undo/redo와 무손실 저장을 별도 품질 관문으로 개발
- **V4 — 배포:** 서명·공증, 업데이트, 개인정보 없는 호환성 corpus와 사용자 배포

V2는 공개 HWP 5.0 레코드를 처음부터 다시 구현하지 않습니다. 현재 `@rhwp/core`의
WASM/page SVG 경로를 fixed-page 주 후보로 앱에 연결했고, `kordoc`의 TypeScript semantic
IR은 비교 oracle로 남겼습니다. 최종 채택은 PDF·메모리·패키지 크기 관문 뒤 확정합니다.
근거와 전체 실험 계획은 [V2 HWP 5.0 조사와 도입 전략](docs/hwp_v2_strategy.md)에 있습니다.

## 현재 상태

OWPML의 XML 자식 순서를 보존해 읽기 전용 문서 모델로 변환하고, HWPUNIT 기반 페이지에
문단·표·병합 셀·테두리·배경·이미지·목록·구역별 머리말/꼬리말/쪽 번호를 렌더링합니다.
현재 글꼴로 실제 block·표 행 높이를 재는 2-pass pagination과 macOS `open-file`,
single-instance 전달, 드래그앤드롭, 트랙패드 핀치 줌, PDF 출력도 연결되어 있습니다.

실사용 AIDA 기준 문서는 production 패키지에서 8페이지, 이미지 4개, 페이지 overflow 0으로
검증했습니다. 첫 실행은 약 0.6초, 실행 중인 앱으로 다시 열기는 약 0.1초였습니다. 원문에서
보이는 텍스트는 기준 PDF 6,077자 중 6,076자가 일치하며 남은 한 글자는 화면에 보이지 않는
채움 문자입니다.

표 셀의 여러 문단은 현재 글꼴로 측정한 높이를 기준으로 페이지 사이에서 continuation 행으로
나눕니다. 공개 15문단 HWPX에서 반복 헤더, 8+7 문단 분배, 뒤쪽 표 위치와 overflow 0을
검증했습니다. 세로 병합 셀이 있는 표와 문단 하나가 페이지보다 큰 경우는 내용 보존을 우선해
행 단위 fallback 또는 overflow 진단을 사용합니다.

현재 v1 핵심인 열기·read-only 렌더·점진 로딩·PDF 출력과 macOS 로컬 UX는 구현되어 있습니다.
정확도 후속 과제는 대체 글꼴 metric과 한 문단 내부의 줄 단위 페이지 분할입니다. V4 전에는
개인용 패키지로 사용하며, 편집은 V3 범위입니다.

V2 실험 경로에서는 `.hwp`도 Finder 인자, 열기 대화상자와 드래그앤드롭으로 받을 수 있습니다.
main process는 200 MiB 제한과 CFB magic만 검사하고, renderer의 `@rhwp/core` WASM이 페이지
정보를 만든 뒤 첫 페이지 SVG를 우선 표시하고 나머지 페이지를 이어서 렌더링합니다. SVG는
script·event handler·외부 resource를 거부하고 blob image 경계로 표시합니다. 별도로 좌표가
있는 텍스트 run을 React text layer로 만들어 `⌘F` 검색, 하이라이트, 텍스트 선택과 페이지
접근성 label을 제공합니다.

AIDA HWP는 production build에서 7페이지, 3구역, 세로/가로 용지와 overflow 0을 확인했습니다.
텍스트 layer는 비공백 6,074자를 보존해 기준 PDF 6,077자와 3자 차이이며, 패키지 앱에서 검색
4페이지·6건과 6개 하이라이트를 자동 검증했습니다. 첫 페이지 우선 렌더링을 적용한 패키지 앱
20회 기준 첫 화면은 warm p50/p95 81/125ms, cold p50/p95 604/683ms이고 cold 최악값도
707ms로 1초 목표를 통과했습니다.

HWP PDF는 페이지별 CSS named page와 `preferCSSPageSize`를 사용해 한 파일 안의 세로·가로
용지 크기를 그대로 보존합니다. AIDA HWP 출력은 7페이지 중 5페이지만 가로 용지이며, Poppler
텍스트 추출 99.08% 보존과 세로·가로 대표 PNG의 잘림·겹침 없음을 확인했습니다. 같은 PDF
경로로 기존 AIDA HWPX 8페이지와 페이지별 글자 수도 계속 일치합니다.

AIDA를 cold 5회 실행해 Electron 4개 프로세스의 working set을 50ms 간격으로 합산한 결과,
HWP 전체 렌더 peak는 p50/p95 580.9/589.6MiB, HWPX는 436.8/438.3MiB였습니다. shared page가
프로세스별로 중복 집계될 수 있어 실제 고유 물리 메모리가 아니라 같은 환경의 회귀 기준으로
사용합니다.

V1 RC `cd8050d`를 lockfile 그대로 재패키징해 비교한 결과 현재 앱의 논리 크기 증가는
6.96MiB(+2.19%)입니다. renderer build asset과 production dependency에 WASM이 중복되던
13.92MiB 증가를 제거했고, `@rhwp/core` MIT 라이선스는 앱 resources에 별도로 포함합니다.

남은 주요 차이는 원문 글꼴이 없는 Mac에서 대체 글꼴 폭에 따라 줄바꿈과 페이지별 콘텐츠 분배가
달라지는 점입니다. 함초롬체는 제3자 앱 재배포 권한이 확인되지 않아 번들하지 않고, 시스템
설치본의 한글·영문 family 이름을 찾아 사용합니다. OFL Noto Serif KR 번들도 실험했지만 페이지
분배가 개선되지 않아 채택하지 않았습니다. 자세한 결정은
[글꼴 전략](docs/font_strategy.md)을 참고하세요.

## 개발

Node.js와 npm이 필요합니다.

```bash
npm install
npm run dev
```

검증과 macOS용 비서명 앱 패키징:

```bash
npm test -- --runInBand
npm run build
npm run package:mac
npm run benchmark:app -- /path/to/document.hwpx
npm run benchmark:app -- /path/to/document.hwp
npm run benchmark:memory -- /path/to/document.hwp
npm run benchmark:memory -- /path/to/document.hwpx
npm run measure:package -- /path/to/v1/Han-Flow.app
npm run verify:app -- /path/to/document.hwpx
npm run verify:app -- /path/to/document.hwp
npm run verify:matrix
npm run verify:pdf -- /path/to/document.hwpx
npm run release:check -- /path/to/private-reference.hwpx
npm run probe:hwp -- /path/to/document.hwp
npm run probe:hwp -- /path/to/document.hwp --hwpx /path/to/reference.hwpx
npm run probe:hwp -- /path/to/document.hwp --hwpx /path/to/reference.hwpx --pdf /path/to/reference.pdf
```

패키지는 `release/mac-arm64/Han-Flow.app`에 생성됩니다. 현재 개인용 검증 빌드로 서명·공증되지
않았으며, 전용 아이콘은 적용되어 있습니다. 서명과 notarization은 V4 배포 관문입니다.

`benchmark:app`은 패키지 앱을 사용해 같은 프로세스의 warm open 20회와 새 프로세스의 cold
open 20회를 측정하고 `열기 → 첫 paint` p50/p95를 출력합니다. 입력 문서의 본문은 출력하지
않으며 먼저 `npm run package:mac`을 실행해야 합니다.

`benchmark:memory`는 격리된 cold 패키지 앱을 기본 5회 실행하고, 안정된 전체 페이지 렌더까지
Electron process working set 합계를 50ms 간격으로 측정합니다. 파일명과 본문은 출력하지
않습니다. `measure:package`는 V1 기준 앱과 현재 앱의 logical bytes·`app.asar` 크기를 비교하고
rhwp WASM 중복 포함 여부도 검사합니다.

`verify:app`은 격리된 user-data로 패키지 앱을 열어 페이지 생성, 이미지 decode, background
loading 완료와 overflow 0을 자동 판정합니다. HWP에는
`HAN_FLOW_VERIFY_SEARCH_QUERY=<query>`를 함께 주어 검색·하이라이트·선택·접근성 layer까지
검증할 수 있습니다. 본문 문자열 대신 페이지별 비공백 글자 수와 숫자 통계만 출력하며 임시
상태 파일은 종료 시 삭제합니다.

`verify:matrix`는 기본 표·이미지, 15문단 continuation, 80-section 대형 progressive 공개
fixture를 임시 생성해 production 앱으로 연속 검증합니다. 대형 fixture는 전체 페이지와 실제
mount 페이지 수를 비교해 page virtualization 적용도 확인합니다.

`verify:pdf`는 HWP/HWPX production 앱이 출력한 PDF를 Poppler로 다시 열어 화면/PDF 페이지
수, 페이지별 용지 크기와 글자 보존을 비교하고 첫·중간·끝·가로 페이지를 PNG로 재렌더링합니다.
`release:check`는 전체 테스트, 패키징, 공개 matrix, private 앱 smoke test와 PDF 검증을
순서대로 실행하는 최종 RC 관문입니다.

`probe:hwp`는 V2 후보인 `kordoc`과 `@rhwp/core`를 앱 경로와 독립된 process에서
비교합니다. 파일명·본문·SVG는 출력하지 않고 HWP version과 보안 flag, 구조·페이지 count,
페이지별 비공백 글자 수와 timing만 기록합니다. `--hwpx`를 주면 현재 Han-Flow decoder의
section·문단·표·cell·이미지 기준과 delta도 함께 계산합니다. Kordoc 최소 adapter는 AIDA의
section 3개, semantic text 6,053자와 이미지 resource 2개를 정확히 보존했지만 문단·표와 layout
정보가 부족해 단독 renderer가 아닌 semantic 보조 후보로 좁혀졌습니다. `--pdf`를 함께 주면
본문을 출력하지 않고 rhwp SVG와 기준 PDF의 페이지 그룹·문자 보존율을 비교합니다. 현재 결과는
[HWP V2-0 parser bake-off](docs/hwp_v2_bakeoff.md)에 있습니다.

macOS 문서 연결은 확장자 기반 HWP Viewer 선언과 Han-Flow의 `com.hanflow.hwpx`, 기존 한컴 제품이 등록하는
`com.haansoft.hancomofficeviewer.mac.hwpx`를 모두 Viewer 대상으로 선언합니다. 앱은 사용자의
기본 앱 설정을 자동으로 변경하지 않습니다.

## 구조

```text
src/
├── main/          # macOS 파일 열기, worker, IPC, PDF 출력
├── core/
│   ├── parser/    # HWPX package와 ordered XML 해석
│   ├── document/  # flow ViewerDocument와 HWP FixedPageDocument
│   ├── fonts/     # 시스템 글꼴 해석과 대체 진단
│   └── layout/    # 페이지·표 분할과 단위 변환
└── renderer/      # React flow/fixed-page 렌더러와 공통 뷰어 UI
tests/             # 공개 synthetic fixture 기반 회귀 테스트
docs/              # 아키텍처, 파싱 전략, 기준선과 실험 기록
```

실사용 fixture와 캡처에는 개인정보가 포함될 수 있어 저장소에 넣지 않습니다. 공개 테스트는
실행 시 결정적으로 생성되는 synthetic HWPX를 사용합니다.

## 문서

- [기술 아키텍처](docs/architecture.md)
- [파싱 전략](docs/parsing_strategy.md)
- [V2 HWP 5.0 조사와 도입 전략](docs/hwp_v2_strategy.md)
- [HWP V2-0 parser bake-off 결과](docs/hwp_v2_bakeoff.md)
- [제품 비전과 V1–V4 로드맵](docs/vision_and_roadmap.md)
- [v1 기준선과 구현 현황](docs/v1_baseline.md)
- [글꼴 전략과 라이선스 판단](docs/font_strategy.md)
- [v1 Release Candidate 체크리스트](docs/release_checklist.md)
- [변경 기록](CHANGELOG.md)

## HWP 5.0 규격 고지

본 제품은 한글과컴퓨터의 한/글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

Han-Flow는 한글과컴퓨터와 제휴하거나 한글과컴퓨터의 보증을 받은 제품이 아닙니다.

## 라이선스

Han-Flow는 [Apache License 2.0](LICENSE)으로 배포합니다.
