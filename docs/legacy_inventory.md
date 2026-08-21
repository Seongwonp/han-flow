# Production·legacy 코드 inventory

기준일: 2026-08-21

## 판정 기준

production 진입점은 `src/main/index.ts`, `src/main/decoder_worker.ts`,
`src/main/preload.ts`와 `src/renderer/index.html`에서 시작한다. 진입점의 정적·동적 import,
Jest와 `scripts/` 참조, TypeScript project 범위를 모두 검색해 세 범주로 판정했다.

- production: 앱 실행이나 저장·인쇄·보안 경계에서 도달 가능
- development-only: test, fixture, probe, audit 또는 build에서만 사용
- legacy: 어느 진입점·검증에서도 참조되지 않고 현재 데이터 계약과 충돌

## 삭제 판정

| 대상 | 판정 근거 |
| --- | --- |
| `src/core/parser/parser.ts` | ZIP 상한 없이 모든 `BinData`를 base64화하고 손실성 normalization으로 연결하는 초기 parser |
| `src/core/parser/normalization.ts` | unknown XML·package entry를 버리고 시간·난수 ID를 만드는 구형 모델 변환기 |
| `src/core/renderer-engine/renderer.ts` | 실제 renderer가 사용하지 않는 문자열 CSS prototype이며 HWPUNIT 변환도 현재 계약과 다름 |
| `src/renderer/src/store.ts` | package snapshot deep copy와 직접 구조 변경을 사용하는 과거 Zustand editor store |
| `src/shared/types.ts` | 위 네 파일만 참조한 구형 `NormalizedDocument`·OWPML 타입 집합 |
| `zustand` | 과거 store의 유일한 외부 dependency |
| `katex`, `@types/katex` | 현재 production·test·probe에 import가 없는 초기 수식 편집 dependency |
| `react-icons` | 현재 renderer가 import하지 않는 초기 UI dependency |

삭제한 코드는 Git history에서 복구할 수 있으므로 별도 experimental 사본을 두지 않는다. 현재
편집 계약은 `HwpxSourcePackage`·command·transaction·main-process session이며, 보기 계약은
`ViewerDocument`와 `FixedPageDocument`다.

## 유지 판정

- `@rhwp/core`: HWP fixed-page production renderer로 Vite가 Worker·WASM asset을 묶는다.
- `kordoc`: production fallback이 아닌 development oracle과 parser probe로 유지한다.
- `adm-zip`: HWPX source package 저장과 fixture 생성에 사용한다.
- `unzipper`, `fast-xml-parser`: 제한된 HWPX read-only package·ordered XML 경로에서 사용한다.
- `cfb`: HWP FileHeader·CFB preflight에 사용한다.
- `font-list`: main process의 시스템 글꼴 조회에서 동적으로 import한다.

`docs/dev_log.md`, `docs/ux_strategy.md`, `docs/v1_baseline.md`의 prototype 설명은 과거 의사결정
근거이므로 삭제하지 않는다. 해당 문서의 파일·dependency 이름은 현재 설치나 runtime 계약을
뜻하지 않는다.
