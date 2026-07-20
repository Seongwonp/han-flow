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

공개 CI fixture는 직접 생성했거나 재배포 허가가 명확한 파일만 `public/`에 추가한다.

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
