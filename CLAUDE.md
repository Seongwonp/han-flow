# Han-Flow 작업 지침

먼저 [docs/handoff.md](docs/handoff.md)를 읽는다. 남은 일은 [docs/next_steps.md](docs/next_steps.md).

## 규칙 요약

- main에서 직접 작업한다(branch·PR 만들지 않음). 끝나면 commit → push → CI 확인.
- commit 작성자는 `Seongwon Park <swp4081@gmail.com>`. AI 도구 이름·co-author 줄을 넣지 않는다.
- commit 메시지·문서·사용자 문구는 한국어. commit마다 CHANGELOG.md에 한 줄.
- 사용자 실제 문서 본문을 로그·보고서·commit에 옮기지 않는다.
- test를 skip해서 통과시키지 않는다. 편집 golden은 의도한 변경일 때만 갱신한다.
- 사용자에게는 결과만 짧게 보고한다.

## 검증 순서

`npm run typecheck` → `npm test` → `npm run test:probe` → `npm run package:linux`
→ `HAN_FLOW_NO_SANDBOX=1 xvfb-run -a npm run verify:matrix`(Linux) → 필요하면 사용자 문서에
`scripts/verify_app.mjs`·`scripts/verify_pdf.mjs` → 문서·CHANGELOG 갱신 → commit·push → CI.
