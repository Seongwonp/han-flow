# V3 Windows 한/글 재열기 matrix

상태: **공개 호환성 bundle 자동 생성 완료 — Windows 한/글 실기 실행 대기**

이 문서는 Han-Flow가 저장한 HWPX를 Windows 한/글에서 실제로 다시 열어 확인하는 V3 외부
승인 체크리스트다. 개인정보 없는 결정적 synthetic fixture만 사용하며 결과에는 Windows와
한/글 버전, 통과 여부와 비식별 현상만 기록한다.

## 1. macOS에서 bundle 생성

현재 commit의 production 앱으로 파일을 만들어야 한다.

```bash
npm test -- --runInBand
npm run package:mac
npm run fixture:v3-windows
```

결과는 `artifacts/v3-windows/`에 생성된다.

| 파일 | 용도 |
| --- | --- |
| `han-flow-v3-original.hwpx` | 편집 전 공개 기준 문서 |
| `han-flow-v3-identity.hwpx` | production source package의 무수정 Save As 결과 |
| `han-flow-v3-edited.hwpx` | 일반 문단 text·글자 모양·문단 모양 편집 결과 |
| `han-flow-v3-cell-edited.hwpx` | 일반 body cell 범위 편집 결과 |
| `han-flow-v3-a4-editing.hwpx` | A4 세로·20mm 여백 기준 문서 |
| `manifest.json` | commit, SHA-256와 macOS 자동 검증 결과 |
| `VERIFY_WINDOWS.ps1` | Windows 전송 후 다섯 HWPX의 SHA-256 검사 |
| `WINDOWS_RESULT_TEMPLATE.md` | 실행 환경과 WIN-01~08 기록 양식 |
| `han-flow-v3-windows-bundle.zip` | Windows로 옮길 단일 압축 파일 |

identity 생성은 `HwpxSourcePackage.open → saveHwpxAs` production 경로를 사용한다. entry 순서,
압축 방식, CRC, 크기와 content bytes가 모두 일치한 뒤에만 파일이 만들어진다. edited와
cell-edited는 패키지 앱 UI에서 실제 command를 수행하고 Save As한 뒤 Han-Flow로 다시 연다.

## 2. Windows 전송 무결성

1. `han-flow-v3-windows-bundle.zip`만 Windows PC로 옮겨 압축을 푼다.
2. 압축 해제 폴더에서 PowerShell을 열고 다음을 실행한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\VERIFY_WINDOWS.ps1
```

모든 파일이 `[PASS]`여야 한다. hash 실패는 한/글을 열기 전에 전송 실패로 처리하고 bundle을
다시 복사한다.

## 3. 실행 환경 기록

- 실행 날짜
- manifest의 Han-Flow commit
- Windows 제품명·버전·architecture
- 한/글 제품명과 정확한 버전
- 사용한 글꼴 대체 여부

## 4. 재열기 matrix

| ID | 파일·조작 | Windows 한/글 기대 결과 | 결과 |
| --- | --- | --- | --- |
| WIN-01 | `original` 최초 열기 | 복구·손상 경고 없이 열리고 본문·표·이미지 유지 | 미실행 |
| WIN-02 | `identity` 열기 후 `original`과 비교 | 복구 경고가 없고 본문·표·이미지·구역 구조가 동일 | 미실행 |
| WIN-03 | `edited` 일반 문단 text | `공개편집검증` 문자열만 선택 범위에 반영되고 나머지 본문 유지 | 미실행 |
| WIN-04 | `edited` 글자 모양 | 선택 run에 굵게·기울임·밑줄·취소선·11pt·지정 색상 표시 | 미실행 |
| WIN-05 | `edited` 문단 모양 | 가운데 정렬, 줄 간격 170%, 앞뒤 1pt, 첫 줄 들여쓰기 1pt 표시 | 미실행 |
| WIN-06 | `cell-edited` 표 cell | `공개셀검증`만 반영되고 행·열·병합·테두리·다른 cell 유지 | 미실행 |
| WIN-07 | `a4-editing` 용지 | A4 세로, 사방 약 20mm 여백과 넓은 본문 표 유지 | 미실행 |
| WIN-08 | 다섯 파일 닫기·재열기 | 복구 저장 요구 없이 결과가 유지되고 파일을 다시 열 수 있음 | 미실행 |

## 5. 판정 규칙

- 결과는 `통과`, `실패`, `해당 없음` 중 하나만 사용한다.
- 한/글의 “손상된 문서를 복구” 안내, 누락 본문·이미지, 다른 cell 변경, style reference 오류는
  V3 blocker다.
- 글꼴 미설치에 따른 대체 글꼴·줄바꿈 차이는 구조 손실과 구분해 기록한다.
- Windows에서 저장한 파일은 원본 bundle에 덮어쓰지 말고 별도 폴더에 둔다.
- 실패 캡처에는 사용자 계정명, 로컬 경로와 개인 문서를 포함하지 않는다.
- 완료한 `WINDOWS_RESULT_TEMPLATE.md`의 표와 환경 정보를 이 문서에 옮기고
  `docs/verification_history.md`에 최종 판정을 남긴다.
