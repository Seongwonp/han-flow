# 개발 인계 문서

새 계정·새 기기·다른 AI 도구(Claude Code, Codex 등)에서 Han-Flow 개발을 이어 가기 위한 문서다.
처음이라면 이 문서 → [다음 작업](next_steps.md) → [아키텍처](architecture.md) 순으로 읽는다.

## 1. 프로젝트 한 줄 요약

Windows·macOS용 HWP/HWPX 데스크톱 뷰어 + **제한적 HWPX 편집기**(Electron). 원본 bytes를 최대한
보존하는 편집(lossless source tree)과 검증형 Save As가 핵심이다. HWP 5.0은 읽기 전용(`@rhwp/core` WASM).

## 2. 작업 규칙 (지금까지 지켜 온 것)

- **main에서 직접 작업**한다. branch·PR을 만들지 않는다. 끝나면 commit → push → CI 확인.
- commit 작성자는 저장소 소유자 계정(`Seongwon Park <swp4081@gmail.com>`). 저장소 `.git/config`에
  `user.name`/`user.email`이 설정돼 있는지 먼저 확인한다(`git config --local user.email`).
- commit·문서·코드 어디에도 AI 도구 이름(Claude 등)이나 co-author 줄을 넣지 않는다.
- commit 메시지는 한국어 한 줄(필요하면 본문에 `-` 목록). CHANGELOG.md에 commit마다 한 줄 추가.
- 문서·사용자 문구는 한국어. 코드 주석 밀도·스타일은 주변 코드를 따른다.
- 사용자 문서(실제 한/글 파일) 본문은 보고서·로그·commit에 옮기지 않는다. 실제 문서는
  `tests/fixtures/private/`(gitignore) 또는 저장소 밖에 둔다.
- test를 skip·비활성화해서 CI를 통과시키지 않는다. 불안정한 test는 원인을 찾아 고친다.

## 3. 환경 준비

- Node.js 22 이상(CI는 22, Electron 44 내장 Node 24), `npm ci`.
- Linux headless E2E: `xvfb`, `poppler-utils`(pdftotext·pdftoppm), `fonts-noto-cjk`. 컨테이너에서는
  `HAN_FLOW_NO_SANDBOX=1`.
- Windows: 일반 권한에서는 symlink 생성이 안 되므로 관련 test가 junction으로 대체하거나 건너뛴다.

## 4. 자주 쓰는 명령

| 목적 | 명령 |
| --- | --- |
| 개발 실행 | `npm run dev` |
| 타입 검사 | `npm run typecheck` |
| 단위·통합 test | `npm test` (CI는 `--runInBand`) |
| 스크립트 probe | `npm run test:probe` |
| 공개 corpus | `npm run verify:corpus`, `npm run corpus:editing-coverage` |
| 패키지(로컬) | `npm run package:linux` / `package:win` / `package:win:installer` / `package:mac` |
| 패키지 앱 E2E | `xvfb-run -a npm run verify:matrix` (약 35분), `verify:hwp-matrix` |
| 단일 문서 검사 | `node scripts/verify_app.mjs <file>`, `node scripts/verify_pdf.mjs <file>` |
| 입력 지연 | `npm run benchmark:edit-latency` (`HAN_FLOW_EDIT_LATENCY_MODE=bold`로 모양 편집) |
| 편집 golden 갱신 | `HAN_FLOW_UPDATE_GOLDEN=1 npx jest tests/editing/editing_golden.test.ts` (의도한 변경일 때만) |

패키지 앱 E2E는 `HAN_FLOW_E2E=1`과 `HAN_FLOW_VISUAL_*` 환경 변수로 앱을 조종한다(목록은
`src/main/index.ts`, 사용법은 `scripts/verify_app.mjs`).

## 5. 코드 지도

| 위치 | 역할 |
| --- | --- |
| `src/core/parser/` | HWPX ZIP·XML 읽기(`source_package`, `package_preflight`, `resource_budget`), 화면 모델 해석(`viewer_decoder`), section 단위 증분 projection(`viewer_projection`) |
| `src/core/document/` | 화면 문서 모델과 patch(`viewer_document`, `viewer_document_patch`), 개체 자리 표시, 한컴·기호 글꼴 PUA 표시 대체 |
| `src/core/layout/` | 쪽 나눔(`pagination`), 각주(`footnote_layout`), 원본 위치 개체(`object_position`), 다단(`column_layout`), 표 조각 |
| `src/core/editing/` | lossless source tree, text/paragraph/style/table patch, transaction·history, 편집 가능 판정(`editing_capability`), 복구 replay 검증(`replay_guard`), Save As |
| `src/main/` | Electron main: 창·IPC(`ipc_guard`로 보낸 쪽 검사), 편집 worker(`editing_engine`, `editing_worker`), 편집 session, 복구 기록(`recovery_journal`), HWP 열기 |
| `src/renderer/src/` | React 화면(`App.tsx`, `ViewerShell`, `ViewerToolbar`), 입력 칸·선택, 측정 캐시, HWP(rhwp) worker |
| `scripts/` | 패키지 앱 E2E·PDF 검사·corpus·benchmark |
| `tests/` | jest(`editing/golden/*.json` 포함), 공개 fixture(`tests/fixtures/public/`, 합성 fixture 생성기 `create_synthetic_hwpx.ts`) |

핵심 불변식:
- 편집은 바뀐 노드만 다시 쓰고 나머지 bytes는 그대로 둔다(golden test가 지킨다).
- 지원하지 않는 구조는 편집 불가(읽기 전용)로 막고 이유를 상태 막대에 보여 준다.
- 화면 갱신은 바뀐 section만 다시 해석·측정한다. 판단이 안 되면 전체로 fallback.
- 저장은 임시 파일에 쓰고 다시 열어 검증한 뒤 게시한다. 원본은 덮어쓰지 않는다.
- 복구 기록 형식을 바꾸면 version을 올리고 이전 version 읽기를 유지한다.

## 6. CI

- `.github/workflows/linux-ci.yml`, `windows-ci.yml`. push마다 실행, 같은 ref의 이전 실행은 취소된다.
- 순서: npm ci → test → typecheck → probe → corpus → build → package → 패키지 앱 E2E → PDF.
- Windows CI는 서명 안 된 NSIS 설치본을 artifact(`han-flow-windows-installer`)로 올린다.
- 작업 시간 한도 60분. matrix가 늘면 한도 근처에 갈 수 있다.

## 7. 현재 상태와 다음 작업

- 단계별 상태: README의 로드맵 표. V1·V2 완료, V3(제한적 HWPX 편집)는 자동 관문 완료·Windows 한/글
  재열기 등 실기 승인 대기, V4(배포)는 서명 준비 대기.
- 남은 일과 데스크톱 QA 체크리스트·Codex 프롬프트: [next_steps.md](next_steps.md)
- 알려진 제한: README "알려진 제한" 절
- 변경 이력: [CHANGELOG.md](../CHANGELOG.md), 검증 기록: [verification_history.md](verification_history.md)

## 8. AI 도구로 이어서 작업할 때

- 저장소 루트의 `CLAUDE.md`(Claude Code)와 `AGENTS.md`(Codex 등)가 이 문서를 가리킨다.
- 큰 작업은 "구현 → typecheck·test·probe → package → verify:matrix → 사용자 문서 verify_app/verify_pdf
  → 문서·CHANGELOG → commit·push → CI 확인" 순서로 한 단계씩 끝낸다.
- 컨테이너가 재시작될 수 있는 환경에서는 진행 기록을 임시 파일에 남기며 일한다.
