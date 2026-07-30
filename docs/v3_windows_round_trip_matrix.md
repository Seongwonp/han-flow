# V3 Windows 한/글 재열기 matrix

이 문서는 Han-Flow가 저장한 HWPX를 Windows 한/글에서 실제로 다시 열어 확인하는 V3 외부
승인 체크리스트다. 개인정보가 없는 공개 fixture만 사용하고 화면 캡처나 본문을 저장소에
추가하지 않는다.

## 준비

1. 현재 commit에서 `npm run package:mac`을 실행한다.
2. `tests/fixtures/public` 생성기로 공개 baseline HWPX를 준비한다.
3. Han-Flow에서 원본을 열고 아래 편집본을 각각 `다른 이름으로 저장`한다.
4. Windows version, 한/글 제품명과 version만 결과와 함께 기록한다.

## 재열기 matrix

| ID | 파일·조작 | Windows 한/글 기대 결과 | 결과 |
| --- | --- | --- | --- |
| WIN-01 | 수정하지 않은 identity round-trip | 오류·복구 안내 없이 열리고 본문·표·이미지 유지 | 미실행 |
| WIN-02 | 일반 문단 한글 범위 교체 | 선택 범위만 변경되고 나머지 본문 유지 | 미실행 |
| WIN-03 | 부분 굵게·12pt·색상 적용 | 선택 run에만 세 글자 모양이 표시 | 미실행 |
| WIN-04 | 문단 가운데 정렬 | 대상 문단만 가운데 정렬 | 미실행 |
| WIN-05 | 일반 body cell 텍스트 교체 | 대상 cell만 변경되고 표 구조·병합·테두리 유지 | 미실행 |
| WIN-06 | 편집본 저장 후 Han-Flow 재열기 | 공개 기준 페이지·이미지와 overflow 0 유지 | 미실행 |

## 기록 규칙

- 결과는 `통과`, `실패`, `해당 없음` 중 하나로 바꾼다.
- 실패 시 공개 fixture ID, Windows·한/글 version, 단계 ID와 비식별 현상만 기록한다.
- 한/글의 “손상된 문서를 복구” 안내, 누락된 본문·이미지, 다른 cell 변경, style reference
  오류는 V3 blocker다.
- 글꼴이 설치되지 않아 생기는 대체 글꼴·줄바꿈 차이는 구조 손실과 구분해 기록한다.
- 원본 파일 hash가 바뀌었거나 기존 목적지를 덮어쓴 결과는 즉시 실패로 판정한다.
