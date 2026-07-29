# V3 macOS 한국어 IME 수동 검증 matrix

이 문서는 자동 `CompositionEvent` probe가 대신할 수 없는 실제 macOS 두벌식 입력을 패키지
앱에서 확인하는 체크리스트다. 원문이나 수정 본문은 기록하지 않고 fixture 분류, 입력 유형,
통과 여부와 재현에 필요한 비식별 현상만 남긴다.

## 준비

1. `npm run package:mac`으로 현재 commit의 unsigned 앱을 만든다.
2. `release/mac-arm64/Han-Flow.app`에서 저장소 밖 실사용 HWPX를 연다.
3. 전체 section loading이 끝난 뒤 `편집`을 누른다.
4. 최상위 단일 텍스트 문단에 파란 focus outline이 표시되는지 확인한다.

원본 파일은 수정되지 않는다. 결과를 남길 때는 `다른 이름으로 저장`을 사용하고 Preview
stale 경고를 확인한다. 저장하지 않고 앱을 닫은 변경은 사라진다.

## 입력 matrix

| ID | 실제 조작 | 기대 결과 | 결과 |
| --- | --- | --- | --- |
| IME-01 | 빈 caret에서 두벌식으로 2~3음절 입력 | 조합 글자가 중복·분리되지 않고 완성 문자열 한 번만 반영 | 미실행 |
| IME-02 | 받침이 있는 음절과 다음 음절을 연속 입력 | 받침 이동 과정의 중간값이 undo history에 남지 않음 | 미실행 |
| IME-03 | 조합 중 Backspace 후 다른 글자 입력 | 화면과 최종 source projection이 같은 문자열 | 미실행 |
| IME-04 | 조합 중 Escape 또는 다른 문단 클릭 | 취소·확정 결과가 macOS 기본 동작과 일치하고 crash 없음 | 미실행 |
| SEL-01 | 앞→뒤로 2글자를 선택해 한글로 교체 | 선택 범위만 교체되고 caret이 삽입 문자열 뒤에 위치 | 미실행 |
| SEL-02 | 뒤→앞으로 2글자를 선택해 한글로 교체 | 방향을 포함한 selection이 undo에서 복원 | 미실행 |
| HIST-01 | `⌘Z`, `⇧⌘Z` 실행 | 원문·수정문과 selection이 각각 정확히 복원 | 미실행 |
| PAGE-01 | 줄바꿈이 달라질 만큼 연속 입력 | 페이지가 다시 나뉘어도 focus와 caret이 같은 source 문단에 유지 | 미실행 |
| LIMIT-01 | Enter와 Shift+Enter 입력 | 현재 제한대로 새 문단·강제 줄바꿈이 삽입되지 않음 | 미실행 |
| HWP-01 | `.hwp` 문서를 열기 | 편집 버튼과 editable surface가 노출되지 않음 | 미실행 |
| DIRTY-01 | 수정 뒤 다른 문서를 열고 취소 선택 | 현재 문서·수정 내용·selection 유지 | 미실행 |
| DIRTY-02 | 수정 뒤 창 닫기에서 저장 선택 | 검증형 Save As 성공 뒤 창이 닫히고 원본 유지 | 미실행 |
| DIRTY-03 | 수정 뒤 `⌘Q`에서 저장하지 않음 선택 | 명시적 discard 뒤 앱 프로세스 정상 종료 | 미실행 |

## 기록 규칙

- 결과는 `통과`, `실패`, `해당 없음` 중 하나로 바꾼다.
- 실패 시 문서 본문 대신 문서 분류, macOS version, 입력기 종류, 단계 ID, 화면 현상만 적는다.
- crash, 글자 중복, caret 소실, 다른 문단 수정, undo 경계 오류는 V3-4 blocker다.
- 글꼴 폭 때문에 페이지 위치가 한컴과 다른 현상은 별도 rendering 이슈이며, 내용 누락이나
  Han-Flow 내부 재페이지네이션 불안정과 구분한다.
