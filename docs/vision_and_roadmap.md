# Han-Flow 제품 비전과 로드맵

기준일: 2026-07-27

## 비전

Han-Flow는 “상용 오피스를 복제하는 프로젝트”가 아니라 macOS에서 매주 실제로 쓰는 한글
문서 도구다. 받은 파일이 빠르게 열리고, 표와 이미지가 무너지지 않으며, 필요하면 PDF로
전달할 수 있어야 한다.

프로젝트의 우선순위는 다음과 같다.

1. 실제 문서에서 재현되는 정확성
2. 첫 화면까지의 속도와 대형 문서 안정성
3. 읽기·PDF·편집 각각의 명확한 품질 관문
4. macOS다운 작은 사용 흐름
5. 기능 수보다 회귀 fixture와 측정 가능한 완료 조건

## 스코프 원칙

- HWPX는 OWPML 구조를 해석하되 한컴과 픽셀 단위 동일 렌더링을 목표로 하지 않는다.
- HWP 5.0은 기존 parser를 부품으로 채택하며 전체 binary parser를 직접 만들지 않는다.
- V1과 V2는 read-only다. 편집과 저장은 V3에서 별도의 모델·IME·무손실 관문을 통과해야 한다.
- 공개 배포는 V4에서만 한다. 그 전에는 개인용 unsigned package로 실사용 검증한다.
- 실제 fixture의 본문, 캡처, 개인정보는 저장소와 자동화 로그에 남기지 않는다.
- 한 milestone은 하나 이상의 실제 문서와 개인정보 없는 synthetic fixture로 끝낸다.

## V1 — HWPX 뷰어

상태: **로컬 RC 완료**

- [x] Finder, dialog, drag-and-drop HWPX 열기
- [x] 문단·run style, 표·병합 cell·border/fill, 이미지
- [x] 구역별 header/footer/page number
- [x] 측정 기반 pagination과 표 cell continuation
- [x] worker 점진 decode와 50페이지 초과 page virtualization
- [x] zoom, dark chrome, single-instance macOS UX
- [x] 화면과 같은 DOM을 사용하는 PDF export
- [x] production app/PDF/public matrix 통합 검증

V1 known limitation은 대체 글꼴 metric, 한 문단 내부 line 단위 분할, 복잡한 rowSpan 표의
fallback이다. V2가 이를 무관하게 깨뜨리면 안 된다.

## V2 — HWP 5.0 읽기

상태: **production parser·공개 회귀 관문 완료, 오류 UX 진행 중**

목표는 `.hwp` 파일을 V1과 같은 shell에서 읽고 PDF로 내보내는 것이다. 직접 binary parser를
완성하는 대신 `@rhwp/core`를 production visual engine으로 사용하고 `kordoc`은
development-only semantic oracle로 유지한다. 자동 fallback은 두지 않는다.

- V2-0: AIDA `.hwp/.hwpx/.pdf`로 후보 정확도·성능·bundle 비교
- V2-1: format detector, `DocumentImporter`, worker 격리, 오류 taxonomy
- V2-2: 문단·style·section·header/footer/page number
- V2-3: 표, 병합 cell, border/fill, BinData 이미지
- V2-4: progressive loading, virtualization, PDF와 HWP 회귀 matrix

조사 근거와 완료 조건은 [HWP 5.0 조사와 도입 전략](hwp_v2_strategy.md)을 따른다.

현재 AIDA HWP의 화면·검색·PDF, Worker timeout·취소, package·성능·메모리 관문을 통과했다.
개인정보 없는 2쪽 HWP 고정 fixture와 `verify:hwp-matrix`도 생성 결정성·두 parser 교차
검사·production 앱·PDF release gate에 연결했다. 남은 핵심은 format-neutral importer와
암호·DRM·배포용·손상 입력의 정확한 오류 UX다. parser 역할은
[ADR-0001](adr/0001-hwp-parser-roles.md)에서 확정했다.

## V3 — 편집

상태: **계획만 유지**

V3의 편집은 V1 시기의 과거 `contentEditable` prototype을 완료된 기능으로 보지 않고 새 품질
관문으로 시작한다.

- HWPX 우선 편집 모델과 command 기반 mutation
- 한국어 IME composition을 깨뜨리지 않는 입력 경계
- selection, cursor, undo/redo
- 문단·글자 style과 표 cell의 단계적 편집
- 미지원 원본 속성의 보존과 loss report
- crash-safe 저장, 임시 파일, 원본 보호

`.hwp` 저장은 V3의 기본 약속이 아니다. HWPX 안전 저장이 검증된 뒤 별도 결정한다.

## V4 — 사용자 배포

상태: **V1–V3 품질 관문 이후**

- Developer ID 서명, notarization, stapling
- Universal 또는 architecture별 macOS package 결정
- 자동 업데이트와 rollback 정책
- 깨끗한 Mac 계정의 설치·첫 실행·기본 앱 UX
- 개인정보 없는 실제 호환성 corpus와 release regression
- 라이선스·third-party notice·HWP 공개 규격 고지
- versioning, changelog, GitHub Release와 사용자 문서

Spotlight, Quick Look, AI, cloud sync는 V4 완료 조건이 아니다. 실제 주간 사용에서 반복되는
문제가 확인될 때 별도 milestone으로 제안한다.

## 현재 다음 작업

1. HWP `FileHeader`와 암호·DRM·배포용·손상 입력 오류 UX
2. format-neutral `DocumentImporter`와 IPC
3. 공개 matrix에 지원 불가·손상 HWP corpus 추가
4. V2 완료 조건 전체 재검증

## 진행률 스냅샷

최종 배포까지의 진행률은 기능 개수나 test coverage가 아니라 남은 위험과 예상 작업량을
반영한 계획용 추정치다. 편집이 가장 큰 범위라 V3 가중치를 가장 높게 둔다.

| 단계 | 전체 가중치 | 현재 진행 | 전체 기여 |
| --- | ---: | ---: | ---: |
| V1 HWPX viewer | 20% | 100% | 20.0% |
| V2 HWP 읽기 | 25% | 85% | 21.3% |
| V3 편집 | 40% | 0% | 0.0% |
| V4 사용자 배포 | 15% | 5% | 0.8% |
| **최종 배포 전체** | **100%** | | **약 42%** |

V4의 5%는 공개 저장소, Apache-2.0, 아이콘과 초기 third-party notice 준비분이다. Developer ID
서명·공증, 업데이트, 깨끗한 Mac 설치와 release corpus는 아직 시작하지 않았다. 범위나 품질
관문이 바뀌면 이 추정치도 함께 갱신한다.
