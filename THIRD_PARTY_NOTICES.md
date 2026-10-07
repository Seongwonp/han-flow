# Han-Flow Third-Party Notices

기준일: 2026-07-27

이 문서는 Han-Flow의 HWP 5.0 통합에 직접 관련된 제3자 구성요소와 형식 고지를 기록한다.
V4 공개 배포 전 production dependency 전체 inventory를 별도로 생성해 이 문서를 확장한다.

## 배포 구성요소

### `@rhwp/core` 0.7.19

- 역할: HWP 5.0 read-only parser와 fixed-page SVG renderer
- 저작권: Copyright (c) 2025–2026 Edward Kim
- 라이선스: MIT
- 원 저장소: https://github.com/edwardkim/rhwp
- 배포 패키지: https://www.npmjs.com/package/@rhwp/core

MIT 라이선스 원문은 macOS 앱의
`Contents/Resources/licenses/rhwp-MIT.txt`에 포함한다.

### rhwp 한컴 PUA 표시 대체 표

- 역할: HWPX 화면에서 한컴 전용 사설 영역 기호(예: U+F03DA)를 표준 Unicode 글자로 표시
  (`src/core/document/hancom_pua_display.ts`, 원문·저장 bytes는 바꾸지 않음)
- 출처: rhwp `src/renderer/hancom_pua.rs`의 `VERIFIED_HANCOM_PUA_DISPLAY`
  (https://github.com/edwardkim/rhwp, commit `1a76570e833917d15817415a53c09ad61ab3203f`, v0.8.7)
- 저작권: Copyright (c) 2025–2026 Edward Kim
- 라이선스: MIT(위 `@rhwp/core`와 같은 원문 `rhwp-MIT.txt`)

## 개발 전용 구성요소

### `kordoc` 4.2.7

- 역할: parser bake-off와 semantic structure 비교 oracle
- 저작권: Copyright (c) 2026 chrisryugj
- 라이선스: MIT
- 원 저장소: https://github.com/chrisryugj/kordoc
- production 앱 포함 여부: 포함하지 않음

## 테스트 fixture

`tests/fixtures/public/external/`의 HWPX 28종은 한/글(Hancom Office Hangul)로 저장된 공개
테스트 파일을 원본 그대로 복사한 것이다. 각 파일의 출처 URL·commit·SHA-256은
`tests/fixtures/public/hwpx_corpus_manifest.json`에 기록한다. 배포 앱에는 포함하지 않는다.

### `neolord0/hwpxlib` testFile 15종

- 라이선스: Apache License 2.0
- 원 저장소: https://github.com/neolord0/hwpxlib (commit `f9fd225`)
- 대상: `ext-hwpxlib-*.hwpx`

### `airmang/python-hwpx` hancom_saved 13종

- 저작권: Copyright 2025-2026 airmang
- 라이선스: Apache License 2.0
- 원 저장소: https://github.com/airmang/python-hwpx (commit `7d5ce2b`)
- 대상: `ext-pyhwpx-*.hwpx`
- NOTICE: "This product includes software developed by airmang. Licensed under the Apache
  License, Version 2.0."

## HWP 공개 문서 고지

본 제품은 한글과컴퓨터의 한/글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

“한글”, “한컴”, “HWP”, “HWPX”는 각 권리자의 상표일 수 있습니다. Han-Flow는
한글과컴퓨터와 제휴하거나 한글과컴퓨터의 후원 또는 보증을 받은 제품이 아닙니다.

## Han-Flow

Han-Flow 자체 소스 코드는 Apache License 2.0에 따라 배포한다. 라이선스 원문은 저장소의
`LICENSE`와 macOS 앱의
`Contents/Resources/licenses/Han-Flow-Apache-2.0.txt`에 포함한다.
