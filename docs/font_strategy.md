# Han-Flow v1 글꼴 전략

## 결정

Han-Flow는 함초롬바탕·함초롬돋움 글꼴 파일을 앱에 번들하지 않는다. 한컴의 공식 안내는
함초롬체의 권리자가 한글과컴퓨터이며, 한컴오피스 밖에서 사용할 때는 권리 관계를 확인해야
한다고 명시한다. 다운로드 페이지가 존재하는 사실만으로 제3자 앱의 글꼴 파일 재배포나
앱 내장 권한이 부여됐다고 해석하지 않는다.

- [한컴 글꼴 저작권 안내](https://www.hancom.com/news/notice/detail/6117)
- [한컴오피스 2024 사용권](https://help.hancom.com/hoffice130/ko-KR/HCell/right/rights.htm)
- [함초롬체 다운로드 FAQ](https://www.hancom.com/support/faqCenter/faq/detail/2170)

명시적인 앱 내장·재배포 허가를 서면으로 받거나, 이를 허용하는 라이선스 원문이 확인되면
번들 결정을 다시 검토한다. 그 전에는 글꼴 파일을 저장소, 테스트 fixture, 패키지 앱에
복사하지 않는다.

## 해석 순서

1. 문서가 요구한 family 이름과 시스템 글꼴 이름의 정확한 일치
2. 함초롬바탕 ↔ `HCR Batang`/`HANBatang`, 함초롬돋움 ↔ `HCR Dotum`/`HANDotum` 별칭
3. 바탕·명조 계열은 `AppleMyungjo`, 돋움·고딕 계열은 `Apple SD Gothic Neo`
4. 설치된 Nanum 또는 Noto 계열 글꼴

별칭은 같은 글꼴의 이름 차이이므로 대체로 집계하지 않는다. 실제 다른 family를 사용한
경우에는 상태 표시줄에 대체 수를 표시하고 상세 진단에 `요청 → 적용` 이름을 남긴다. 화면과
PDF는 같은 해석 결과를 사용한다.

## 번들 실험 결과 (2026-07-21)

개발 Mac의 시스템·사용자 글꼴 목록에는 함초롬체 또는 HCR/HAN family가 없었다. 공식 문서에서
제3자 앱 재배포 허가를 확인할 수 없어 글꼴 파일을 내려받아 `.app`에 넣는 실험은 진행하지
않았다. 대신 시스템에 설치된 함초롬체를 영문 family 이름으로도 찾는 경로를 단위 테스트로
고정했다.

현재 private AIDA 기준 문서는 macOS 대체 글꼴로 8페이지와 overflow 0을 유지하지만 2·3페이지의
줄바꿈과 콘텐츠 분배에는 차이가 있다.

### Noto Serif KR fallback 실험

OFL-1.1인 Noto Serif KR 5.3.0의 한국어 WOFF2 Regular/Bold만 번들해 바탕·명조 계열 5종에
적용했다. Vite 출력 자산은 약 2MB였고 Fontsource를 build dependency로 제한해 npm 패키지
전체가 `.app`에 포함되지 않도록 했다. OFL 전문도 앱 resource에 포함해 조건을 충족했다.

production AIDA 결과는 8페이지, overflow 0, 첫 화면 623ms로 성능 기준을 유지했다. PDF의
공백 제거 텍스트는 기준 6,068자 대비 6,075자로 선택·검색 가능한 텍스트도 유지됐다. 그러나
기준 PDF 대비 페이지별 텍스트 유사도가 핵심 2·3페이지에서 기존 0.598/0.318보다 낮은
0.555/0.210이었고, 본문 block이 3페이지로 넘어가는 문제도 그대로였다.

따라서 Noto Serif KR 번들은 채택하지 않고 코드와 의존성을 제거했다. 이 결과는 특정 글꼴을
더 시도하는 것보다 원본 `lineseg`와 실제 block 높이를 함께 사용하는 pagination 보정이 먼저라는
근거로 삼는다.
