# 문서 fixtures

## Public HWP 5.0 fixture

`public/synthetic-layout.hwp`는 Han-Flow가 직접 작성한 문자열과 Canvas 그림만 넣은 2쪽 합성
문서다. 3×3 표, PNG resource 1개, 두 페이지에 반복되는 머리말과 강제 쪽 나누기를 포함한다.
개인정보와 외부 문서 원문은 없다.

- 생성: `npm run fixture:hwp`
- 고정 manifest: `public/synthetic-layout.hwp.json`
- 통합 검증: `npm run verify:hwp-matrix`

생성기는 외부 blank HWP 파일을 복사하지 않고 `@rhwp/core`의 `HwpDocument.createEmpty()`에서
시작한다. serializer 실행 결과는 byte 단위로 결정적이며 manifest의 전체 SHA-256과 비교한다.
구조 기대값은 같은 엔진의 자기 검증에만 의존하지 않고 `kordoc` development oracle로도
표·셀·이미지·resource 수를 교차 검사한다. production 경로에서는 페이지 SVG, 반복 머리말
검색, 접근성 layer와 PDF 페이지·텍스트 보존을 확인한다. 같은 공개 binary의 FileHeader를
임시 경로에서만 변형해 암호·배포용·DRM·비지원 version 오류를 만들고, 잘린 CFB로 손상
오류를 만든다. 변형 fixture는 검증 직후 삭제하며 저장소에는 추가 binary를 남기지 않는다.

fixture의 본문과 Canvas 그림, 생성 스크립트는 Han-Flow Apache-2.0 범위다. HWP 컨테이너
직렬화에는 MIT 라이선스의 [`@rhwp/core`](https://github.com/edwardkim/rhwp)를 사용했고
형식 판정 근거는 [V2 전략의 규격 출처](../../docs/hwp_v2_strategy.md#규격과-보안)에 모았다.
dependency 고지는 저장소의 `THIRD_PARTY_NOTICES.md`와 패키지 resources에 유지한다.

## HWPX fixtures

## Private milestone fixture

실사용 기준 문서는 `private/m1-weekly.hwpx`, 비교 PDF는
`private/m1-weekly-reference.pdf`에 둔다. `private/`는 개인정보와 문서 저작권을 위해
Git에 커밋하지 않는다.

파일을 고른 뒤 아래 정보를 추적 가능한 manifest로 작성한다.

- SHA-256
- 파일 크기, section/page 수
- 문단, table, image 수
- 필수 style/font 목록
- reference PDF를 만든 앱과 버전
- 기대되는 known limitation

공개 CI fixture는 `public/create_synthetic_hwpx.ts`가 테스트 전용 HWPX ZIP을 결정적으로
생성한다. 직접 작성한 최소 XML과 1×1 PNG만 사용하므로 개인정보나 제3자 문서 저작권에
의존하지 않는다. section 숫자 정렬, 혼합 콘텐츠 순서, 스타일, 이미지 resource, 표의
행 분할과 반복 header를 private 파일 없이 항상 검증한다.

같은 생성기의 `createCellFragmentHwpx`는 반복 header 아래 한 셀에 15개 문단을 넣고,
그 뒤에 별도 앵커 표를 둔다. 측정 pagination에서 장문 셀이 head/tail continuation 행으로
나뉘는지, 문단 ID가 빠지거나 중복되지 않는지, 뒤쪽 표가 추가 페이지로 밀리지 않는지를
개인정보 없는 입력으로 검증한다.

`npm run fixture:v3-acceptance`는 좁은 pagination 스트레스 fixture와 함께
`han-flow-v3-a4-editing.hwpx`를 생성한다. A4 fixture는 세로 `59528 × 84189 HWPUNIT`, 사방
`5669 HWPUNIT`(약 20mm) 여백과 본문 폭 `48190 HWPUNIT` 표를 사용한다. 작은 fixture를 실제
사용 화면의 대표로 확대 해석하지 않고, A4 문서에서 편집 리본·입력·selection과 저장 UX를
별도로 검증한다. 생성 결과는 개인정보 없는 임시 acceptance artifact이며 Git에는 넣지 않는다.

`createRoundTripHwpx`는 표준 package entry와 함께 알 수 없는 namespace·attribute·XML node,
미지 binary와 명시적 directory entry를 넣는다. `HwpxSourcePackage` identity round-trip 뒤
entry 순서·compression·CRC·uncompressed SHA-256과 sentinel이 모두 같은지 검증한다.
`mimetype`은 다른 공개 fixture를 포함해 `application/hwp+zip`을 stored 방식으로 기록한다.
같은 fixture의 일반 text와 빈 `<hp:t></hp:t>`는 entity·tab·line break·Unicode patch,
inverse byte 복원, stale revision과 검증형 Save As 테스트에 사용한다.
저장소 밖 실문서는 `HAN_FLOW_PRIVATE_HWPX` 환경 변수로 같은 테스트를 선택 실행하며 본문이나
파일명은 assertion과 로그에 포함하지 않는다.

`createSyntheticHwpx`의 `sectionCount`, `paragraphsPerExtraSection`, `imageBytes` 옵션으로
대형 문서를 만들 수 있다. `npm run benchmark:decoder`는 80 sections, 약 1만 9천 문단,
5MiB image resource 조건에서 첫 section과 전체 디코딩을 각각 20회 실행하고 p50/p95를
출력한다. 시간 자체는 환경에 따라 달라지므로 일반 테스트에서는 건너뛰고 명시적으로 실행한다.
이 결과는 디코더 회귀 기준이며 앱 기동·IPC·조판·paint를 포함한 실사용 열기 시간은 아니다.

## 현재 M1 기준

현재 private fixture는 개인정보가 포함된 8페이지 공공기관 신청 양식이다. 원문, 추출
텍스트, 화면 캡처는 커밋하거나 테스트 실패 메시지에 출력하지 않는다.

V2-0의 같은 문서 `.hwp` 원본도 저장소 밖에 둔다. `npm run probe:hwp -- <file.hwp>`는
파일명과 본문 대신 짧은 SHA-256 식별자, container flag, 구조·페이지 count만 출력한다.

- section: 3
- 최상위 문단: 11, 1, 20
- 전체 문단: 303
- 표: 15
- 그림 개체: 4
- PNG resource: 2

golden 테스트는 내용 문자열 대신 구조, 크기, style 수, 병합 좌표만 검증한다.
이미지 테스트도 원문을 노출하지 않고 resource ID, MIME, byte 존재 여부만 검증한다.
