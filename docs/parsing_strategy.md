# V1 HWPX 파싱 전략: Pipeline & Schema

이 문서는 현재 동작하는 HWPX 경로만 설명한다. V2의 HWP 5.0 binary는 이 decoder에 섞지 않고
별도 `DocumentImporter` adapter로 연결한다. 후보와 공식 규격 출처는
[V2 HWP 5.0 조사와 도입 전략](hwp_v2_strategy.md)을 참고한다.

HWPX는 ZIP 아카이브 안에 OWPML XML과 이미지 resource가 들어 있는 형식이다. Han-Flow는
원본 XML의 혼합 자식 순서를 보존하는 ordered AST를 거쳐 읽기 전용 `ViewerDocument`로
변환한다.

## 1. 현재 파싱 파이프라인

```text
ZIP index와 mimetype 검증
  → header.xml 및 section XML ordered parse
  → 글꼴·글자·문단·border/fill style map
  → 문단·표·이미지·header/footer·section page setting decode
  → immutable ViewerDocument
  → section metadata를 보존한 block pagination
```

section 파일은 파일명 숫자 순서로 정렬한다. XML을 일반 객체로 바로 바꾸지 않고 ordered
node 배열로 읽어 `text → image → text` 같은 run 내부 순서를 유지한다. source 위치 기반 ID로
동일 입력의 paragraph/table/cell ID가 항상 같도록 한다.

## 2. 스타일 정보 맵핑 (JSON 스키마 예시)

HWPX의 스타일(단락, 표, 글꼴)을 렌더링 엔진이 이해하기 쉬운 형태로 맵핑합니다.

### 2.1 Paragraph Style (단락 스타일)
```json
{
  "id": "p-style-1",
  "name": "바탕글",
  "align": "justify",
  "lineHeight": "160%",
  "margin": {
    "top": 0,
    "bottom": 0,
    "left": 0,
    "right": 0
  },
  "indent": 0
}
```

### 2.2 Char Shape (글자 모양)
```json
{
  "id": "c-shape-1",
  "fontFamily": {
    "hangul": "함초롬바탕",
    "latin": "Times New Roman"
  },
  "fontSize": 10,
  "bold": true,
  "italic": false,
  "color": "#000000"
}
```

## 3. 구역과 페이지 장식

각 `ViewerSection`은 본문 block과 함께 `pageNum`, `startNum`, header/footer control을 가진다.
header/footer의 `subList`는 일반 문단 디코더를 재사용한다. pagination은 section index를 페이지에
남겨 새 구역의 번호 재시작과 장식 교체를 결정하며, 정의가 없으면 이전 구역 상태를 상속한다.
`startNum page="0"`은 연속 번호, 양수는 해당 값에서 재시작으로 처리한다.

문단 목록 표식은 `hh:bullets`, `hh:numberings/hh:paraHead`를 먼저 ID map으로 만들고
`hh:paraPr/hh:heading`의 type, idRef, level과 결합한다. bullet 문자는 그대로 사용하고 DIGIT
number pattern의 해당 level token(`^1` 등)을 목록 순번으로 치환한다. marker는 본문과
header/footer 및 표 cell 문단에 같은 방식으로 적용한다.

## 4. 대형 문서

section 20개 이상 또는 압축 전 2MiB 이상 section이 있으면 worker thread에서 디코딩한다.
첫 section을 먼저 표시한 뒤 전체 모델로 교체하고, load ID로 취소되거나 늦게 도착한 작업을
격리한다. 50페이지 초과 문서는 viewport 주변 페이지만 mount한다. resource reference 단위
선별 로딩과 section 단위 누적 모델은 이후 최적화 후보이며 정확도를 희생하는 lazy decode는
도입하지 않는다.


## References

- [1] 한글과컴퓨터. (n.d.). *HWP/OWPML 형식*. Retrieved from [https://developer.hancom.com/hwpx-owpml-model](https://developer.hancom.com/hwpx-owpml-model)
- [2] 한컴테크. (2025, 2월 26일). *한/글 문서 파일 형식 : HWPX 포맷 구조 살펴보기*. Retrieved from [https://tech.hancom.com/hwpxformat/](https://tech.hancom.com/hwpxformat/)
