# Han-Flow 검증 이력

이 문서는 구현 완료 주장에 대응하는 재현 명령, 입력 범위, 정량 결과와 발견한 결함을 날짜별로
기록한다. 포트폴리오와 릴리스 회고에서는 이 문서를 요약 자료로 사용하고, 세부 설계 판단은
연결된 기준선·bake-off·ADR을 근거로 사용한다.

실사용 문서는 저장소 밖에 두며 파일명 외 본문·캡처·생성 PDF는 커밋하지 않는다. 자동화 로그도
페이지 수, 구조 count, 비공백 문자 수, 시간·메모리와 안정적 오류 코드만 남긴다. 공개
synthetic fixture는 생성 코드와 SHA-256 manifest를 함께 커밋한다.

## 2026-09-04 — Sprint 3 여러 문단 표 cell 구조 편집

병합·span·반복 머리글·continuation이 없는 일반 body cell에서, 모든 문단이 단일 source text
run이면 cell별 range scope를 공유하도록 capability와 renderer surface를 확장했다. core는 실제
`hp:tc > hp:subList` 경계와 header·cellSpan을 검증해 같은 cell 안에서만 문단 횡단 selection,
Enter 분할과 경계 병합을 허용한다.

공개 synthetic HWPX의 일반 cell에 여러 문단을 추가해 범위 치환, 양 끝 run style 보존,
Enter 분할, 양방향 경계 병합, 다른 cell 차단과 inverse byte 복원을 검증했다. main session에서는
문단 횡단 transaction의 undo/redo, Save As와 package 재개봉까지 확인했다. 반복 머리글이 섞인
요청이 일반 run fallback으로 우회되지 않는 회귀도 추가했다. 전체 검증은 TypeScript typecheck,
Jest 34 suites·196 tests 통과(2 suites·11 tests skip), Electron production build와
privacy-safe probe 8개를 통과했다.

## 2026-09-01 — Sprint 3 문단 모양과 탭·목록 구조 보존

정렬·줄 간격·문단 앞뒤 간격·첫 줄 들여쓰기 command가 기존 paraPr를 복제할 때
`tabPrIDRef`와 `hh:heading`을 byte 의미 그대로 유지하는 불변식을 추가했다. 글자 모양에 필요한
단순 run 제한을 문단 모양에서 분리해 `hp:tab`이 포함된 최상위 일반 문단도 모양을 바꿀 수 있다.
decoder는 탭 정의 ID를 projection하고 저장 안내는 기존 탭·글머리표·번호 구조 보존 범위를 알린다.
새 탭 위치나 목록 definition을 만드는 기능은 이번 검증 범위가 아니다.

검증 결과는 TypeScript typecheck 통과, Jest 34 suite·189 test 통과(2 suite·11 test skip),
privacy-safe probe 8개 통과, Electron production build 통과다. 공개 fixture에서 인라인 탭,
bullet heading, tabPr 참조, 정렬 자식 순서와 undo inverse의 header·section byte 복원을 확인했다.

## 2026-09-01 — Sprint 2 atomic history와 저장 revision 추적

main editing session의 selection 선반영을 제거하고 transaction selection 동기화와 command apply를
`commitSynchronized` 한 연산으로 묶었다. 중간 command conflict와 history byte limit에서는
package identity, selection, undo/redo stack, 추정 bytes와 dirty/savepoint가 모두 호출 전 상태를
유지한다. undo 뒤 실패한 새 branch도 기존 redo를 보존하며 성공한 no-op은 selection만 동기화하고
history entry를 만들지 않는다.

history와 IPC에 현재 package mutation `revision`과 마지막 검증 저장의 `savedRevision`을 분리했다.
저장 성공 뒤에만 saved revision이 이동하며 undo/redo로 저장 logical state를 다시 방문하면 현재
revision이 달라도 dirty가 해제된다. renderer 상태바와 저장 완료 안내는 두 revision을 노출한다.

검증 결과는 TypeScript typecheck 통과, Jest 30 suite·176 test 통과(2 suite·11 test skip),
privacy-safe probe 8개 통과, Electron production build 통과다.

## 2026-09-01 — Sprint 2 구조 capability와 stale selection 복구

ViewerDocument의 editable anchor를 최상위 일반 텍스트와 단순 표 body cell로 분류하고 text,
글자 모양, 문단 모양과 문단 구조 capability를 selection마다 계산한다. 같은 문단의 여러 run은
text와 문단 모양, 여러 문단은 text 범위 치환만 허용한다. 표 셀은 text·내부 줄바꿈만 허용하며
Enter split, 경계 merge와 style control을 요청 전에 차단하고 구체적인 제한 이유를 표시한다.

편집 결과 selection은 새 projection에서 anchor·scope·text 길이를 다시 검증한다. 범위를 벗어난
offset은 surrogate pair를 가르지 않는 UTF-16 경계로 보정하고 한 endpoint만 남으면 collapse,
둘 다 사라지면 안전하게 해제한다. conflict 뒤에는 main session의 현재 document·revision과
selection을 `editing:refresh`로 다시 받아 renderer 상태를 복구한다.

검증 결과는 TypeScript typecheck 통과, Jest 30 suite·174 test 통과(2 suite·11 test skip),
privacy-safe probe 8개 통과, Electron production build 통과다.

## 2026-09-01 — Sprint 2 capability와 편집 오류 contract 1차

main 편집 IPC의 성공·실패를 명시적인 envelope로 통일하고 conflict, unsupported, invalid request,
not applicable, session expired, history limit, save failure와 internal code를 추가했다. 오류에는
복구 정책을 함께 싣고 분류되지 않은 내부 오류의 원문·파일 경로는 renderer에 전달하지 않는다.
Electron이 reject message 앞에 문구를 추가해도 고정 marker 뒤 payload만 복원한다.

renderer는 code별로 지원 제한, 변경되지 않은 conflict, 세션 종료와 dirty가 유지된 저장 실패를
구분한다. 인접 문단이 없는 merge의 기존 문자열 비교를 제거했고, 여러 run selection에서는 아직
지원하지 않는 글자 모양 control과 단축키를 사전에 비활성화한다. 단위 테스트는 오류 분류,
transport 복원, 내부 정보 비노출, no-op와 capability 경계를 검증한다.

검증 결과는 TypeScript typecheck 통과, Jest 30 suite·167 test 통과(2 suite·11 test skip),
privacy-safe probe 8개 통과, Electron production build 통과다.

## 2026-08-22 — Sprint 2 공통 paragraph editing host

HWPX page 묶음을 renderer의 공통 selection host로 승격했다. editable surface는 source anchor와
range scope를 노출하며 같은 section의 최상위 일반 문단만 scope를 공유한다. 표 셀 문단은 고유
scope로 격리해 최상위 문단 구조 치환과 섞이지 않는다.

native pointer drag selection을 공통 host에서 모델 selection으로 읽고 history 재투영에서는 양 끝
anchor·offset·방향을 복원한다. 좌우 경계 이동과 Shift+방향키 확장은 공통 surface 순서를 사용해
여러 run·문단을 넘는다. native selection 색을 명시하고 입력·삭제·plain-text paste와 조합 종료를
기존 `commitRange`에 연결했다. 실제 macOS 두벌식 여러 문단 조합은 물리 matrix에 남아 있다.

검증 결과는 TypeScript typecheck 통과, Jest 27 suite·155 test 통과(2 suite·11 test skip),
privacy-safe probe 8개 통과, Electron production build 통과다. selection 단위 테스트는 문단 경계
이동, 역방향 다중 문단 Shift 확장, 최상위·표 셀 scope 격리를 포함한다.

## 2026-08-22 — Sprint 2 여러 문단 범위 치환 코어

서로 다른 최상위 일반 텍스트 문단의 selection을 paragraph fragment command 하나로 치환하는
planner를 추가했다. 시작 prefix와 입력, 끝 suffix를 앞 문단 모양 아래 합치고 중간 문단을
제거한다. 양 끝 경계 run의 char style, 시작 이전·끝 이후 run, inline line break와 caret anchor를
보존하며 모든 stale `hp:linesegarray`는 결과 fragment에서 제외한다.

세 문단 공개 fixture에서 순방향 치환, 역방향 selection undo/redo와 원문 byte 복원을 검증했다.
main session은 기존 `commitRange` IPC로 여러 문단 치환 → undo → redo → Save As → 재개봉을
통과했다. 기존 표 셀·중첩 multi-run 테스트도 유지했다. 공통 paragraph host, pointer drag와
selection 시각 표시는 아직 renderer에 연결하지 않았다.

검증 결과는 TypeScript typecheck 통과, Jest 26 suite·151 test 통과(2 suite·11 test skip),
privacy-safe probe 8개 통과, Electron production build 통과다.

## 2026-08-22 — Sprint 2 문단 경계 Backspace/Delete merge

최상위 일반 텍스트 문단의 첫 run 시작 Backspace와 마지막 run 끝 Delete를 인접 문단 merge
command에 연결했다. 두 방향은 앞 문단의 문단 모양과 양쪽의 모든 글자 run을 보존하는 동일한
replacement fragment를 생성하며 stale `hp:linesegarray`를 제거한다. 현재 caret text node ID와
offset은 유지하고 inverse는 두 원문 문단 bytes를 정확히 복원한다.

여러 run과 inline line break가 있는 공개 fixture에서 양방향 결과 일치, 경계 검증, 중간 XML
element fail-closed와 history undo/redo를 통과했다. main session은 Backspace merge → undo → redo →
Save As → 재개봉을 검증했다. 표 셀·복합 문단 구조 편집과 여러 문단 선택은 후속 관문이다.

## 2026-08-21 — Sprint 2 최상위 문단 Enter split

최상위 일반 텍스트 `hp:p`를 caret 또는 단일 run selection에서 둘로 나누는 source-preserving
paragraph fragment command를 추가했다. 여러 run의 기존 XML과 char style은 앞뒤 문단에
분배하고 빈 `hp:t` anchor를 유지한다. 새 fragment에서는 stale `hp:linesegarray`를 제거하며,
inverse는 원래 문단 fragment bytes를 복원한다. renderer의 `insertParagraph`는 제한된 IPC를
거쳐 main-process history 한 단위로 commit한다.

여러 run·inline line break가 있는 공개 fixture에서 selection 제거, 새 숫자 문단 ID, cache 제거,
selection 이동과 byte-exact undo/redo를 검증했다. main session에서는 Enter split → undo → redo →
Save As → 재개봉을 통과했다. 표 셀·복합 문단 Enter와 Backspace/Delete merge는 후속 관문이다.

## 2026-08-21 — Sprint 2 HWPX inline 줄 나눔

`hp:t` 혼합 콘텐츠에서 `hp:lineBreak`와 `hp:tab`을 각각 논리 `\n`·`\t`로 읽고, 편집된 줄바꿈을
`<hp:lineBreak/>`로 다시 저장하도록 source anchor와 viewer projection을 일치시켰다. 알 수 없는
inline element는 양쪽 모두 편집 불가로 유지한다. renderer의 Shift+Enter는 native DOM 변형을
막고 `insertLineBreak` transaction을 직접 commit한다.

타입 검사와 text patch, decoder, range edit, transaction/history 핵심 테스트를 통과했다. 일반
Enter 문단 split, 경계 Backspace/Delete merge, stale `hp:linesegarray`의 구조적 무효화는 다음
paragraph fragment command 관문으로 남긴다.

## 2026-08-21 — Windows production package와 V3 자동 승인 bundle

acceptance bundle 생성기의 macOS 실행 파일 하드코딩을 제거하고 Windows에서는
`release/win-unpacked/Han-Flow.exe`를 사용하도록 변경했다. Windows 10.0.26200 x64에서
1.0.0-rc.1 `dir` package를 생성했으며 unpacked 논리 크기는 279,556,778 bytes다.

Windows packaged 앱에서 일반 문단과 표 cell 편집, 전체 제한 style, undo/redo, Save As와
저장본 재열기를 실행했다. 별도 dirty close probe는 버리기와 저장을 모두 통과했고 저장 경로는
원본 hash 불변, 저장본 3쪽과 overflow 0을 확인했다.

| 관문 | 결과 |
| --- | --- |
| Windows package | x64 `Han-Flow.exe`, production build 성공 |
| identity | 5 entries, source/container SHA-256 동일 |
| 일반 편집·style | 모든 probe flag true, 원본 불변 |
| 표 cell | `table-cell`, 저장본 3쪽·이미지 4개·overflow 0 |
| dirty discard/save | 두 경로 통과, save 결과 3쪽·overflow 0 |
| bundle integrity | PowerShell SHA-256 다섯 파일 `[PASS]` |

한컴오피스/Windows 한/글 설치는 발견되지 않았다. 따라서 WIN-01~08의 복구 경고·육안 style
판정과 한/글 재저장 후 Han-Flow 역재개봉은 외부 수동 관문으로 남긴다.

## 2026-08-21 — Sprint 0 legacy inventory와 자동 관문 완료

main·decoder worker·preload·renderer의 production 진입점과 Jest·scripts 참조를 대조했다.
도달 불가능한 초기 `parser.ts`, `normalization.ts`, `renderer-engine`, Zustand store와 이들만
사용한 `shared/types.ts`를 삭제했다. 현재 코드에서 import가 없던 `zustand`, `katex`,
`@types/katex`, `react-icons`도 package와 lockfile에서 제거했다.

과거 구현은 ZIP·resource 상한 없이 전체 base64를 만들고 unknown package 구조를 버리며,
snapshot deep copy와 직접 구조 변경을 사용하므로 experimental 사본으로도 유지하지 않는다.
현재 보기·편집 계약은 `ViewerDocument`·`FixedPageDocument`, `HwpxSourcePackage`, command와
transaction, main-process editing session으로 한정했다.

| 관문 | 결과 |
| --- | --- |
| inventory | production·development-only·legacy 판정표 작성 |
| 삭제 | legacy source 5개, 직접 dependency 4종 제거 |
| TypeScript | 임시 exclude 없이 main·core·renderer typecheck 통과 |
| Jest | 23 suites passed, 2 skipped; 133 passed, 11 skipped |
| parser probe | 8 passed |
| production build | main·preload·renderer 성공 |
| production dependency audit | 0 vulnerabilities |

## 2026-08-21 — Sprint 0 XML·이미지 resource exhaustion 방어

HWPX ordered XML을 parse하기 전에 깊이 256, node 1,000,000개, text 50,000,000자와
DOCTYPE 금지를 검사한다. `BinData`는 순차 read로 바꾸고 resource 2,000개, 개별 32 MiB,
전체 192 MiB, 한 변 32,768px, 개별 40,000,000 pixels와 전체 160,000,000 pixels 상한을
적용했다. PNG·JPEG·GIF·BMP·WebP는 decoded dimension을 header에서 확인한다.

실제 ZIP package로 만든 XML 깊이 폭탄과 PNG dimension 폭탄은 crash나 renderer decode 없이
`HWPX_IMPORT_FAILED`로 종료한다. 정상 공개 fixture와 기존 production 경로는 모두 회귀 통과했다.

| 관문 | 결과 |
| --- | --- |
| clean Windows CI | `fa64a1a`, install·122 tests·typecheck·8 probes·build 성공 |
| 로컬 clean install | Node.js 22.23.2·npm 10.9.8, 811 packages 설치 성공 |
| Jest | 23 suites passed, 2 skipped; 133 passed, 11 skipped |
| adversarial package | XML depth·PNG dimension 2종 모두 구조화 오류 통과 |
| parser probe | 8 passed |
| TypeScript | main·core·renderer 독립 typecheck 통과 |
| production build | main·preload·renderer 성공 |
| production dependency audit | 0 vulnerabilities |

## 2026-08-20 — Sprint 0 Windows 기준선과 P0 방어 착수

Windows 주 개발 환경을 공식화하고 Node.js 22·npm 10 계약과 Windows CI를 추가했다. HWPX
read-only reader가 editing source package와 동일한 ZIP metadata preflight를 사용하도록
통합했으며 Electron renderer sandbox와 HTTPS-only 외부 navigation 정책을 적용했다.

현재 작업 폴더의 OneDrive dependency 권한과 시스템 npm 부재를 제품 실패와 분리하기 위해
현재 변경을 로컬 임시 clone에 복제하고 npm 10.9.3으로 `npm ci`를 실행했다. 검증 host의
Node.js는 24.19.0이라 저장소 기준 Node 22와 다른 engine warning이 있었고, CI는 Node 22로
고정했다.

| 관문 | 결과 |
| --- | --- |
| Jest | 22 suites passed, 2 skipped; 122 passed, 11 skipped |
| parser probe | 8 passed |
| TypeScript | main·core·renderer 독립 typecheck 통과 |
| production build | main·preload·renderer 성공 |
| production dependency audit | 0 vulnerabilities |
| package notice | macOS `.app` 미생성 Windows 환경이므로 실행 대상 아님 |

초기 audit에서는 미사용 `electron-updater`와 오래된 ZIP/XML 계층을 포함해 production
취약점 4건(High 3, Moderate 1)이 보고됐다. runtime import가 없는 updater를 제거하고
`adm-zip` 0.6.0, `fast-xml-parser` 5.11.0, `unzipper` 0.12.5로 갱신한 뒤 같은 Jest, probe와
production build를 다시 통과했으며 production audit은 0건이 됐다. 전체 dev dependency
audit은 development-only semantic oracle인 `kordoc` 계층을 포함해 별도 정리 대상이다.

후속 typecheck 감사에서는 기존 tsconfig의 core 누락과 renderer 상대경로 오류를 수정했다.
production에서 import되지 않는 초기 parser·normalization·renderer-engine과 과거 store는
명시적인 legacy 제거 대상으로 격리했다. 살아 있는 코드에서 발견된 CFB blob, nullable window,
PDF dialog overload, editable content union과 native InputEvent listener 타입 오류를 수정한 뒤
`npm run typecheck`를 통과했다.

## 2026-08-09 — V4-0 macOS 배포 기준선 감사

Apple·Electron·electron-builder의 공식 배포 문서를 기준으로 Developer ID 직접 배포 순서를
정리하고, credential 없이 반복 가능한 `npm run release:audit`를 추가했다.

| 감사 항목 | 결과 |
| --- | --- |
| package 설정 | arm64 로컬 `dir`, `identity: null` |
| 현재 app 서명 | ad-hoc, TeamIdentifier 없음, Developer ID 아님 |
| strict 서명 검증 | 배포용 sealed resource 조건 불충족 |
| architecture | Electron app/framework arm64, `font-list` helper universal |
| updater | 당시 dependency만 존재, runtime 연결 없음; 2026-08-20 미사용 dependency 제거 |
| 공개 배포 판단 | 차단 유지 — 인증서·공증·stapling·clean account 검증 필요 |

이 결과는 배포 실패가 아니라 의도적인 개인용 빌드의 기준선이다. 실제 release 설정에는
`forceCodeSigning`을 사용하고, DMG+ZIP·공증·stapling·Gatekeeper 검증을 통과하기 전에는 공개
artifact를 만들지 않는다. 상세 출처와 후속 관문은 [V4 macOS 배포 전략](v4_release_strategy.md)에
기록했다.

### x64·Universal 무인증서 package 실험

공식 Electron 28.3.3 x64 ZIP은 GitHub release의 `SHASUMS256.txt`와 SHA-256
`6bc63916b7fe52de7559e7631fef5c93315a18ee90a0d3d08168c91414b09ecf`가 일치하고 ZIP test를
통과한 뒤 사용했다. arm64/x64 app을 `@electron/universal`로 병합했고 모든 Mach-O를 검사했다.

| artifact | architecture 관문 | 논리 크기 | production smoke |
| --- | --- | ---: | --- |
| arm64 | 16개 중 arm64 15 + universal 1 | 339,563,671 byte | 3쪽·이미지 4·overflow 0 |
| x64 | 16개 중 x64 15 + universal 1 | 345,097,640 byte | Rosetta 지원 종료 알림 확인 |
| Universal | 16개 모두 arm64+x86_64 | 525,279,804 byte | native arm64 3쪽·이미지 4·overflow 0 |

세 app이 같은 bundle ID로 동시에 존재한 상태에서는 LaunchServices 경로 충돌로 native arm64도
`HIServices._RegisterApplication`에서 `SIGABRT`했다. crash report의 `Code Type: ARM-64
(Native)`로 Rosetta 문제가 아님을 확인했고, 대상 app을 다시 등록한 뒤 같은 E2E가 통과했다.

Apple은 일반 Intel Mac app용 Rosetta를 macOS 27까지만 제공하고 macOS 28부터 일부 오래된
게임만 예외로 둔다. macOS 26.4부터 실제 지원 종료 알림도 표시되므로 V4 공개 artifact는
arm64-only로 확정했다. x64/Universal 명령과 전수 검사기는 `experiment:*`로만 유지한다.

## 2026-08-09 — V3 Windows 한/글 공개 호환성 bundle

Windows PC에서 코드나 개인정보 없이 즉시 외부 승인을 실행할 수 있도록
`npm run fixture:v3-windows` 관문을 추가했다. production `HwpxSourcePackage → saveHwpxAs`로
identity 파일을 만들고, 패키지 앱 UI로 일반 문단 전체 style 편집본과 표 cell 편집본을 각각
저장·재열기한다.

| macOS 사전 관문 | 결과 |
| --- | --- |
| identity | 5 entries의 metadata·content identity 통과, container SHA 차이 여부 별도 기록 |
| 일반 문단 편집본 | 원본 불변, 전체 style probe 통과, 3쪽·이미지 4개·overflow 0 |
| 표 cell 편집본 | `table-cell` surface, 원본 불변, 3쪽·이미지 4개·overflow 0 |
| 전송 파일 | 다섯 HWPX SHA-256 manifest 교차 검증 통과 |
| 실행 자료 | Windows PowerShell 검사·WIN-01~08 체크리스트·결과 양식 생성 |

이 결과는 Windows 한/글 호환성 통과가 아니라 **실기 입력 준비 완료**다. 최종 통과 여부는
Windows·한/글 버전을 기록하고 실제 한/글에서 다섯 파일을 열어 판정한 뒤 별도로 남긴다.

## 2026-08-02 — V3-6D 첫 줄 들여쓰기·내어쓰기

공식 OWPML `CMargin`의 `hc:intent`를 첫 줄 indent로 projection하고 source command에 연결했다.
−72pt부터 72pt까지 허용하며 음수는 내어쓰기, 양수는 들여쓰기다. `hh:margin`의 다른 네 값과
unknown XML은 보존하고 inverse는 원본 header·section bytes를 복원한다.

| 관문 | 결과 |
| --- | --- |
| production build/package | main·preload·renderer 및 unsigned arm64 `.app` 성공 |
| Jest | 22 suites, 119 passed, 1 suite skipped |
| packaged 양방향 probe | −1pt 내어쓰기 → 0pt → +1pt 들여쓰기 통과 |
| 저장본 XML | `hc:intent` −100·0·100 HWPUNIT definition 확인 |
| Save As·재열기 | 원본 불변, 2쪽, 이미지 3개, overflow 0 |

검증은 공개 A4 synthetic fixture만 사용했고 저장본은 임시 경로에만 두었다.

## 2026-08-02 — V3-6C 줄 간격·문단 앞뒤 간격

`ApplyParagraphStyleCommand`를 정렬 전용에서 줄 간격과 문단 앞·뒤 간격까지 확장했다. 줄
간격은 100–300% `PERCENT`, 앞·뒤 간격은 0–72pt의 HWPUNIT만 허용한다. 기존 `paraPr`를
복제하므로 좌우 여백·들여쓰기·unknown XML은 그대로 남고 inverse는 header와 section bytes를
원래 상태로 복원한다.

| 관문 | 결과 |
| --- | --- |
| production build/package | main·preload·renderer 및 unsigned arm64 `.app` 성공 |
| Jest | 22 suites, 118 passed, 1 suite skipped |
| packaged style probe | 줄 간격·문단 앞·뒤 간격 조절기 모두 적용 |
| A4 Save As | 원본 불변, 저장본 존재, ZIP 무결성 통과 |
| 저장본 재열기 | 2쪽, 이미지 3개, overflow 0 |
| 저장 XML | 170%, 앞 100 HWPUNIT, 뒤 100 HWPUNIT 확인 |

검증은 공개 A4 synthetic fixture만 사용했다. 저장본은 임시 경로에 두고 공개 저장소에
포함하지 않는다.

## 2026-08-02 — V3-6B 기울임·밑줄·취소선

한컴 공개 `hwpx-owpml-model`의 `CharShapeType`, `italic`, `underline`, `strikeout` 구현을
기준으로 글자 장식 command를 확장했다. 새 definition은 공식 자식 순서를 유지하고, 해제는
기존 장식의 나머지 속성을 보존한 채 활성 판정 속성을 `NONE`으로 바꾼다. 부분 selection의
run 분할, definition 재사용과 inverse는 기존 source 기반 history 경계를 그대로 사용한다.

| 관문 | 결과 |
| --- | --- |
| production build | main/preload/renderer 성공 |
| Jest | 22 suites, 116 passed, 1 suite skipped |
| style source test | 요소 순서·projection·해제·header/section inverse 통과 |
| packaged A4 style | 기울임·밑줄·취소선 적용, Save As와 저장본 재열기 통과 |
| 저장본 XML | `italic`, `underline type="BOTTOM"`, `strikeout shape="SOLID"` 확인 |

검증 입력과 저장본은 공개 A4 synthetic fixture 및 임시 경로만 사용했다. 다음 code slice는
문단 줄 간격과 문단 앞뒤 간격이며, Windows 한/글 재열기는 계속 외부 승인 관문으로 남긴다.

## 2026-08-02 — V3-6A A4 편집 fixture와 홈 리본

기존 `10000 × 10000 HWPUNIT` fixture는 pagination과 표 continuation을 작은 입력으로 빠르게
검증하려고 의도적으로 만든 약 35mm 정사각형 스트레스 문서였다. 이를 실제 사용 화면으로
오해하지 않도록 `59528 × 84189 HWPUNIT` A4 세로, 사방 `5669 HWPUNIT`(약 20mm) 여백과
`48190 HWPUNIT` 본문 표를 가진 별도 공개 편집 fixture를 acceptance bundle에 추가했다.

편집 UI는 52px toolbar 한 줄 안의 25px control에서 상단 문서 제어와 `홈` 리본의 2단 구조로
바꿨다. 파일, 기록, 글자 모양, 문단 정렬 그룹에 현재 안전하게 저장되는 Save As, undo/redo,
굵게·크기·색상과 정렬만 배치했다. packaged E2E가 DOM 실측으로 toolbar 168px, 최소 action
button 40px, 활성 `홈` 탭과 네 group label을 확인한다.

A4 첫 synthetic composition에서는 본문 patch는 성공했지만 짧은 입력의 projection 뒤 selection
복원이 간헐적으로 시간 초과됐다. 긴 입력은 뒤따른 재조판이 우연히 selection 복원을 다시
일으켜 통과하고 있었다. layout measurement identity를 input surface의 restore token으로 전달하고,
composition/buffer가 끝난 경우에만 120ms·350ms 제한 지연 복원을 수행해 늦은 A4 재조판과의
경쟁을 제거했다. 수정 뒤 짧은 `리본검증`도 projection·undo·redo text와 selection을 통과했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 22 suites, 114 passed, 1 suite skipped |
| production package | `npm run package:mac` | arm64 unsigned `.app` 성공 |
| A4 구조 | `tests/parser/public_fixture.test.ts` | A4 크기·20mm 여백·본문 표 폭·본문 8개 통과 |
| A4 packaged edit | `HAN_FLOW_VERIFY_EDIT_TEXT=리본검증 npm run verify:app -- artifacts/v3-acceptance/han-flow-v3-a4-editing.hwpx` | 2쪽·overflow 0, projection·undo/redo selection, 홈 리본 실측 통과 |
| acceptance bundle | `npm run fixture:v3-acceptance` | 원본 불변, style·Save As·3쪽·이미지 4개 재열기 통과, A4 fixture 생성 |

리본 화면 캡처와 생성 HWPX는 `artifacts/` 또는 임시 경로에만 두며 공개 저장소에는 결과물을
커밋하지 않는다. 재현 가능한 생성 코드와 privacy-safe 수치만 기록한다.

## 2026-08-02 — 실제 macOS 두벌식 확장 입력 matrix

공개 acceptance fixture와 패키지 앱에서 `System Events` 실제 key code 검증을 조합 중
Backspace·Escape, 앞→뒤·뒤→앞 범위 치환과 실제 `⌘Z`·`⇧⌘Z`까지 확장했다. 각 결과는
native composition/input event, source anchor focus, 본문, selection 방향, dirty와 undo/redo
상태로 판정한다.

| 시나리오 | 결과 |
| --- | --- |
| 일반 문단·표 셀 기본 입력 | Space commit → 2초 대기 → 재클릭 없는 후속 입력 통과 |
| 조합 중 Backspace | `한` 조합 수정 뒤 `한글 ` 확정, 후속 `추가 ` 입력 통과 |
| 조합 중 Escape | macOS 기본 동작대로 `하` 확정, 후속 `검증 ` 입력과 focus 유지 |
| 정방향 범위 치환 | 마지막 2글자 교체, undo 원문·정방향 selection, redo 수정문 복원 |
| 역방향 범위 치환 | 마지막 2글자 교체, undo 역방향 anchor/focus, redo caret 복원 |
| history 단축키 | 실제 `⌘Z`·`⇧⌘Z`로 원문·수정문·caret·dirty 상태 복원 |

전체 명령 `npm run verify:ime:mac:matrix`의 7개 시나리오가 연속 통과했다. 최초 연속 실행은
첫 앱 종료 직후 새 표 셀 인스턴스에 OS key event가 0개 전달되는 자동화 실패를 발견했다.
표 셀 단독 실행은 통과했고, 전면 앱 활성화와 renderer surface focus 사이의 경쟁으로 확인했다.
각 인스턴스에서 OS로 Han-Flow를 전면화한 뒤 CDP가 같은 source anchor와 selection을 다시
확정하도록 probe를 보강하고 전체 matrix를 재실행해 통과했다.

이 결과는 실제 macOS 입력기를 거치지만 물리 키보드를 이용한 사용자 손 입력, 다른 문단 클릭,
페이지 재분할 장시간 입력을 대신하지 않는다. 해당 항목과 Windows 한/글 재열기는 V3 외부 승인
관문으로 남긴다.

## 2026-08-02 — 실제 macOS 두벌식 commit 뒤 focus 복원

synthetic `CompositionEvent` E2E가 통과한 뒤에도 사람이 입력하면 첫 commit 다음 글자가 같은
surface에 들어가지 않는 결함을 화면 녹화로 확인했다. macOS `System Events`가 현재 두벌식
입력기에 key code를 보내고 CDP가 native composition/input event, `activeElement`, source
anchor, dirty와 undo 상태를 읽는 공개 fixture 전용 probe를 추가했다.

첫 실제 key probe는 `한글입력검증 `의 본문과 selection offset을 보존하고 undo도 활성화했지만,
2초 뒤 편집 surface의 focus가 빠져 재클릭 없는 `추가 ` 입력 event가 0개였다. 원인은 source
transaction 결과가 새 document로 projection된 뒤 동기 selection 복원보다 늦게 focus가
유실되는 순서였다. 같은 source anchor의 DOM이 안정된 다음 두 animation frame에 focus와
selection을 다시 복원하고, 프로그램 복원 중 발생한 focus event가 과거 selection을 부모
상태에 쓰지 못하도록 막았다.

IME adapter는 연속된 macOS 음절별 composition cycle을 450ms burst 하나로 모아 source
transaction 한 건을 만들며, 입력 listener는 React callback identity 변경에 따라 재설치되지
않는다. packaged E2E도 listener의 `data-input-ready`를 기다리고 실제 focus render 뒤 현재
surface를 다시 찾는다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 22 suites, 113 passed, 1 suite skipped |
| production package | `npm run package:mac` | arm64 unsigned `.app` 성공 |
| synthetic IME/history | `HAN_FLOW_VERIFY_EDIT_TEXT=한글입력검증 npm run verify:app -- artifacts/v3-acceptance/han-flow-v3-original.hwpx` | projection·undo·redo text와 selection 일치, overflow 0 |
| 실제 두벌식 일반 문단 | `npm run verify:ime:mac -- --surface paragraph` | Space commit 뒤 focus·dirty·undo 유지, 재클릭 없는 추가 입력 통과 |
| 실제 두벌식 표 셀 | `npm run verify:ime:mac -- --surface cell` | Space commit 뒤 focus·dirty·undo 유지, 재클릭 없는 추가 입력 통과 |

두 native smoke는 각각 첫 단계 84개, 두 번째 단계 누적 106개 event를 관찰했고
`compositionend`는 6회에서 8회로 증가했다. 공개 fixture 외 본문·캡처는 기록하지 않았다.
Backspace·Escape·방향 selection을 포함한 물리 키보드 전체 matrix와 Windows 한/글 재열기는
여전히 V3 외부 승인 관문이다.

## 2026-07-30 — V3 코드 완료 후보: 여러 run 입력과 글자 크기·색상

부분 글자 style로 한 문단이 여러 run으로 나뉜 뒤에도 source anchor별 입력 surface를
유지하도록 연결했다. 좌우 화살표는 run 경계에서 인접 anchor의 처음·끝으로 selection을
옮긴다. React projection이 run 수를 바꿀 때 기존 DOM의 오래된 selection offset을
재사용하지 않도록 입력 surface key와 offset 범위를 방어했다.

글자 style command에는 기존 굵기와 같은 원본 definition clone·reuse 경계로 5–72pt 크기와
`#RRGGBB` 색상을 추가했다. 글꼴 family는 font-face ID와 설치·라이선스 mapping을 함께
확정해야 하므로 V3 완료 조건에서 제외했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 22 suites, 112 passed, 1 suite skipped |
| production build/package | `npm run build`, `npm run package:mac` | main·preload·renderer, arm64 unsigned `.app` 성공 |
| packaged text | `HAN_FLOW_VERIFY_EDIT_MODE=range HAN_FLOW_VERIFY_EDIT_TEXT=일반검증 npm run verify:app -- <private.hwpx>` | projection·undo/redo selection 통과 |
| packaged style | `HAN_FLOW_VERIFY_STYLE=1 ... npm run verify:app -- <private.hwpx>` | 부분 run split·굵게·정렬·undo/redo·여러 run surface 통과 |
| packaged Save As | `HAN_FLOW_VERIFY_EDIT_SAVE=1 ... npm run verify:app -- <private.hwpx>` | 원본 불변·저장본 재열기 통과 |
| 공개 HWPX matrix | `npm run verify:matrix` | 5종 통과, 최대 9,767쪽·DOM 12개·overflow 0 |

style과 Save As를 한 프로세스에서 연속 실행하는 합성 probe는 간헐적으로 시작 또는 종료
대기 시간이 초과돼, 기능 판정은 각각의 packaged gate와 style→정렬→Save As→재개봉 main
통합 테스트로 교차 확인했다. 이 자동화 불안정은 실제 기능 통과와 구분해 기록한다. V3의
남은 승인 관문은 실제 macOS 두벌식과 Windows 한/글 재열기다.

## 2026-07-30 — V3-5B 표 body cell text 편집

기존 text source anchor와 transaction을 일반 표 body cell의 단일 문단·단일 run까지
연결했다. pagination 과정에서 동일 source anchor가 복제될 수 있는 반복 머리글과
continuation fragment, 구조 변경 위험이 큰 병합·`rowSpan`·여러 문단 cell은 입력 surface를
열지 않는다. 표 셀은 text 입력만 지원하며 style toolbar 범위에는 포함하지 않는다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 22 suites, 109 passed, 1 suite skipped |
| main session | `tests/main/editing_session.test.ts` | body cell commit·selection·undo/redo 통과 |
| renderer eligibility | `tests/renderer/measurement.test.ts` | 일반 cell 허용, 반복·병합·fragment 차단 통과 |
| production build/package | `npm run package:mac` | main·preload·renderer, arm64 unsigned `.app` 성공 |
| 공개 baseline cell | `npm run verify:matrix` | 범위 편집·undo/redo·Save As, 저장본 3쪽·이미지 4개 |
| 공개 구조 회귀 | 같은 matrix | continuation 2쪽, 병합/rowSpan 이미지 12개, overflow 0 |
| 공개 대형 회귀 | 같은 matrix | 9,767쪽·DOM 12개·overflow 0 |

공개 packaged probe는 원본 SHA-256 불변, projection 뒤 selection, undo/redo selection과
dirty 해제를 확인했다. fixture에는 Preview entry가 없어 저장 상태가 `Preview 없음`으로
표시되는 경로도 검증했다. 본문·캡처·저장본은 커밋하지 않았다.

## 2026-07-29 — V3-5 부분 selection 문단·글자 style

최상위 일반 문단의 단일 `hp:t` source anchor에서 실제 run과 paragraph를 찾고, 원본
`charPr`·`paraPr`를 복제해 굵게와 정렬 4종만 바꾸는 첫 style slice를 연결했다. 같은
definition은 재사용하며 새 ID는 기존 숫자 ID 최대값 다음 값으로 결정적으로 할당한다.
header collection count, definition과 section reference를 함께 변경하고 undo에서는 두
entry의 원본 bytes를 복원한다. 이어서 `hp:t` 내부 부분 selection을 좌·선택·우 최대 3개
run으로 분할하고 선택 run만 새 글자 style을 참조하도록 확장했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 22 suites, 107 passed, 1 suite skipped |
| style 코어 | `tests/editing/style_patch.test.ts` | clone·reuse·run split·entity 의미·byte undo/redo 통과 |
| main session | `tests/main/editing_session.test.ts` | 새 anchor 선택 이동·부분 style undo/redo와 caret 이동 통과 |
| production build | `npm run build` | main·preload·renderer 성공 |
| macOS package | `npm run package:mac` | arm64 unsigned `.app` 성공 |
| packaged style | `HAN_FLOW_VERIFY_EDIT_MODE=range HAN_FLOW_VERIFY_EDIT_TEXT=스타일검증 HAN_FLOW_VERIFY_STYLE=1 HAN_FLOW_VERIFY_EDIT_SAVE=1 npm run verify:app -- <private.hwpx>` | 부분 run split·굵게·정렬·undo/redo·Save As 통과 |
| 저장본 화면 | 같은 packaged probe의 두 번째 프로세스 | 8쪽·이미지 4개·overflow 0 |
| 공개 HWPX matrix | `npm run verify:matrix` | 5종 통과, 최대 9,767쪽·DOM 12개·overflow 0 |
| 배포 고지 | `npm run verify:notices` | Apache-2.0·rhwp MIT·third-party notice 일치 |

packaged probe는 원문이나 캡처를 남기지 않고 부분 run 생성, style 버튼 상태, projection 뒤
결과, undo/redo 원복 여부와 구조 count만 수집했다. 원본 SHA-256은 변하지 않았으며 임시
저장본을 다시 연 뒤 삭제했다. 프로그램으로 주입한 composition commit은 실행 환경에 따라
간헐적으로 늦어질 수 있어 이 관문은 결정적인 범위 교체를 사용했고, composition-only
패키지 probe는 별도로 통과했다.

이 시점의 글자 모양은 단일 `hp:t` 전체 또는 내부 부분 selection의 굵게, 문단 모양은 최상위
일반 문단 정렬만 지원했다. 분할 뒤 여러 run의 style 재적용과 undo는 가능하지만 하나의
연속 text 입력 surface는 아직 제공하지 않는다. 표 cell text는 다음 날 제한적으로
연결했으며 머리말·꼬리말, 원래부터 복합인 run과 다른 style 속성은 계속 차단한다.

## 2026-07-29 — V3 dirty 문서 교체·종료 보호

main history의 dirty 상태를 파일 교체와 BrowserWindow lifecycle에 연결했다. 열기 dialog,
drop과 Finder `file:open`은 새 import 전에 저장/버리기/취소 결과를 기다리고, 창 닫기와
`⌘Q`는 main이 같은 결정을 직접 처리한다.

첫 packaged discard probe는 비동기 결정 뒤 승인된 두 번째 `window.close()`도
`resolvingClose`가 막아 macOS 프로세스가 남는 결함을 찾았다. 승인 상태를 중복 결정 상태보다
먼저 판정하고, 앱 종료 요청이면 BrowserWindow `closed` 이후 quit을 재개하도록 수정했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 21 suites, 99 passed, 1 suite skipped |
| dirty discard | `HAN_FLOW_VERIFY_EDIT_TEXT=한 HAN_FLOW_VERIFY_CLOSE_DIRTY_ACTION=discard npm run verify:app -- <private.hwpx>` | 새 파일 없이 정상 종료 |
| dirty close-save | `HAN_FLOW_VERIFY_EDIT_MODE=range HAN_FLOW_VERIFY_EDIT_TEXT=교체 HAN_FLOW_VERIFY_CLOSE_DIRTY_ACTION=save npm run verify:app -- <private.hwpx>` | 원본 hash 불변·저장본 생성·재열기 통과 |
| 저장본 화면 | close-save 두 번째 프로세스 | 8쪽·overflow 0 |

programmatic composition은 환경에 따라 commit event 주입이 불안정할 수 있어 lifecycle
probe에는 결정적인 역방향 범위 교체를 사용했다. 실제 composition 관문과 물리 두벌식 수동
matrix는 별도로 유지한다.

## 2026-07-29 — V3-4 검증형 Save As UI

main-process 편집 session에 검증형 Save As를 연결했다. 사용자는 Preview가 갱신되지 않을 수
있다는 경고를 확인한 뒤 새 `.hwpx` 목적지만 고를 수 있다. renderer에는 raw package,
destination writer나 범용 저장 IPC를 노출하지 않으며 과거 `dialog:saveFile`과
`dialog:confirmSave` preload API는 제거했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 21 suites, 99 passed, 1 suite skipped |
| session Save As | `tests/main/editing_session.test.ts` | 원본 불변·기존 목적지 충돌·savepoint·undo/redo 5건 통과 |
| production package | `npm run package:mac` | arm64 unsigned `.app` 성공 |
| packaged Save As | `HAN_FLOW_VERIFY_EDIT_TEXT=한 HAN_FLOW_VERIFY_EDIT_SAVE=1 npm run verify:app -- <private.hwpx>` | dirty 해제·원본 hash 불변·저장본 재열기 통과 |
| 저장본 화면 | 같은 packaged probe의 두 번째 프로세스 | 8쪽·이미지 4개·overflow 0 |

저장 성공 뒤에만 savepoint가 이동한다. 저장 실패나 취소는 현재 package와 dirty 상태를
바꾸지 않는다. probe는 임시 목적지를 사용하고 원문 대신 길이·hash 불변 여부·구조 count만
출력한 뒤 저장본을 삭제한다.

## 2026-07-29 — V3-4 selection과 re-pagination 복원

편집 projection이나 re-pagination으로 기존 DOM이 교체되어도 selection의 source anchor에
해당하는 새 surface를 찾아 focus와 UTF-16 anchor/focus offset을 복원하도록 강화했다.
정방향 caret뿐 아니라 뒤→앞 범위 selection도 방향을 보존한다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 21 suites, 97 passed, 1 suite skipped |
| composition selection | `HAN_FLOW_VERIFY_EDIT_TEXT=한 npm run verify:app -- <private.hwpx>` | projection·undo·redo caret 일치 |
| 역방향 범위 교체 | `HAN_FLOW_VERIFY_EDIT_MODE=range HAN_FLOW_VERIFY_EDIT_TEXT=교체 npm run verify:app -- <private.hwpx>` | 본문·projection·undo·redo selection 일치 |
| re-pagination | 같은 composition probe | 2·3페이지 문자 분배 변경, 8쪽·이미지 4개·overflow 0 유지 |

probe는 원문 대신 원문 UTF-16 길이와 각 단계 일치 여부만 출력한다. 실제 키보드 두벌식
입력은 [수동 matrix](v3_ime_manual_matrix.md)에 남겨 자동 event 주입과 구분한다.

## 2026-07-29 — V3-4 paragraph IME surface 첫 slice

ordered XML `hp:t`의 section ordinal을 `ViewerText.sourceAnchor`에 보존하고, renderer의
`plaintext-only` 문단 surface가 native `beforeinput`·composition·input event를 source
transaction으로 바꾸도록 연결했다. browser가 조합 중 DOM을 소유하며 중간값은 commit하지
않고 `compositionend`에서 완성된 UTF-16 최소 diff 하나만 main process로 보낸다.

source package와 bounded history는 sender/session에 묶인 main-process manager가 소유한다.
commit·undo·redo는 sender별 queue로 직렬화하며 renderer에는 raw package bytes와 base
revision을 노출하지 않는다. 첫 UI 범위는 완전히 로드된 HWPX의 최상위 단일 text 문단이고
표·머리말·꼬리말·복합 run·HWP는 계속 읽기 전용이다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 21 suites, 97 passed, 1 suite skipped |
| IME adapter | `tests/editing/composition_input.test.ts` | 조합 중 0회·종료 1회 commit, 삭제·취소·emoji 경계 통과 |
| main session | `tests/main/editing_session.test.ts` | sender binding·commit·undo·redo projection 3건 통과 |
| production build/package | `npm run package:mac` | main/preload/renderer, arm64 `.app` 성공 |
| packaged IME probe | `HAN_FLOW_VERIFY_EDIT_TEXT=한 npm run verify:app -- <private.hwpx>` | 8쪽·이미지 4개·overflow 0, 편집·undo·redo 일치 |

probe 결과에는 원문이나 수정 본문을 남기지 않고 길이와 일치 여부, editable count만 기록한다.
실제 물리 키보드 두벌식 입력과 범위 selection·re-pagination caret matrix는 남아 있으므로
V3-4 전체 완료로 표현하지 않는다. 저장 UI도 아직 연결하지 않았다.

## 2026-07-29 — V3-3 transaction과 bounded history

여러 `ReplaceTextCommand`를 base revision과 전후 selection을 가진 하나의 원자적
`EditTransaction`으로 묶었다. 성공 결과는 inverse transaction과 loss report를 만들고,
수정 source package를 기존 viewer decoder로 즉시 projection한다.

history는 문서 snapshot 대신 forward/inverse delta만 기본 100 entries·추정 8 MiB로 제한한다.
연속 typing grouping은 input type, 같은 anchor, selection 연속성, 시간 창과 composition 경계를
함께 사용한다. savepoint는 logical state ID로 추적해 package revision이 계속 증가해도
undo가 저장 상태로 돌아오면 dirty가 정확히 해제된다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 19 suites, 89 passed, 1 suite skipped |
| transaction/history | `tests/editing/transaction_history.test.ts` | atomicity·inverse·grouping·limit·savepoint·Save As 8건 통과 |
| private history | `HAN_FLOW_PRIVATE_HWPX=<path> npm test -- --runInBand tests/editing/transaction_history.test.ts` | undo·redo·Save As·원본 hash 불변 |
| production build/package | `npm run package:mac` | main/preload/renderer, arm64 `.app` 성공 |
| HWPX production matrix | `npm run verify:matrix` | 5종, 최대 9,767쪽·DOM 12개·overflow 0 |

사용자 입력 UI는 아직 없다. 다음 관문은 paragraph surface에서 native composition과 selection을
source anchor transaction으로 변환하고 실제 macOS 두벌식 입력을 검증하는 V3-4다.

## 2026-07-29 — V3-2 source text patch와 검증형 Save As

UTF-8 section 원문에서 단순 `hp:t` content span만 수정하는 `ReplaceTextCommand`를 구현했다.
문서 순서 기반 source ID, package revision과 UTF-16 range를 함께 확인하고 inverse command를
만든다. target 밖 XML과 다른 entry는 재직렬화하지 않는다.

Save As는 같은 directory의 배타적 임시 파일을 flush하고 package identity, 기존 viewer decode,
선택 semantic 검증을 모두 통과한 뒤 hard link로 존재하지 않는 목적지 이름만 만든다. 원본
overwrite와 기존 목적지 overwrite는 차단한다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 18 suites, 81 passed, 1 suite skipped |
| text fixture | `tests/editing/text_patch.test.ts` | escape·빈 node·unsupported node·inverse·conflict·fault 6건 통과 |
| private patch | `HAN_FLOW_PRIVATE_HWPX=<path> npm test -- --runInBand tests/editing/text_patch.test.ts` | 한 text patch·Save As·원본 hash 불변 |
| production build | `npm run build` | main/preload/renderer 성공 |
| HWPX production matrix | `npm run verify:matrix` | 5종, 최대 9,767쪽·DOM 12개·overflow 0 |

사용자 저장 버튼은 아직 없다. 다음 품질 관문은 여러 command를 하나의 transaction으로 묶고
delta history, undo/redo와 savepoint를 검증하는 V3-3이다.

## 2026-07-29 — V3-1 HWPX source package identity

모든 ZIP entry를 원본 순서와 uncompressed bytes, compression, CRC로 보유하는
`HwpxSourcePackage`를 추가했다. 과거 serializer는 header와 section만 재생성해 unknown XML,
이미지와 package entry를 잃었고 잘못된 mimetype을 기록했으므로 preload/main 저장 IPC와 함께
제거했다. 사용자 저장 기능은 아직 노출하지 않는다.

공개 round-trip fixture에는 unknown namespace·attribute·XML node, PNG, stored binary,
directory entry, Preview와 META-INF를 넣었다. 재패킹 전후 entry metadata와 각 파일 SHA-256이
일치하고 기존 HWPX reader가 결과를 다시 여는지 확인했다. 저장소 밖 실사용 HWPX도 파일명·본문을
assertion이나 결과에 출력하지 않는 선택 테스트로 같은 identity 관문을 통과했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 17 suites, 75 passed, 1 suite skipped |
| private identity | `HAN_FLOW_PRIVATE_HWPX=<path> npm test -- --runInBand tests/parser/source_package.test.ts` | entry metadata·SHA-256 일치 |
| production build/package | `npm run package:mac` | main/preload/renderer, arm64 `.app` 성공 |
| HWPX production matrix | `npm run verify:matrix` | 5종, 최대 9,767쪽·DOM 12개·overflow 0 |

Windows 한/글에서 identity 결과를 다시 여는 외부 호환성 확인은 남아 있다. 그 전까지
V3-1을 저장 UI 완료로 표현하지 않으며, 다음 구현은 source anchor 기반 한 text node patch와
검증된 Save As다.

## 2026-07-27 — V2 공통 importer 완료

관련 구현: `35e26e4` (`문서 가져오기 IPC 경계 통합`)

HWP의 main preflight와 HWPX의 package/점진 decoder를 format-neutral `DocumentImporter`로
모았다. preload와 React loader가 `document:import`, `document:complete`,
`document:error` 계약만 사용하도록 변경했고 창 종료 시 진행 중인 decoder Worker를
정리한다. 실행 경로에 없고 항상 실패하던 과거 HWP prototype은 제거했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 16 suites, 62 passed, 1 skipped |
| importer 경계 | `tests/main/document_importer.test.ts` | HWP/HWPX/확장자/오류 4건 통과 |
| production build | `npm run build` | main/preload/renderer build 성공 |
| macOS package | `npm run package:mac` | arm64 `.app` 생성 성공 |
| HWP production matrix | `npm run verify:hwp-matrix` | 2쪽·PDF 98.6%·오류 5종 통과 |
| HWPX production matrix | `npm run verify:matrix` | 5종, 최대 9,767쪽·DOM 12개 통과 |
| probe 테스트 | `npm run test:probe` | 8 passed |
| 배포 고지 | `npm run verify:notices` | Apache-2.0, rhwp MIT, notice 일치 |

이 결과로 V2의 parser 선택, 안전한 열기, 화면·검색·PDF, 성능·메모리 기준선, 공개 fixture,
오류 taxonomy와 importer 경계 완료 조건이 모두 충족됐다. 다음 milestone은 V3 편집 기반
설계이며, 현재 read-only 모델을 즉시 `contentEditable`로 바꾸지 않고 editable model과
무손실 저장 계약부터 검증한다.

## 2026-07-27 — HWP FileHeader 안전한 열기

관련 구현: `8c59b53` (`HWP 지원 불가 문서 오류 분류 추가`)

### 검증 환경

- macOS arm64
- Electron 28.3.3
- `@rhwp/core` 0.7.19, `kordoc` 4.2.7
- production `.app`: unsigned local package

### 실행과 결과

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 15 suites, 58 passed, 1 skipped |
| probe 테스트 | `npm run test:probe` | 8 passed |
| production build | `npm run build` | main/preload/renderer build 성공 |
| macOS package | `npm run package:mac` | arm64 `.app` 생성 성공 |
| HWP 정상·오류 matrix | `npm run verify:hwp-matrix` | 정상 fixture와 오류 5종 통과 |
| HWPX 공개 matrix | `npm run verify:matrix` | 5종 fixture 통과 |
| 배포 고지 | `npm run verify:notices` | Apache-2.0, rhwp MIT, notice 원문 일치 |
| private HWP 앱 | `npm run verify:app -- <private.hwp>` | 7쪽, mount 7, overflow 0 |
| private HWP PDF | `npm run verify:pdf -- <private.hwp>` | 7쪽, 혼합 용지, 문자 99.08% |

공개 HWP matrix는 `FileHeader`를 테스트 중에 변형해 다음 오류 코드가 production 앱에 그대로
표시되는지 확인했다.

- `HWP_ENCRYPTED`
- `HWP_DISTRIBUTION`
- `HWP_DRM`
- `HWP_UNSUPPORTED_VERSION`
- `HWP_CORRUPTED`

기존 HWPX 회귀 결과는 baseline 3쪽, cell continuation 2쪽, 이미지 12개·`rowSpan` fixture
1쪽, 80-section 대형 fixture 9,767쪽 중 DOM 12개 mount, 손상 package의 사용자 오류다.

### 검증 중 발견한 문제

오류 fixture를 연속 실행할 때 Electron이 종료 직후 `Session Storage`를 늦게 닫아 임시
디렉터리 삭제가 `ENOTEMPTY`로 실패할 수 있었다. 앱 판정과 정리 실패를 분리하기 위해 E2E
임시 디렉터리 삭제에 100ms 간격, 최대 5회의 제한된 재시도를 추가했다. 같은 전체 matrix
재실행으로 통과를 확인했다.

## 2026-07-27 — 개인정보 없는 HWP 회귀 관문과 PDF race

관련 구현:

- `191fed8` — 공개 HWP 회귀 매트릭스 추가
- `24f0df9` — HWP PDF 마지막 페이지 출력 대기 보강
- `72e5153` — V2 공개 HWP 검증 현황 문서화

공개 `synthetic-layout.hwp`는 HWP 5.0.3.2, 12,800 byte이며 SHA-256
`b665933da10ec276e8e21ddb1c9e6d2eec5440c9ac5d1bda9e5bc478bd136b9e`로 고정했다.

| 관찰 대상 | 결과 |
| --- | --- |
| 생성 결정성 | 재생성 결과와 고정 SHA-256 일치 |
| kordoc 구조 oracle | section 1, 표 1, 셀 9, 이미지/resource 1/1 |
| rhwp 렌더 | 2쪽, SVG 이미지 1, 위험 요소·속성 0 |
| production 앱 | 2쪽, 반복 머리말 2회, overflow 0 |
| production PDF | 2쪽 A4, 텍스트 보존율 98.6% |

저장소 밖 실사용 HWP 재검증에서 첫 PDF의 마지막 쪽 텍스트가 비어 전체 보존율이 낮아지는
race를 발견했다. 인쇄 준비를 렌더 요청 완료가 아니라 모든
fixed-page SVG의 실제 decode 완료(`naturalWidth > 0`)까지 기다리도록 변경했다. 수정 후
마지막 쪽과 문서 전체 텍스트가 다시 보존됐다.

## 2026-07-23 — V1 HWPX Release Candidate

상세 근거는 [V1 기준선](v1_baseline.md)과 [Release Candidate 체크리스트](release_checklist.md)에
있다.

- 저장소 밖 실사용 HWPX: 페이지·이미지 보존, overflow 0
- 화면과 PDF 페이지별 비공백 문자 수 일치
- 15문단 표 cell continuation: 반복 header, 8+7 문단 분배
- 80-section synthetic: 9,767쪽 중 DOM 12개 mount
- 이미지 12개·`rowSpan=2` 공개 fixture와 손상 HWPX 오류 UX
- production Finder 열기, single-instance, drag-and-drop, pinch zoom, dark chrome와 PDF

## 포트폴리오에 사용할 수 있는 근거

- “빠르다”는 표현은 cold/warm 20회 p50/p95와 최대값으로 설명한다.
- “대형 문서를 지원한다”는 표현은 9,767쪽 중 DOM 12개 mount 결과로 설명한다.
- “PDF가 안정적이다”는 표현은 화면/PDF page size와 페이지별 문자 보존율, 실제로 발견해
  수정한 마지막 페이지 race로 설명한다.
- “안전하게 연다”는 표현은 main preflight, Worker timeout·취소, SVG 정제와 다섯
  `FileHeader` 오류 코드로 설명한다.
- “테스트가 있다”는 표현보다 private 실문서와 공개 결정적 fixture를 함께 사용하고 개인정보를
  결과에서 제거한 검증 설계를 설명한다.
