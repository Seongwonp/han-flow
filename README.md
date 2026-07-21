# Han-Flow

macOS에서 HWPX 문서를 빠르게 열어 읽고 PDF로 내보내는 읽기 전용 뷰어입니다. 상용 편집기를
복제하기보다 실제로 매주 쓸 수 있는 작고 안정적인 도구를 목표로 합니다.

## v1 목표

- Finder에서 HWPX 파일을 열어 1초 안에 첫 화면 표시
- 문단·글자 스타일, 표, 이미지, 머리말·꼬리말과 쪽 번호를 읽기 좋게 렌더링
- 화면과 같은 페이지 구조로 PDF 내보내기
- 대형 문서의 worker 기반 점진 파싱과 페이지 가상화

편집 기능은 v3 이후 범위입니다. `.hwp` 5.0 바이너리 직접 파싱은 하지 않으며 v2에서 기존
파서 활용을 검토합니다. 한컴오피스와 픽셀 단위로 같은 결과도 목표로 하지 않습니다.

## 현재 상태

OWPML의 XML 자식 순서를 보존해 읽기 전용 문서 모델로 변환하고, HWPUNIT 기반 페이지에
문단·표·병합 셀·테두리·배경·이미지·목록·구역별 머리말/꼬리말/쪽 번호를 렌더링합니다.
현재 글꼴로 실제 block·표 행 높이를 재는 2-pass pagination과 macOS `open-file`,
single-instance 전달, 드래그앤드롭, 트랙패드 핀치 줌, PDF 출력도 연결되어 있습니다.

실사용 AIDA 기준 문서는 production 패키지에서 8페이지, 이미지 4개, 페이지 overflow 0으로
검증했습니다. 첫 실행은 약 0.6초, 실행 중인 앱으로 다시 열기는 약 0.1초였습니다. 원문에서
보이는 텍스트는 기준 PDF 6,077자 중 6,076자가 일치하며 남은 한 글자는 화면에 보이지 않는
채움 문자입니다.

현재 가장 큰 차이는 원문 글꼴이 없는 Mac에서 대체 글꼴의 폭이 달라져 2·3페이지의 줄바꿈과
콘텐츠 분배가 달라지는 점입니다. 함초롬체는 제3자 앱 재배포 권한이 확인되지 않아 번들하지
않고, 시스템 설치본의 한글·영문 family 이름을 찾아 사용합니다. OFL Noto Serif KR 번들도
실험했지만 페이지 분배가 개선되지 않아 채택하지 않았습니다. 자세한 결정은
[글꼴 전략](docs/font_strategy.md)을 참고하세요.

## 개발

Node.js와 npm이 필요합니다.

```bash
npm install
npm run dev
```

검증과 macOS용 비서명 앱 패키징:

```bash
npm test -- --runInBand
npm run build
npm run package:mac
npm run benchmark:app -- /path/to/document.hwpx
```

패키지는 `release/mac-arm64/Han-Flow.app`에 생성됩니다. 현재 로컬 검증용으로 서명·공증되지
않았으며, 전용 아이콘은 적용되어 있습니다. 배포 전 Developer ID 서명과 notarization이
필요합니다.

`benchmark:app`은 패키지 앱을 사용해 같은 프로세스의 warm open 20회와 새 프로세스의 cold
open 20회를 측정하고 `열기 → 첫 paint` p50/p95를 출력합니다. 입력 문서의 본문은 출력하지
않으며 먼저 `npm run package:mac`을 실행해야 합니다.

macOS 문서 연결은 Han-Flow의 `com.hanflow.hwpx`와 기존 한컴 제품이 등록하는
`com.haansoft.hancomofficeviewer.mac.hwpx`를 모두 Viewer 대상으로 선언합니다. 앱은 사용자의
기본 앱 설정을 자동으로 변경하지 않습니다.

## 구조

```text
src/
├── main/          # macOS 파일 열기, worker, IPC, PDF 출력
├── core/
│   ├── parser/    # HWPX package와 ordered XML 해석
│   ├── document/  # 읽기 전용 ViewerDocument
│   ├── fonts/     # 시스템 글꼴 해석과 대체 진단
│   └── layout/    # 페이지·표 분할과 단위 변환
└── renderer/      # React 페이지 렌더러와 뷰어 UI
tests/             # 공개 synthetic fixture 기반 회귀 테스트
docs/              # 아키텍처, 파싱 전략, 기준선과 실험 기록
```

실사용 fixture와 캡처에는 개인정보가 포함될 수 있어 저장소에 넣지 않습니다. 공개 테스트는
실행 시 결정적으로 생성되는 synthetic HWPX를 사용합니다.

## 문서

- [기술 아키텍처](docs/architecture.md)
- [파싱 전략](docs/parsing_strategy.md)
- [v1 기준선과 구현 현황](docs/v1_baseline.md)
- [글꼴 전략과 라이선스 판단](docs/font_strategy.md)
