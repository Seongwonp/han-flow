# V3 macOS 한국어 IME 수동 검증 matrix

이 문서는 자동 `CompositionEvent` probe가 대신할 수 없는 실제 macOS 두벌식 입력을 패키지
앱에서 확인하는 체크리스트다. 원문이나 수정 본문은 기록하지 않고 fixture 분류, 입력 유형,
통과 여부와 재현에 필요한 비식별 현상만 남긴다.

`npm run verify:ime:mac`은 synthetic `CompositionEvent`를 만들지 않는다. macOS
`System Events`가 현재 두벌식 입력기에 실제 key code를 전달하고, 스페이스바 commit 전후의
native event count·focus·dirty·undo 상태를 CDP로 관찰한다. 기본 입력뿐 아니라 조합 중
Backspace·Escape, 정방향·역방향 범위 치환과 실제 `⌘Z`·`⇧⌘Z`도 자동화한다. 이 OS-level
smoke는 핵심 회귀를 재현하지만 사용자 손 입력 전체를 대체하지 않는다.

## 자동 native smoke

1. `npm run fixture:v3-acceptance`
2. `npm run package:mac`
3. `npm run verify:ime:mac:matrix`

기본 입력 fixture는 `han-flow-v3-a4-editing.hwpx`다. 입력은 `한글입력검증 ` → 2초 대기 →
재클릭 없이 `추가 `다. 마지막 공백은 macOS
composition을 확정하며, 두 단계 모두 같은 source anchor가 활성 상태여야 한다. 이 검사는
macOS 자동화·손쉬운 사용 권한과 Node.js 22 이상을 요구하고 별도 임시 user data에서 실행한 뒤
기존 전면 앱을 복원한다.

2026-08-02 공개 acceptance fixture 결과:

| surface | 첫 입력 | 첫 commit 뒤 | 두 번째 입력 | 결과 |
| --- | --- | --- | --- | --- |
| 일반 문단 | native event 84개, `compositionend` 6회 | focus 유지, dirty·undo 활성 | 누적 event 106개 | 통과 |
| 일반 표 body cell | native event 84개, `compositionend` 6회 | focus 유지, dirty·undo 활성 | 누적 event 106개 | 통과 |

확장 matrix도 같은 공개 fixture에서 통과했다. 조합 중 Backspace 뒤 `한글 `과 후속 `추가 `가
정확히 반영됐고, Escape는 macOS 기본 동작대로 조합 중이던 `하`를 확정한 뒤 후속 입력을
이어갔다. 앞→뒤와 뒤→앞 2글자 선택은 각각 `한글 `로 교체됐으며, undo에서 원문과 selection
방향을 복원하고 redo에서 수정문과 caret을 복원했다.

초기 실행에서는 첫 commit 뒤 본문과 selection offset은 남았지만 편집 surface가
`activeElement`가 아니어서 두 번째 입력 event가 0개였다. 안정화된 재투영 다음 frame에 같은
source anchor를 다시 focus하고 selection 상태 덮어쓰기를 막은 뒤 위 결과를 얻었다.

## 준비

1. `npm run package:mac`으로 현재 commit의 unsigned 앱을 만든다.
2. `release/mac-arm64/Han-Flow.app`에서 저장소 밖 실사용 HWPX를 연다.
3. 전체 section loading이 끝난 뒤 `편집`을 누른다.
4. 최상위 텍스트 문단에 파란 focus outline이 표시되는지 확인한다.
5. 부분 굵게를 적용해 여러 run을 만든 뒤에도 각 run에 focus를 옮길 수 있는지 확인한다.

원본 파일은 수정되지 않는다. 결과를 남길 때는 `다른 이름으로 저장`을 사용하고 Preview
stale 경고를 확인한다. 저장하지 않고 앱을 닫은 변경은 사라진다.

## 입력 matrix

| ID | 실제 조작 | 기대 결과 | 결과 |
| --- | --- | --- | --- |
| IME-01 | 빈 caret에서 두벌식으로 2~3음절 입력 | 조합 글자가 중복·분리되지 않고 완성 문자열 한 번만 반영 | 자동 smoke 통과·물리 확인 대기 |
| IME-02 | 받침이 있는 음절과 다음 음절을 연속 입력 | 받침 이동 과정의 중간값이 undo history에 남지 않음 | 자동 smoke 통과·물리 확인 대기 |
| IME-03 | 조합 중 Backspace 후 다른 글자 입력 | 화면과 최종 source projection이 같은 문자열 | 자동 smoke 통과·물리 확인 대기 |
| IME-04 | 조합 중 Escape 또는 다른 문단 클릭 | 취소·확정 결과가 macOS 기본 동작과 일치하고 crash 없음 | Escape 자동 smoke 통과·문단 클릭 물리 확인 대기 |
| SEL-01 | 앞→뒤로 2글자를 선택해 한글로 교체 | 선택 범위만 교체되고 caret이 삽입 문자열 뒤에 위치 | 자동 smoke 통과·물리 확인 대기 |
| SEL-02 | 뒤→앞으로 2글자를 선택해 한글로 교체 | 방향을 포함한 selection이 undo에서 복원 | 자동 smoke 통과·물리 확인 대기 |
| HIST-01 | `⌘Z`, `⇧⌘Z` 실행 | 원문·수정문과 selection이 각각 정확히 복원 | 자동 smoke 통과·물리 확인 대기 |
| PAGE-01 | 줄바꿈이 달라질 만큼 연속 입력 | 페이지가 다시 나뉘어도 focus와 caret이 같은 source 문단에 유지 | 미실행 |
| FOCUS-01 | 한글 뒤 Space 입력, 2초 대기 후 재클릭 없이 추가 입력 | commit·재투영 뒤 같은 source anchor에서 입력 지속 | 자동 smoke 통과·물리 확인 대기 |
| RUN-01 | 부분 굵게 뒤 좌우 화살표로 run 경계 이동·입력 | 스타일은 유지되고 인접 run의 정확한 경계에서 입력 | 미실행 |
| BREAK-01 | Shift+Enter 입력 | 같은 문단 안에 강제 줄바꿈이 한 번 삽입되고 undo/redo에서 caret 복원 | 자동 core 통과·물리 확인 대기 |
| PARA-01 | 최상위 일반 텍스트 문단에서 Enter 입력 | caret 위치에서 두 문단으로 나뉘고 새 문단 첫 위치로 caret 이동 | 자동 core 통과·물리 확인 대기 |
| PARA-02 | 다음 문단 맨 앞에서 Backspace | 앞 문단 모양으로 병합되고 현재 caret·양쪽 글자 run 유지 | 자동 core 통과·물리 확인 대기 |
| PARA-03 | 이전 문단 맨 끝에서 Delete | PARA-02와 같은 XML 결과가 생성되고 undo에서 두 문단 복원 | 자동 core 통과·물리 확인 대기 |
| PARA-04 | 여러 최상위 문단을 선택해 입력·붙여넣기 | 시작 prefix·입력·끝 suffix만 한 문단에 남고 caret이 입력 뒤로 이동 | core/main 자동 통과·UI host 대기 |
| LIMIT-01 | 표 셀 또는 복합 문단에서 Enter·경계 삭제 | 현재 제한대로 구조 변경 없이 오류 상태 표시 | 미실행 |
| HWP-01 | `.hwp` 문서를 열기 | 편집 버튼과 editable surface가 노출되지 않음 | 미실행 |
| DIRTY-01 | 수정 뒤 다른 문서를 열고 취소 선택 | 현재 문서·수정 내용·selection 유지 | 미실행 |
| DIRTY-02 | 수정 뒤 창 닫기에서 저장 선택 | 검증형 Save As 성공 뒤 창이 닫히고 원본 유지 | 미실행 |
| DIRTY-03 | 수정 뒤 `⌘Q`에서 저장하지 않음 선택 | 명시적 discard 뒤 앱 프로세스 정상 종료 | 미실행 |

## 기록 규칙

- 수동 결과는 `통과`, `실패`, `해당 없음` 중 하나로 바꾼다. 자동 smoke만 통과한 항목은
  `자동 smoke 통과·물리 확인 대기`로 구분한다.
- 실패 시 문서 본문 대신 문서 분류, macOS version, 입력기 종류, 단계 ID, 화면 현상만 적는다.
- crash, 글자 중복, caret 소실, 다른 문단 수정, undo 경계 오류는 V3-4 blocker다.
- 글꼴 폭 때문에 페이지 위치가 한컴과 다른 현상은 별도 rendering 이슈이며, 내용 누락이나
  Han-Flow 내부 재페이지네이션 불안정과 구분한다.
