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
