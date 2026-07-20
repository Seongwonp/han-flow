# HWPX fixtures

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

`createSyntheticHwpx`의 `sectionCount`, `paragraphsPerExtraSection`, `imageBytes` 옵션으로
대형 문서를 만들 수 있다. `npm run benchmark:decoder`는 80 sections, 약 1만 9천 문단,
5MiB image resource 조건에서 첫 section과 전체 디코딩 시간을 비교한다. 시간 자체는 환경에
따라 달라지므로 일반 테스트에서는 건너뛰고 명시적으로 실행한다.

## 현재 M1 기준

현재 private fixture는 개인정보가 포함된 8페이지 공공기관 신청 양식이다. 원문, 추출
텍스트, 화면 캡처는 커밋하거나 테스트 실패 메시지에 출력하지 않는다.

- section: 3
- 최상위 문단: 11, 1, 20
- 전체 문단: 303
- 표: 15
- 그림 개체: 4
- PNG resource: 2

golden 테스트는 내용 문자열 대신 구조, 크기, style 수, 병합 좌표만 검증한다.
이미지 테스트도 원문을 노출하지 않고 resource ID, MIME, byte 존재 여부만 검증한다.
