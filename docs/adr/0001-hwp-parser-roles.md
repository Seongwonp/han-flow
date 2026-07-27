# ADR-0001: HWP parser와 renderer 역할 확정

- 상태: 승인
- 결정일: 2026-07-27
- 대상: Han-Flow V2 HWP 5.0 읽기
- 평가 버전: `@rhwp/core` 0.7.19, `kordoc` 4.2.7

## 배경

Han-Flow는 HWP 5.0 binary parser를 새로 구현하지 않는다. macOS에서 받은 HWP를 빠르게 열고,
레이아웃이 무너지지 않게 읽으며 PDF로 내보내기 위해 기존 parser를 부품으로 채택한다.

private AIDA HWP/HWPX/PDF 삼쌍으로 `@rhwp/core`와 `kordoc`을 같은 개인정보 비노출 지표로
비교했다. 이후 fixed-page 앱 연결, PDF, 검색·선택·접근성, package 크기, Worker 격리,
성능과 메모리 관문을 순서대로 통과시켰다. 수치와 재현 절차는
[parser bake-off](../hwp_v2_bakeoff.md)에 있다.

## 결정

1. `@rhwp/core` 0.7.19를 V2의 **production visual engine**으로 채택한다.
2. HWP 결과는 flow `ViewerDocument`로 억지 변환하지 않고 read-only
   `FixedPageDocument`로 유지한다.
3. `kordoc` 4.2.7은 **development-only semantic oracle**로 유지한다. production 앱에는
   포함하지 않는다.
4. 자동 fallback parser는 두지 않는다. rhwp가 실패한 문서를 불완전한 kordoc 화면으로
   조용히 대체하지 않고, 분류된 지원 불가 또는 손상 문서 오류를 보여준다.
5. 두 패키지는 exact version으로 고정한다. 업그레이드는 private 기준 문서와 공개 fixture,
   PDF·성능·메모리·package 관문을 모두 다시 통과한 별도 변경으로만 한다.

## 점수표

각 항목은 기존 가중치 안에서 직접 점수를 부여했다. 총점만으로 채택하지 않으며 콘텐츠 유실,
실행 가능한 외부 콘텐츠 또는 취소 불가능한 parser는 별도 탈락 조건이다.

| 항목 | 가중치 | `@rhwp/core` | `kordoc` | 근거 |
| --- | ---: | ---: | ---: | --- |
| 레이아웃 안정성 | 35 | 32 | 6 | rhwp는 7쪽·3구역·혼합 용지와 표·이미지를 보존하고 overflow 0. kordoc 공개 IR에는 용지·좌표·테두리·머리말 geometry가 없음 |
| 콘텐츠 보존 | 25 | 23 | 18 | rhwp는 기준 PDF 문자 99.05%, 한글·영문 누락 0. kordoc은 adapter text가 일치하지만 문단 102개·표 2개가 부족 |
| 기존 기능 재사용 | 15 | 15 | 8 | rhwp fixed-page 경로가 zoom·가상화·검색·PDF shell을 통과. kordoc은 flow adapter 가능성만 확인 |
| 열기 성능 | 15 | 15 | 15 | rhwp cold p95 614ms. kordoc parse 약 15–17ms |
| 보안·유지보수 | 10 | 7 | 7 | 둘 다 MIT와 active upstream. rhwp는 Worker·timeout을 적용했지만 0.x API와 메모리 비용이 있음. kordoc은 개발 의존성 규모와 audit 부담이 큼 |
| **합계** | **100** | **92** | **54** | |

## Production 경계

```text
HWP byte
  → main: 200 MiB + CFB magic preflight
  → renderer 전용 Web Worker: @rhwp/core parse/page operation
  → adapter: page/schema/size 검증 + SVG 외부 콘텐츠 거부
  → FixedPageDocument + blob SVG image + React text layer
  → 공통 zoom/virtualization/search/PDF shell
```

- open 30초, page operation 15초 timeout
- 새 load, timeout과 Worker crash 시 Worker 종료와 document/cache 무효화
- SVG와 text layout은 5천만 문자 상한 뒤 element·URL·run·좌표 범위 재검증
- Scripts, OLE와 외부 링크는 실행하거나 자동으로 열지 않음
- parser 실패는 앱 crash가 아니라 해당 문서 오류로 끝냄

Web Worker는 UI thread를 분리하고 동기 WASM 작업을 강제 취소할 수 있지만 별도 OS process
경계는 아니다. Electron `utilityProcess`는 CPU 집약적이거나 crash-prone한 구성요소를 별도
process로 옮기는 공식 선택지다. rhwp SVG가 Canvas/DOM text metric에 의존하므로 현재는
OffscreenCanvas를 쓸 수 있는 Web Worker를 채택한다. 공개 대형 HWP에서 Worker crash나
647.6MiB peak memory가 실사용 문제가 되면 utility process bridge를 별도 ADR로 비교한다.

## 성능과 비용

- HWP first paint cold p50/p95: 535/614ms, 최대 722ms
- warm p50/p95: 203/237ms
- aggregate working set peak p50/p95: 619.9/647.6MiB
- V1 RC 대비 `.app` 증가: 6.96MiB
- WASM asset: 6.64MiB, production 중복 없음

Worker 수명주기를 문서마다 새로 시작해 warm p95가 격리 전 125ms에서 237ms로 늘었고, HWP
memory p95도 58.0MiB 증가했다. 1초 목표와 앱 안정성을 우선해 현재 비용을 수용하되 회귀
기준선으로 계속 측정한다.

## 라이선스와 고지

- Han-Flow: Apache-2.0
- `@rhwp/core` 0.7.19: MIT, Copyright 2025–2026 Edward Kim
- `kordoc` 4.2.7: MIT, Copyright 2026 chrisryugj

MIT는 사용·수정·배포를 허용하며 배포되는 사본 또는 substantial portion에 저작권·허가
문구를 포함해야 한다. production 앱에는 rhwp MIT 원문과
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)를 함께 넣는다. kordoc은 개발
도구로만 설치되고 앱에는 들어가지 않지만 평가 재현성을 위해 notice에 역할과 라이선스를
기록한다. Han-Flow의 Apache-2.0 원문도 같은 package license 디렉터리에 포함한다.

이 기록은 프로젝트의 배포 준수 기준이며 개별 상황에 대한 법률 자문은 아니다. V4 공개 배포
전 전체 production dependency inventory를 다시 생성하고 검토한다.

## 채택 결과

### 얻는 것

- 실제 HWP의 표·이미지·혼합 용지를 읽을 수 있는 fixed-page 경로
- 1초 첫 화면, 검색·선택·접근성과 PDF 출력
- 불완전한 semantic 변환을 production 화면에서 제거
- 후보 업데이트를 통제하는 재현 가능한 품질 관문

### 감수하는 것

- 한컴/PDF 기준 8쪽이 7쪽이 되는 글꼴·행 높이 차이
- 원본 semantic structure 전체를 Han-Flow 모델로 소유하지 않음
- 0.x upstream API와 6.64MiB WASM
- Web Worker 메모리와 warm-open 비용
- rhwp가 실패할 때 자동 시각 fallback 없음

## 후속 작업

1. [완료] 개인정보 없는 표·이미지·머리말 HWP fixture와 `verify:hwp-matrix`
2. HWP `FileHeader` signature/version, 암호·DRM·배포용 flag와 오류 UX
3. format-neutral `DocumentImporter`와 IPC 계약
4. V4에서 전체 third-party inventory, 앱 내 정보 화면과 서명·공증 패키지 확인

## 확인한 출처

- [`@rhwp/core` npm 0.7.19](https://www.npmjs.com/package/@rhwp/core)
- [`@rhwp/core` v0.7.19 release](https://github.com/edwardkim/rhwp/releases/tag/v0.7.19)
- [`rhwp` MIT license](https://github.com/edwardkim/rhwp/blob/main/LICENSE)
- [`kordoc` repository](https://github.com/chrisryugj/kordoc)
- [`kordoc` MIT license](https://github.com/chrisryugj/kordoc/blob/main/LICENSE)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron utility process](https://www.electronjs.org/docs/latest/api/utility-process)

출처와 upstream 상태는 2026-07-27에 다시 확인했다. 현재 kordoc main은 4.2.9지만 이 ADR은
lockfile과 실제 probe에 사용한 4.2.7만 평가한다.
