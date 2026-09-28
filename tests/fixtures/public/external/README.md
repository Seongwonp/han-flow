# 외부 실제 HWPX fixture

이 폴더는 한/글·한컴독스 등 실제 한컴 제품이 저장한 공개 HWPX를 보관한다. 프로젝트 generator가
만든 synthetic fixture와 달리 `hwpx_corpus_manifest.json`에 `"source": "file"` 항목으로 기록하고
`fixture_catalog.json`에는 `"provenance": "external"`로 연결한다.

## 받을 수 있는 파일

- 라이선스: `KOGL-1`(공공누리 1유형), `CC-BY-4.0`, `Apache-2.0`, `MIT`, `project-authored`,
  `other` 중 하나. 공공누리는 **1유형만** 받는다. 2–4유형(상업 금지·변경 금지)은 넣지 않는다.
  `other`는 재배포 조건을 PR 설명에 적은 경우에만 사용한다.
- 개인정보 금지: 실명·연락처·주민등록번호·주소·서명·사진·결재란 실명이 있으면 넣지 않는다.
  빈 양식이나 이미 공개된 보도자료처럼 개인 식별 정보가 없는 파일만 받는다.
  manifest의 `personalData`는 반드시 `false`여야 하며 다른 값은 검증에서 거부된다.
- 원본 byte 그대로 보관한다. 한/글로 다시 저장하거나 내용을 고치지 않는다.

## SHA-256 확인

manifest의 `sha256`은 파일 byte 전체의 소문자 hex다. `verify:corpus`는 decode 전에 이 값을
확인하고, 다르면 해당 fixture를 실패로 보고한다.

```powershell
# Windows
certutil -hashfile 파일.hwpx SHA256
```

```sh
# Linux (macOS는 shasum -a 256)
sha256sum 파일.hwpx
```

`certutil`은 대문자·공백이 섞여 출력될 수 있으므로 manifest에는 소문자 64자리로 적는다.

## 한 번에 들여오기

```sh
npm run corpus:intake -- ~/Downloads/양식.hwpx --id gov-form-01 --category official-form \
  --url https://www.example.go.kr/board/1234 --publisher 행정안전부 --license KOGL-1 \
  --producer "Hancom Office 2024 Windows" --no-personal-data
```

helper는 파일을 `external/<id>.hwpx`로 복사하고 SHA-256을 계산한 뒤, 현재 decoder로 한 번 열어
section·table·cell·resource·목록·다단·`estimatedPages` 기대값을 채워 manifest와 catalog에
항목을 추가한다. `--retrieved-at YYYY-MM-DD`를 생략하면 오늘 날짜를 쓴다. `--producer`는 문서
속성이나 배포처로 확인한 저장 제품(`Hancom Office 2024 Windows`, `Hancom Docs web`, 모르면
`unknown`)을 적는다. decoder가 열지 못한 파일은 `rejected`로 기록되므로 원인을 조사해 최소
generator로 축소한다.

`verify:corpus` report에는 fixture별 `source`·license·producer만 들어가고 출처 URL과 본문은
들어가지 않는다. 추가 후 `npm run test:probe`와 `npm run verify:corpus`를 실행해 commit한다.
