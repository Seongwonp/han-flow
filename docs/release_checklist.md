# Han-Flow 릴리스 체크리스트

기준일: 2026-09-28

이 문서의 앞부분은 완료한 V1 RC 기준선을 보존한다. 실제 공개 배포 판단은 아래 V4 관문과
[V4 배포 전략(macOS·Windows)](v4_release_strategy.md)을 함께 따른다.

## V1 Release Candidate 기준선

v1은 HWPX를 빠르게 열어 읽고 PDF로 내보내는 macOS용 read-only 도구다. 편집, `.hwp` 5.0
바이너리 직접 파싱, 한컴오피스와 픽셀 단위 동일 렌더링은 이번 릴리스 범위가 아니다.

## V1 당시 자동 품질 관문

- [x] `npm test -- --runInBand`
- [x] `npm run build`
- [x] `npm run package:mac`
- [x] `npm run verify:app -- tests/fixtures/private/m1-weekly.hwpx`
- [x] `npm run verify:matrix`
- [x] `npm run verify:hwp-matrix`
- [x] `npm run verify:pdf -- tests/fixtures/private/m1-weekly.hwpx`
- [x] `npm run release:check -- tests/fixtures/private/m1-weekly.hwpx`
- [x] private AIDA 8페이지, 이미지 4개, overflow 0
- [x] 화면과 PDF 페이지별 비공백 글자 수 일치
- [x] 공개 15문단 fixture의 8+7 continuation, 반복 header, 뒤쪽 표 비회귀
- [x] 출력 PDF 8페이지 A4, 배경·이미지·쪽 번호 유지
- [x] 80-section synthetic 9,767페이지 중 DOM 12개만 mount, overflow 0
- [x] 이미지 12개와 `rowSpan=2` 표 production 렌더, overflow 0
- [x] 필수 header가 없는 손상 HWPX의 crash 없는 사용자 오류
- [x] AIDA 화면/PDF 8페이지와 페이지별 글자 수 일치
- [x] background decode와 DOM measurement 완료 후 3회 안정된 layout 상태 수집
- [x] 앱 bundle version `1.0.0-rc.1`
- [x] 공개 HWP의 결정적 SHA-256, 표·셀·이미지 구조와 2쪽 반복 머리말
- [x] private AIDA HWP 7쪽 화면·혼합 용지 PDF와 텍스트 99.08% 보존
- [x] 암호·배포용·DRM·비지원 version·손상 HWP의 정확한 production 오류 코드
- [x] 날짜별 명령·fixture·수치·발견 결함을 `verification_history.md`에 기록

`verify:app`은 본문 문자열을 출력하지 않는다. 파일 basename, 페이지 수, 이미지 수,
overflow 페이지와 페이지별 비공백 글자 수만 사용하며 임시 JSON과 Electron user-data는
검증 종료 후 삭제한다.

## 2026-09-28 현재 자동 관문

- [x] Jest 43 suites·292 passed(2 suites·12 tests skipped), parser probe 18 passed
- [x] 공개 HWPX corpus 9/9, 외부 file fixture 0종
- [x] Windows CI: test·typecheck·probe·corpus·build·package, 패키지 앱 HWPX·HWP matrix·PDF E2E, 비서명 NSIS artifact
- [x] Linux CI: 같은 자동 관문, `package:linux`, xvfb 패키지 앱 E2E, unpacked artifact
- [ ] Windows 11 실기의 설치·Ctrl 단축키·맑은 고딕 대체·exFAT Save As
- [ ] Windows 한/글에서 identity·편집본 재열기와 재저장 왕복
- [ ] Mac 하드웨어 확보 뒤 macOS 13+ 실행, 물리 두벌식 입력·서명·공증·설치 관문

## 2026-09-13 자동 관문 (기록, 로컬 Windows 포함)

- [x] Jest 37 suites, 228 passed, 2 suites·11 tests skipped
- [x] parser probe 14 passed와 main·preload·renderer typecheck 통과
- [x] 공개 HWPX corpus 9/9, 88 sections와 동일 너비 2단 section 1개 통과
- [x] corpus 독립 report SHA-256 `10A806F944CFF272584AD3CFF260E5165CE2AE695AFBC42BC51828C2500F8A79` 일치
- [x] Windows x64 production package와 HWPX production matrix 6/6 통과
- [x] 동일 너비 2단 DOM 1쪽·단 2개·본문 17/43자·overflow 0
- [x] 대형 progressive HWPX 19,503쪽 중 DOM 12쪽 mount
- [x] 표 행·열 추가/삭제와 제한적 병합·분할의 Undo/Redo·Save As·재개봉 통과

## 로컬 베타 판정

현재 빌드는 로컬 베타로 실제 주간 사용을 시작할 수 있다. Finder 더블클릭, drag-and-drop,
pinch zoom, dark chrome, PDF 자동 출력과 앱 재실행 경로를 production 패키지에서 검증했다.

다음 조건은 로컬 베타를 막지 않는 known limitation이다.

- 원문 글꼴이 없을 때 대체 글꼴 metric으로 줄바꿈과 페이지별 콘텐츠 분배가 달라진다.
- 한 문단 내부의 줄 단위 페이지 분할은 하지 않는다.
- `rowSpan > 1`, 복수 overflow 셀, 단일 초대형 문단은 안전한 행 단위 fallback을 사용한다.

## V4 공개 배포 관문

Han-Flow는 V4가 완성될 때까지 개인용으로 사용한다. 아래 항목은 V1 RC의 즉시 배포 TODO가
아니라 V4에서 다시 검증할 release gate다.

- [ ] 개인정보를 제거한 실제 업무 HWPX 2~3개 추가 검증
- [x] 50페이지 이상 synthetic 문서의 점진 로딩·가상화 검증
- [x] 이미지 중심·세로 병합 중심 synthetic production 검증
- [ ] 이미지 중심·세로 병합 중심 실제 문서를 각각 `verify:app`으로 통과
- [ ] PDF 저장 대화상자를 실제 사용자 흐름에서 최종 수동 확인
- [x] 현재 `dir`·arm64·ad-hoc 서명 기준선을 `npm run release:audit`로 측정
- [x] 직접 배포용 `dmg`·`zip`, 서명·공증·stapling 순서와 공식 출처 문서화
- [ ] V3 macOS 물리 입력과 Windows 한/글 재열기 외부 승인
- [x] Rosetta 종료 일정과 실험 결과를 근거로 arm64-only 공개 artifact 확정
- [ ] Developer ID 서명
- [ ] hardened runtime, 최소 entitlement와 secure timestamp 검증
- [ ] Apple notarization, stapling과 Gatekeeper 평가
- [ ] 깨끗한 Mac 계정에서 첫 실행과 Finder 기본 앱 선택 확인
- [ ] `dmg`·`zip` SHA-256과 배포 manifest 기록
- [ ] 수동 설치 릴리스 안정화 뒤 updater 활성화 여부 판정
- [ ] 버전·변경 사항·known limitation을 포함한 GitHub Release 작성

## V4 Windows 공개 배포 관문

비서명 로컬·CI 설치본(`package:win:installer`, `windows-ci.yml`)은 개인 검증용이다. 공개 설치본은 서명 경로
(`package:win:release`, `release-windows.yml`)로만 만든다. 세부 절차는
[V4 배포 전략의 Windows 서명 배포 절](v4_release_strategy.md#windows-서명-배포-sprint-5)을 따른다.

- [x] release 설정 분리: `forceCodeSigning: true`, SHA-256 + RFC 3161 timestamp, `release/windows-release` 출력
- [x] appId `com.hanflow.viewer`, NSIS 사용자별 설치(`oneClick: false`·`perMachine: false`), `.hwp`·`.hwpx` 연결을 비서명 설치본과 같게 유지
- [x] 서명 재료 사전 검사(빠진 변수 이름만 출력)와 `npm run release:audit:win`
- [x] `release-windows.yml`: secret 없으면 첫 단계 실패, test 뒤 서명 빌드, strict 감사, `SHA256SUMS.txt`, artifact 업로드
- [ ] 인증서 종류 결정·발급과 GitHub `windows-release` environment secret 등록
- [ ] release workflow 성공과 `release:audit:win -- --strict` 통과(서명 `valid`·timestamp·버전 리소스)
- [ ] 깨끗한 Windows 11에서 디지털 서명 탭·SmartScreen 표시·설치·첫 실행·제거
- [ ] 설치 뒤 `.hwp`·`.hwpx` 연결 프로그램 목록과 비서명 설치본 위 덮어쓰기 설치
- [ ] Windows 실기 관문(위 2026-09-28 목록의 Windows 11·한/글 왕복) 통과
- [ ] 설치본 SHA-256, 변경 사항·known limitation을 넣은 GitHub Release 초안 검토

## 추가 문서 검증 절차

1. 문서를 저장소 밖의 안전한 경로에 둔다.
2. `npm run package:mac`으로 최신 production 앱을 만든다.
3. `npm run verify:app -- /path/to/document.hwpx`를 실행한다.
4. 실패하면 페이지 수, 이미지 decode, overflow 번호만 기록하고 본문·캡처는 커밋하지 않는다.
5. PDF가 중요한 문서는 화면과 출력 PDF의 페이지 수와 페이지별 비공백 글자 수를 비교한다.
