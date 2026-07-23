# Han-Flow v1 Release Candidate 체크리스트

기준일: 2026-07-23

v1은 HWPX를 빠르게 열어 읽고 PDF로 내보내는 macOS용 read-only 도구다. 편집, `.hwp` 5.0
바이너리 직접 파싱, 한컴오피스와 픽셀 단위 동일 렌더링은 이번 릴리스 범위가 아니다.

## 자동 품질 관문

- [x] `npm test -- --runInBand`
- [x] `npm run build`
- [x] `npm run package:mac`
- [x] `npm run verify:app -- tests/fixtures/private/m1-weekly.hwpx`
- [x] private AIDA 8페이지, 이미지 4개, overflow 0
- [x] 화면과 PDF 페이지별 비공백 글자 수 일치
- [x] 공개 15문단 fixture의 8+7 continuation, 반복 header, 뒤쪽 표 비회귀
- [x] 출력 PDF 8페이지 A4, 배경·이미지·쪽 번호 유지

`verify:app`은 본문 문자열을 출력하지 않는다. 파일 basename, 페이지 수, 이미지 수,
overflow 페이지와 페이지별 비공백 글자 수만 사용하며 임시 JSON과 Electron user-data는
검증 종료 후 삭제한다.

## 로컬 베타 판정

현재 빌드는 로컬 베타로 실제 주간 사용을 시작할 수 있다. Finder 더블클릭, drag-and-drop,
pinch zoom, dark chrome, PDF 자동 출력과 앱 재실행 경로를 production 패키지에서 검증했다.

다음 조건은 로컬 베타를 막지 않는 known limitation이다.

- 원문 글꼴이 없을 때 대체 글꼴 metric으로 줄바꿈과 페이지별 콘텐츠 분배가 달라진다.
- 한 문단 내부의 줄 단위 페이지 분할은 하지 않는다.
- `rowSpan > 1`, 복수 overflow 셀, 단일 초대형 문단은 안전한 행 단위 fallback을 사용한다.

## 공개 배포 전 남은 관문

- [ ] 개인정보를 제거한 실제 업무 HWPX 2~3개 추가 검증
- [ ] 이미지 중심, 세로 병합 중심, 50페이지 이상 문서를 각각 `verify:app`으로 통과
- [ ] PDF 저장 대화상자를 실제 사용자 흐름에서 최종 수동 확인
- [ ] Developer ID 서명
- [ ] Apple notarization과 stapling
- [ ] 깨끗한 Mac 계정에서 첫 실행과 Finder 기본 앱 선택 확인
- [ ] 버전·변경 사항·known limitation을 포함한 GitHub Release 작성

## 추가 문서 검증 절차

1. 문서를 저장소 밖의 안전한 경로에 둔다.
2. `npm run package:mac`으로 최신 production 앱을 만든다.
3. `npm run verify:app -- /path/to/document.hwpx`를 실행한다.
4. 실패하면 페이지 수, 이미지 decode, overflow 번호만 기록하고 본문·캡처는 커밋하지 않는다.
5. PDF가 중요한 문서는 화면과 출력 PDF의 페이지 수와 페이지별 비공백 글자 수를 비교한다.
