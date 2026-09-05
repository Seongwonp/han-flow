# 표 셀 병합·분할 구현 전략

기준일: 2026-09-05

이 문서는 단순 직사각형 HWPX 표의 행·열 추가·삭제 다음 단계인 셀 병합·분할의 안전 범위,
selection 모델, text 보존 정책과 검증 관문을 고정한다. 실제 source command는 이 계약을 먼저
테스트로 표현한 뒤 구현한다.

## 1. 현재 제약

현재 renderer와 editing capability는 표 cell마다 독립된 `rangeScope`를 사용한다. 같은 cell의
여러 문단 선택은 가능하지만 서로 다른 cell을 가로지르는 native selection은
`CROSS_STRUCTURE_SELECTION`으로 차단한다. `rowSpan` 또는 `colSpan`이 1보다 큰 cell은 text
editing surface에서도 제외한다.

이 제약은 중복 projection과 잘못된 text commit을 막는 안전장치다. 병합을 위해 cell 간 native
text selection을 열면 기존 범위 치환과 IME 계약까지 동시에 바뀌므로 첫 구현에서는 유지한다.

## 2. 채택한 selection 모델

### 2.1 첫 병합 범위

첫 기능은 **현재 안전한 body cell과 바로 오른쪽 cell의 수평 1×2 병합**만 제공한다.
사용자는 현재 cell 안에 caret을 둔 뒤 `오른쪽 셀과 병합` action을 실행한다. 별도의 드래그 범위나
다중 cell text selection은 사용하지 않는다.

병합 전 요청은 기존 `EditorSelection`으로 source cell을 찾는다. core가 오른쪽의 논리적 인접
cell을 `rowAddr`와 `colAddr + 1`로 다시 확인하므로 renderer가 전달한 table 좌표를 신뢰하지 않는다.

### 2.2 병합 후 selection

병합된 cell은 현재 정책상 읽기 전용이므로 병합 직후 renderer selection은 해제한다. history에는
살아남은 왼쪽 cell의 첫 `hp:t` anchor를 inverse locator와 `selectionAfter`로 보관한다. undo는
병합 전 selection을 복원하고 redo 뒤에는 renderer가 다시 읽기 전용 상태로 정리한다.

### 2.3 분할을 위한 후속 모델

분할은 text caret만으로 시작할 수 없다. 병합 cell에도 적용 가능한 별도의
`TableCellSelection`을 도입한다.

```ts
interface TableCellSelection {
  sectionPath: string
  textNodeId: string
  tableId: string
  sourceCellId: string
  row: number
  column: number
}
```

renderer의 `td` click이 이 상태를 만들되 core는 `textNodeId`로 실제 `hp:tc` ancestry를 찾는다.
`sourceCellId`와 좌표는 교차 검증용 힌트로만 사용하며 source XML의 주소·span을 다시 확인한다.
text selection과 cell selection은 동시에 활성화하지 않는다.

## 3. 오른쪽 cell 병합 source 정책

병합 command는 table fragment 하나만 교체하고 exact inverse에 원본 bytes를 보관한다.

1. 왼쪽 `hp:tc`를 원점 cell로 남기고 오른쪽 `hp:tc`를 제거한다.
2. 왼쪽 `hp:cellSpan`의 `colSpan`을 `2`로 바꾸고 `rowSpan=1`을 유지한다.
3. 왼쪽 `hp:cellSz width`를 두 cell 너비의 합으로 바꾼다.
4. 오른쪽 `hp:subList`의 direct `hp:p`를 원래 순서대로 왼쪽 문단 뒤에 이동한다.
5. 문단을 합치거나 인위적인 공백·줄 바꿈을 넣지 않는다. cell 경계는 문단 경계로만 보존한다.
6. geometry가 바뀌므로 살아남은 cell 안의 `hp:linesegarray`는 모두 제거한다.
7. `rowCnt`, `colCnt`, table `hp:sz`, 다른 행과 뒤쪽 cell의 `colAddr`는 바꾸지 않는다.
8. paragraph ID, run style과 알 수 없는 지원 범위 내 XML은 그대로 보존한다.

두 cell의 `borderFillIDRef`, margin, height와 vertical alignment가 모두 같을 때만 첫 기능을 연다.
이 조건은 서로 다른 배경과 외곽선 중 무엇을 선택할지 임의로 결정해 시각 의미를 잃는 일을 막는다.

## 4. fail-closed 조건

다음 중 하나라도 해당하면 source package를 바꾸지 않는다.

- 선택 cell이 마지막 열이거나 반복 머리글이다.
- 표가 direct row/cell 구조가 아니거나 주소·count가 일치하지 않는다.
- 표에 기존 `rowSpan`, `colSpan`, 중첩 표 또는 continuation이 있다.
- 두 cell 중 하나에 이미지·표·control·여러 run 등 복합 콘텐츠가 있다.
- 두 cell의 높이, margin, vertical alignment 또는 `borderFillIDRef`가 다르다.
- `hp:subList`가 하나가 아니거나 direct paragraph/text anchor가 없다.
- 고유 row/cell ID 또는 안전하게 보존할 수 없는 비정상 paragraph ID가 있다.

## 5. 분할 정책

첫 분할은 `rowSpan=1`, `colSpan=2`인 안전한 수평 병합 cell만 대상으로 한다.

- 왼쪽 cell에 기존 문단을 모두 남기고 오른쪽에는 같은 style의 빈 문단 하나를 만든다.
- 사용자의 text를 자동으로 절반 분배하지 않는다.
- 두 열의 원래 너비를 알 수 없으면 균등 분할하지 않는다. Han-Flow history 안에서 방금 만든
  병합은 inverse로 되돌리고, 저장·재개봉된 임의 병합 cell의 분할은 열 너비 근거를 확보할 때까지
  차단한다.
- 새 오른쪽 cell은 주소, span, geometry, margin과 style을 명시적으로 생성하고 paragraph ID를
  충돌 없이 만든다.
- 분할 후 selection은 새 오른쪽 빈 cell이 아니라 기존 text가 남은 왼쪽 cell의 첫 anchor로 둔다.

저장·재개봉 뒤에도 일반 분할을 지원하려면 논리 열 너비를 신뢰할 수 있는 source 근거 또는 별도
표 geometry 복원 규칙이 먼저 필요하다. 앱 내부 provenance metadata를 HWPX에 몰래 추가하지 않는다.

## 6. API와 UI 단계

1. [x] core에 `planMergeTableCellRight`와 source topology preflight를 추가한다.
2. [x] main session은 기존 `table-structure` loss policy와 transaction history를 재사용한다.
3. [x] 리본에는 안전한 일반 cell에서만 `오른쪽 셀과 병합`을 노출한다.
4. [x] 병합 후 읽기 전용 cell에는 명확한 상태 문구를 표시하고 global undo는 계속 제공한다.
5. [x] 별도 `TableCellSelection`과 cell outline을 구현한 뒤에만 `셀 분할` action을 추가한다.

## 7. 자동 검증 matrix

### 병합 성공

- 3×3 표의 첫째·중간 body 행에서 1×2 병합
- 오른쪽 문단이 왼쪽 뒤에 원래 순서로 보존
- `colSpan=2`, width 합, 오른쪽 cell 제거와 다른 주소 불변
- 반복 머리글과 다른 행 불변
- `linesegarray` 제거와 decoder projection
- exact inverse, redo, undo selection 복원
- main session, loss policy, Save As와 재개봉
- renderer action과 병합 후 selection 해제

### 병합 차단

- 마지막 열, header cell과 서로 다른 행
- 기존 병합·rowSpan·중첩 표·복합 콘텐츠
- style·margin·height·vertical alignment 불일치
- 비연속 주소, count 불일치와 고유 ID

### 분할 전 관문

- 병합 cell click selection과 text selection의 상호 배타성
- 앱 history 안의 병합을 undo하는 경로와 실제 분할 command의 구분
- 저장·재개봉된 병합 cell에서 열 너비 근거가 없을 때 fail-closed

## 8. 완료 정의

첫 병합 기능은 공개 fixture의 core·main·renderer 회귀, 전체 typecheck와 Jest, production build,
parser probe를 통과한 뒤 완료로 표시한다. Windows 한/글 재열기 전까지는 자동 구조 검증 완료와
외부 호환성 승인을 구분하며, 기능 안내에 재열기 검토를 유지한다.

2026-09-05에 첫 오른쪽 1×2 병합 기능이 이 자동 완료 정의를 통과했다. 외부 한/글 재열기는
아직 별도 승인 관문이며, 다음 구현은 병합 cell을 가리키는 `TableCellSelection` 기반이다.

같은 날 `TableCellSelection` 기반도 구현했다. 읽기 전용 병합 body cell은 click과 Enter·Space로
선택할 수 있고 선택 outline을 표시한다. text selection과는 상호 배타적이며 문서 재투영에서
`textNodeId`, table·cell identity, row·column 또는 span이 달라지면 자동 해제한다. 다음 분할
command는 `textNodeId` ancestry를 source locator로 사용하고 다른 값은 교차 검증한다.
