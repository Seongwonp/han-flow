# 변경 기록

## Unreleased

### HWPX 수식 조판(MathML)

- 한컴 수식 script(`hp:equation/hp:script`)를 해석해 MathML로 그림: `over`·`atop`·`choose`, `sqrt`·`root … of`, `^`·`_`·`sup`·`sub`, `left … right`, `matrix`·`pmatrix`·`bmatrix`·`dmatrix`, `cases`, `pile`·`lpile`·`rpile`, `eqalign`, `sum`·`prod`·`int`·`lim`의 `from`·`to`, 그리스 문자·기호·화살표, `rm`·`it`·`bold`, `~`·`` ` ``, 따옴표 글, `COLOR`. 기호 표·토큰 규칙은 rhwp(MIT) 참고(THIRD_PARTY_NOTICES.md)
- 선언 상자(`hp:sz`)에 맞춰 배율을 정하고 `baseUnit`·`textColor`·`baseLine`을 씀. 근호·늘인 괄호는 글꼴 MATH 표 없이 글자를 CSS transform으로 늘여 화면과 PDF 추출 글자가 같음(pdftotext로 수식 기호 확인)
- 해석하지 못한 수식(`ladder`·`longdiv` 등, 짝 안 맞는 괄호)만 전처럼 script 글자 상자로 남고, 그려 낸 수식은 "화면에 완전히 표시되지 않는 개체" 배너·PDF 확인·진단 개수에서 빠짐(원문 개체 census에는 그대로 셈)
- 해석 단위 test·renderer test, 수식 합성 fixture(`createEquationHwpx`)와 verify:matrix 검사(그린 수식 수·배너·PDF 기호), `ext-hwpxlib-equation`은 배너 없음·corpus manifest 진단 0개로 기대값 변경

### 편집 범위: 글상자·메모 글자, subList 모양·문단 나눔, 각주 만들기·지우기

- 글자만 든 글상자(도형 글 `hp:drawText`)와 메모 본문(`hp:fieldBegin type="MEMO"`)의 글자 입력·삭제·치환. decoder가 글자만 든 subList에 section `hp:t` 순번 anchor를 붙이고(표·그림·도형·수식·각주·필드가 하나라도 든 글상자·메모는 전체 읽기 전용) capability가 `TEXT_BOX_TEXT`·`MEMO_TEXT`로 연다. 원본 위치 글상자는 편집 중 그 자리에서 입력 칸이 되고(글 앞·뒤 글상자도 편집 중에는 누를 수 있음), 메모는 줄 안 "메모: …" 자리에 입력 칸을 둔다
- 각주·미주·머리말·꼬리말·글상자 문단의 글자·문단 모양과 Enter 분할·경계 병합(`SUBLIST_TEXT` 차단은 메모 본문에만 남음). 한/글 저장본처럼 번호(`hp:autoNum`)와 글자가 한 run에 든 각주 첫 문단의 글자 모양은 번호를 원래 모양 run에 남기고 글자만 새 run으로 나눔(실행 취소는 원래 run bytes 복원). 문단 구조 규칙은 본문과 같아 번호가 든 각주 첫 문단은 Enter·병합을 막음
- 리본 `편집` 탭 `각주` group: [각주 넣기]는 본문 문단 글자 사이 caret에 한/글 모양 각주(번호 control + 빈 본문)를 넣고 새 각주로 caret을 옮김. 번호는 앞 각주 + 1, 뒤 각주 `number`·`autoNum num`을 올림(이어 매기기면 뒤 구역까지). [각주 지우기]와 번호 표시를 품은 본문 범위 삭제는 각주를 통째로 지우고 뒤 번호를 내림. 실행 취소는 본문 문단 원문과 번호 attribute를 되돌려 원래 bytes를 복원하고, `instId`까지 package 상태로 정해 다시 실행·복구 replay가 같은 bytes를 만듦. 쪽마다 새로 매기기(`ON_PAGE`) 구역·표 셀·글상자·머리말 안 각주 넣기와 미주는 지원하지 않음
- 저장 정책에 `note-structure`(`NOTE_STRUCTURE_CHANGED`, 재열기 권장)를 더함. 복구 기록 형식 version 4: `insert-footnote`·`delete-footnote`는 version 4 기록에서만 받고(replay 검사는 실제 `#hp:t:N` anchor·offset, `#hp:footNote:K` 모양), version 1~3 기록은 그대로 읽음
- golden family 3개(`object-text`·`sublist-structure`·`footnote`)와 단위 test(`object_text`·`footnote_patch`·subList 복구 기록 replay), renderer test를 추가하고 기존 style·paragraph golden은 위치 거부였던 subList 표본만 바뀜. verify:matrix에 subList 편집 합성 fixture(`createSublistEditHwpx`)의 글상자·메모 입력, 각주·글상자 글자·문단 모양 probe, 각주 넣기→입력→실행 취소·다시 실행→지우기→실행 취소를 각각 Save As→재열기까지 확인하는 검사를 추가
- 편집 coverage 측정이 쪽 아래 각주 본문(번호 표시 자리 표시 안)을 anchor 없음으로 세던 문제를 고침. 외부 한/글 28종: anchor 96.3% → 99.2%, text 편집 96.0% → 98.9%, 글자 가중 94.3% → 98.9%, 글자 모양 77.7% → 81.2%, 문단 모양 95.0% → 98.7%, 문단 나눔 270 → 281/399(불일치 0), 글자 칸 없는 문단 45/46 → 46/46

### 표 셀 선언 높이·글 옆 배치·칸 안 원본 위치 개체

- HWPX 표 셀을 한/글처럼 선언 높이(`hp:cellSz height`, 안쪽 여백 포함)를 최소 높이로 그림. 예전 `td`의 `min-height`는 표 칸에 듣지 않아 내용 높이로 그려졌음. `td` `height` + `border-box`(행 최소 높이)로 바꾸고 내용이 길면 늘어남. 한 쪽 본문보다 높은 선언 높이는 쪽 본문 높이로 줄이고 쪽을 넘어 나뉜 조각 셀은 내용 높이(`cellMinimumHeight`). 사용자 문서 doc2 1쪽의 용지 기준 빨간 타원이 표 아래 빈 곳이 아니라 표 안 작성자 줄을 감쌈(PDF 그림 비교)
- 글 옆 배치(`SQUARE`·`TIGHT`·`THROUGH`)의 흐를 쪽을 `textFlow`(`LEFT_ONLY`·`RIGHT_ONLY`·`LARGEST_ONLY`, `BOTH_SIDES`는 넓은 쪽 근사)와 개체 옆 빈 폭(약 1cm 미만이면 흘리지 않음)으로 정함(`wrapTextSide`)
- 다단이 없는 구역의 쪽 기준 개체 띠: 쪽 위 block을 띠 사이로 흘려(`flowBlockEnd`) 글이 닿을 때만 띠를 비우고, 글 옆 배치는 개체 쪽만 비우는 좁은 float로 남은 폭에 글을 흘림. 쪽 나눔은 띠 옆 줄 수를 남은 폭 비율 × 0.85로 어림하고 표·그림 문단은 띠 아래로 봄. 다단 구역은 예전처럼 띠 폭 전체
- 표 셀·글상자 안 개체는 그 칸을 용지로 본 원본 위치(`containerObjectFrame`, 칸 기준 절대 위치와 칸 글 흐름의 띠), 머리말·꼬리말 안 개체는 쪽 기준 원본 위치에 그림(`data-object-container`). 각주 안 개체는 줄 흐름 그대로. decoder는 모든 문단에서 흐름 밖 개체를 문단 높이에서 뺌
- verify_app `positionedObjects`에 `container`·`textBeside`(글 옆 개체 옆으로 흐른 글 줄)를 더하고 머리말·꼬리말 개체는 겹침 검사에서 글 앞·뒤처럼 봄. verify:matrix에 합성 fixture(`createObjectLayoutHwpx`: 쪽 위 표 셀 선언 높이, 셀·글상자·머리말 안 그림, 쪽 기준 글 옆 그림)의 개체 상자를 기대값과 1.5px 안에서 비교하고 글 옆 흐름·화면/PDF·문단 편집→Save As→재열기를 확인하는 검사를 추가. 단위 test(`object_position`·`object_pagination`·`object_container_view`)
- 사용자 문서 5종 verify_app·verify_pdf·편집 저장 통과, 쪽 수(2·3·1·1·2)와 화면 글자 수 변경 없음. doc2·doc3·doc5-d04는 표 행이 선언 높이로 늘어 PDF 그림이 바뀜(doc3 아래 결재 표, doc5-d04 1쪽 본문이 쪽 아래 끝까지 차 쪽 번호와 맞닿음). large-progressive 한 글자 입력 input→DOM p50/p95(같은 컨테이너, 번갈아 두 번) 변경 전 59.5/75.2·78.8/135.9ms, 변경 뒤 57.5/86.7·60.7/98.7ms(측정 잡음 범위, 회귀 없음)

### 글자·문단 모양 편집 증분 측정

- 글자·문단·셀 모양 command가 header.xml을 바꿔도 style map 전체 대신 id별로 바뀐 definition만 patch에 담고(`styleChanges`, 지운 id는 null), 바뀐 id를 쓰는 section 위치를 알림(`restyledSections`). 참조 id는 해석 결과의 본문·표 셀·머리말·꼬리말·각주·미주 문단 글자·문단 모양과 셀 테두리 id로 정하고(`sectionStyleIds`), definition 내용은 section 해석에 쓰이지 않으므로 그 section은 다시 해석하지 않음. 기존 id의 definition이 바뀌면 그 id를 쓰는 section 모두, 글꼴 목록이 바뀌면 예전처럼 style map 전체(모든 section 다시 잼)
- renderer는 바뀐 id만 새 style object로 합치고 영향 section만 얕은 복사로 새 object로 만들며, 측정값을 style object 대신 측정값 표지(`MeasurementStylesTracker`)로 묶어 patch가 알린 id만 바뀌면 나머지 section 측정값·쪽 나눔·측정 DOM을 다시 씀. 찾은 글꼴을 넣은 글자 모양도 id별 object를 다시 씀
- `benchmark:edit-latency`에 글자 모양 mode(`HAN_FLOW_EDIT_LATENCY_MODE=bold`: [굵게]·[실행 취소]를 번갈아 20번, 측정 DOM 다시 재기·쪽 나눔 완료 표시 `han-flow:layout-measured`와 다시 잰 section 수)를 추가. large-progressive 15,003쪽에서 누른 때부터 다시 재고 쪽을 나눈 때까지 p50/p95 401.8/464.5·361.0/437.4ms → 40.7/56.8·37.1/45.3ms, DOM 반영 p50 219.1·209.5ms → 40.9·37.2ms, 다시 잰 section 80 → 1(같은 컨테이너 두 번씩). 한 글자 입력 input→DOM p50/p95 41.5/68.2ms → 37.1/65.0ms(회귀 없음)
- 증분 projection 동치 검사가 `styleChanges` 밖 id의 style object 공유와 바뀐 id를 쓰는 section이 모두 patch·`restyledSections`에 있는지 확인하고, section별 style 변경(새 글자 모양·실행 취소·기존 글자/문단 모양·셀 테두리·글꼴 목록) test와 renderer 측정 재사용 test(`measurement_styles.test.ts`)를 추가

### HWP 기호 글꼴 사설 영역 글자

- 사용자 HWP 문서 1종의 PDF 검증이 U+F0E8 4자를 사설 영역 손실로 실패하던 원인: rhwp(`@rhwp/core` 0.7.19)는 SVG를 그릴 때 기호 글꼴(Wingdings) PUA 글자를 표준 기호(U+F0E8 → ➔ U+2794)로 바꾸지만 쪽 글자 위치표는 원래 code point라 화면 글자 층(선택·검색·복사)만 U+F0E8이었음. PDF를 다시 그린 PNG에 기호 4개가 그려져 있고 PDF 글자도 ➔로 추출됨을 확인(손실이 아니라 글자 층 불일치)
- rhwp `map_pua_bullet_char`의 기본 PUA(U+F020–U+F0FF) 48개 항목(0.7.19와 상류 `1a76570e`가 같음, MIT, `THIRD_PARTY_NOTICES.md`)을 `SYMBOL_FONT_PUA_DISPLAY`로 옮겨 HWP 쪽 글자 층(`parseRhwpTextLayout`, adapter에서 분리)과 HWPX 화면(`hancomPuaDisplayText`)에 씀. 원문·저장 bytes는 그대로. `verify:pdf` 표시 대체 표도 두 표를 읽고, 허용 목록은 늘리지 않음
- 사용자 문서 5종 verify_app·verify_pdf 통과, 쪽 수는 변경 전과 같음(doc1 2·doc2 3·doc3 1·doc4 1·doc5-d04 2쪽). doc4 화면 글자 575 → 579(➔ 4자가 비교 글자가 됨), PDF 571 그대로. 남은 8자는 rhwp가 가운뎃점을 `<circle>`로 그려 추출되지 않는 기존 차이(보존율 0.986, 기준 0.98)

### 복구 기록 마무리

- 앱 시작·문서 열기 때 남은 복구 기록을 header(첫 record)만 읽어 목록·제안을 만들고, 전체 record의 길이·CRC·구조 확인은 [복구]를 고른 뒤 편집 worker가 함(main은 기록 bytes만 넘김, 제안 때 본 header와 달라도 손상). 63 MiB 합성 기록 하나의 목록 시간 약 0.84초 → 3–4ms(첫 호출 31ms, 같은 컨테이너). 뒷부분 손상은 그때 격리해 격리 동작은 같음. 대화상자는 편집 수 대신 기록 크기를 보이고, 편집 수와 끊긴 꼬리 여부는 복구 뒤 상태 막대에 알림
- 격리한 기록·[나중에] 기록·다른 version 기록에 보관 기한 30일(`RECOVERY_RETENTION_MS`)을 두고 첫 창 load 뒤 비동기로 지움(열린 session·다른 이름은 그대로, 링크는 링크만)
- 기록 header의 원본 경로가 Windows UNC·장치 경로·드라이브 상대 경로·대체 데이터 stream이면 앱 시작 때 `lstat`·hash 전에 건너뜀(문서를 직접 열면 물음). 제안 전에는 크기·수정 시각만 보고 SHA-256은 [복구] 때 비교
- 편집 시작 때 원본을 한 번 읽어 그 bytes로 package를 열고 SHA-256도 계산(예전에는 package와 지문이 파일을 따로 읽음)
- 저장 중 강제 종료로 저장 폴더에 남은 `.<이름>.han-flow-<UUID>.tmp`를 같은 폴더에 다시 저장(HWPX·PDF)할 때 지움(정확한 이름·일반 파일·1시간 이상·POSIX는 같은 사용자 소유만)

### 검증 강화

- `verify:pdf`가 사설 영역 글자를 code point별로 화면·PDF에서 비교해, 한컴 PUA 표시 대체 표(PDF에 대체 문자가 있을 때)나 이유가 있는 허용 목록 밖의 손실을 실패로 봄. U+F028B(③ 자리)는 rhwp 상류 표가 근거 부족으로 빼 두어 넣지 않음
- 쪽보다 높은 그림(`hp:pic`)도 자리 표시와 같은 한도로 가로세로 비율을 지켜 줄이고 원본 위치 그림의 배치 상자도 줄임. 합성 fixture(`createLongPictureHwpx`)가 예전 4쪽·overflow 2쪽에서 2쪽·overflow 0이 되고 verify:matrix `long-pictures`가 확인
- verify_app이 쪽 virtualization 문서의 원문 개체 비교를 건너뛰지 않고 쪽을 끝까지 넘기며 센 자리 표시로 비교(`compared-by-scrolling`), 덜 확인하면 확인한 쪽 수와 함께 실패. large-progressive 15,003쪽을 약 1분에 모두 확인
- 전체 suite에서 가끔 실패하던 `text_patch.test.ts` hard link 미지원 test 수정: jest worker process가 공유하는 `fs/promises.link` spy가 앞 test 파일에서 끝나지 않은 저장의 link 호출까지 세던 문제(재현: 끝나지 않는 저장을 남기는 test 다음에 `--runInBand`로 실행하면 호출 3회). 이 test 폴더 목적지만 흉내 내고 그 목적지 호출만 세도록 바꾸고, 부하에서 timeout으로 끝난 저장이 남지 않게 jest 기본 timeout을 30초로 올림

### HWPX 다단 조판 완성

- `hp:colPr`의 모든 유형·배치를 단별로 조판: 일반 다단(`NEWSPAPER`), 배분 다단(`BALANCED_NEWSPAPER`, 구역 끝 쪽 단 높이 맞춤), 평행 다단(`PARALLEL`, 단 나눔마다 다음 단·마지막 단의 단 나눔은 같은 쪽 아래 새 줄로 가는 근사, `HWPX_PARALLEL_COLUMN_APPROXIMATED` 진단)과 `LEFT`·`RIGHT`(첫 단이 오른쪽)·`MIRROR`(짝수 쪽 오른쪽부터). 예전 단일 흐름 fallback(`HWPX_MULTI_COLUMN_LAYOUT_FALLBACK`)은 없앰
- 서로 다른 단 너비(`sameSz="0"`): `hp:colSz`(예전 `hp:col`만 읽어 너비를 놓치던 결함 수정)를 한/글 비율 값으로 보고 본문 폭에 맞춰 단·간격을 놓고, 측정 DOM이 첫 단과 너비가 다른 단으로 한 번 더 재(`LayoutMeasurements.columnHeights`) pagination이 단마다 그 너비 높이를 씀. 단 사이 구분선(`hp:colLine` 종류·굵기·색)을 간격 한가운데에 그림
- 구역 중간 문단의 새 다단 정의를 같은 쪽 앞 영역 아래 새 다단 영역으로 조판(`ViewerPage.regions`, 닫히는 영역은 문단 경계로 단 높이를 맞춤). 단 나눔은 다음 단(마지막 단이면 다음 쪽)으로 가고, 화면 글이 원본보다 커서 이미 넘친 단은 원본의 다음 단 시작을 받아 거의 빈 단을 만들지 않음(공개 원본 `ext-hwpxlib-multi-column` 3단 비동일 너비가 한/글처럼 2쪽)
- 각주는 놓인 단(영역이 여럿이면 마지막 영역의 단) 아래, 단 기준 가로 위치 개체(`horzRelTo="COLUMN"`)·문단 기준 개체는 block이 놓인 영역·단 범위를 씀. 단 순서와 무관하게 DOM은 흐름 순서라 caret 이동·선택·PDF 글 순서가 같음
- verify_app이 다단 영역별 단 위치·글자·구분선(`columnLayouts`)을 내고, verify:matrix에 합성 fixture(`createColumnLayoutHwpx`: 비동일 너비·구분선·구역 중간 변경·`RIGHT` 단 기준 그림·각주·`MIRROR`·배분·평행)의 글자 단 위치·단 왼쪽 끝·폭·구분선을 기대값과 1.5px 안에서 비교하고 화면/PDF 글자 수, 둘째 단 문단 편집→Save As→재열기 뒤 같은 배치를 확인하는 검사를 추가. 공개 corpus manifest의 `ext-hwpxlib-multi-column` 기대값을 진단 0·추정 1쪽으로 고침
- 사용자 문서 5종(모두 1단)의 화면·PDF 쪽·글자 수는 변경 전과 같음. large-progressive 한 글자 입력 지연 input→DOM p50/p95 39.0/58.2ms → 35.6/47.0ms(같은 컨테이너, 회귀 없음)

### HWPX 원본 위치 개체

- 본문 문단의 글자처럼 취급하지 않는 개체(`hp:pos treatAsChar="0"`: 그림·표·글상자·사각형·타원·선·다각형·그 밖의 자리 표시)를 문단 흐름 대신 원본 위치에 그림. decoder가 `hp:pos`(기준 용지·쪽·단·문단, 맞춤 위·가운데·아래·안쪽·바깥쪽/왼쪽·가운데·오른쪽, offset, 본문 안 제한)·`hp:sz`·`hp:outMargin`·`textWrap`·`textFlow`와 도형 선·면 색·꼭짓점을 읽고(32비트 음수 offset 복원, 쪽 배치 크기는 `hp:sz`), 순수 위치 함수(`object_position.ts`)를 화면·pagination·PDF가 함께 씀
- 글 뒤·글 앞 개체는 글 흐름에 영향 없이 본문 글 아래·위에 그림(쪽이 stacking context). 용지·쪽 기준 자리 차지 개체는 개체를 둔 문단이 놓인 쪽 본문에서 개체 세로 띠(바깥 여백 포함)를 비워 pagination이 그만큼 본문을 줄이고(`ViewerPage.bands`, 다단이면 모든 단), 화면은 같은 띠를 본문 앞 빈 블록·float로 비움. 문단 기준 자리 차지 개체는 문단 앞 흐름 안 블록, 문단 기준 글 옆 배치(`SQUARE`·`TIGHT`·`THROUGH`)는 문단 안 float로 그 문단 글이 줄 단위로 개체 옆을 흐름(양쪽 흐름·윤곽 감싸기 없음, 용지·쪽 기준 글 옆 배치는 띠로 근사). 쪽 기준 표는 쪽 위 위치에서도 셀 글자 편집이 그대로이고 쪽 사이에서 나누지 않음
- 글상자는 원본 선·면 색·안쪽 여백·세로 맞춤 상자에 글을 읽기 전용으로, 사각형·타원·선·다각형은 SVG로 원본 선·면 색을 그림. 표 셀·글상자·머리말·꼬리말·각주 안 개체는 예전처럼 줄 흐름 안에 둠
- Han-Flow 쪽 본문은 위쪽 여백에서 시작하므로(한/글은 머리말 여백 아래) 용지 기준 세로 위치를 한/글 본문 영역 안에서 머리말 여백만큼 옮겨 본문 글과의 관계를 맞춤
- 사용자 문서 doc5-d04가 편집 모드에서 빈 문단에 글자를 넣으면(그 저장본도) 2쪽 → 3쪽이 되던 문제 수정: 쪽 끝 문단 기준 글상자를 현재 크기(`hp:curSz`, 글에 맞춘 높이)와 이름표 줄로 문단 흐름에 넣어 1쪽이 거의 꽉 차 있었고, 빈 문단(보기 화면에서 1em)이 글자 줄 높이가 되자 글상자 문단이 다음 쪽으로 밀렸음. 한/글처럼 `hp:sz` 높이로 자리를 잡아 편집·저장본 재열기 모두 2쪽
- verify_app이 원본 위치 개체의 쪽·배치·용지 기준 상자(`positionedObjects`)를 내고 자리 차지·글 옆 개체가 비운 자리에 본문 글이 들어오면 실패로 봄(저장본 재열기 포함). verify:matrix에 합성 fixture(`createFloatingObjectHwpx`)의 용지 기준 글상자·쪽 아래 그림·쪽 위 표 상자를 기대값과 1.5px 안에서 비교하고 화면/PDF 글자 수, 문단 편집·쪽 위 표 셀 편집→Save As→재열기 뒤 같은 자리를 확인하는 검사를 추가
- 사용자 문서 5종 화면·PDF 쪽 수는 변경 전과 같음(doc2 3·doc3 1·doc5-d04 2쪽, HWP 2종 그대로). 화면·PDF 글자 수는 서로 같고, 그린 도형·글상자에서 빠진 자리 표시 이름표("도형"·"글상자")만큼 줄었음(doc2 1·3쪽 각 2자, doc5-d04 1쪽 3자). large-progressive 한 글자 입력 지연 input→DOM p50/p95 37.0/53.5·36.2/57.4ms → 34.9/69.0·37.7/64.0ms(같은 컨테이너 두 번씩, p50 같고 p95는 측정 편차 범위)

### HWPX 쪽 아래 각주

- HWPX 각주를 구역 끝 목록 대신 번호 표시가 놓인 쪽(다단이면 그 단) 아래, 꼬리말 위에 배치. 구역 정의의 `hp:footNotePr`(구분선 길이·종류·굵기·색, 본문·구분선·각주 사이 간격, 번호 모양·앞뒤 문자·위 첨자, 본문 바로 아래 두기)를 따르고 본문 높이를 각주 영역만큼 줄임. 문단과 그 각주가 함께 들어가지 않으면 문단을 다음 쪽으로 넘기고, 빈 쪽에도 들어가지 않는 긴 각주는 문단 경계나 화면에서 잰 줄 경계에서 나눠 다음 쪽 아래에 이어 그려 한 쪽보다 긴 각주 문단이 넘치지 않음(화면·PDF 같음). 미주는 계속 구역 끝 목록
- 각주 번호: 원본 번호를 쓰되 구역마다 새로 매기기(`ON_SECTION`)는 시작 번호부터 구역 번호 모양으로, 쪽마다 새로 매기기(`ON_PAGE`)는 Han-Flow 쪽 나눔에 맞춰 다시 매김(본문 번호 표시 포함)
- 쪽 아래 각주 본문도 글자 입력·삭제·치환·실행 취소·저장을 지원. 줄 단위로 나뉜 각주 문단은 앞 쪽 조각만 입력 칸(편집 중 원본 문단 전체를 조각 높이로 잘라 그림)이고 이어지는 줄은 편집 anchor 없는 읽기 전용 글자라 같은 입력 칸이 두 번 나오지 않음
- verify_app이 본문 번호 표시와 각주 첫 조각의 쪽이 다르면 실패로 보고(`footnotePlacement`), verify:matrix에 긴 각주 합성 fixture(`createLongFootnoteHwpx`)의 overflow·화면/PDF 글자 수·이어짐과 나뉜 각주 편집→Save As→재열기, 편집 범위 fixture 각주의 같은 쪽 배치 검사를 추가. 각주 40개 fixture는 3쪽 고정 대신 40개 모두 번호 표시와 같은 쪽 배치를 확인
- 각주가 없는 문서의 pagination·측정 경로는 그대로(사용자 문서 5종 화면·PDF 쪽·글자 수 변경 전과 같음). large-progressive 한 글자 입력 지연 input→DOM p50/p95 45.6/75.2ms → 37.9/50.4ms(같은 컨테이너 측정, 회귀 없음)

### HWPX 편집 범위 확장

- 표만 든 본문 문단(`hp:run > hp:tbl`)에 표 앞·뒤 합성 caret(`#hp:p:N:table-before|after`)을 열어, 첫 입력이 표 run 안 표 바로 앞·뒤에 `hp:t`를 만들고(실행 취소는 원래 bytes 복원) 표 뒤 빈 `<hp:t/>`·표와 같은 문단의 기존 글자도 입력·삭제할 수 있게 함. Enter·경계 병합·글자 모양은 `TABLE_PARAGRAPH` 이유로 막고(문단 모양은 글자를 넣은 뒤 허용), 표 앞·뒤 글자는 서로 다른 범위로 둠. 편집 화면은 빈 caret을 표 왼쪽의 흐름 밖 입력 칸으로 그려 쪽 배치를 바꾸지 않고, 쪽을 넘는 표 조각에는 표 앞 글자를 첫 조각에만·표 뒤 글자를 마지막 조각에만 둠
- 구역 끝 각주·미주 목록의 본문 문단과 머리말·꼬리말의 글자만 든 문단에 편집 anchor·입력 칸을 열어 글자 입력·삭제·치환을 지원(번호 `hp:autoNum`·본문 위치 control·머리말 정의는 byte 그대로, 문단 나눔·병합·글자/문단 모양은 `SUBLIST_TEXT`로 막음). 머리말·꼬리말은 같은 것을 쓰는 모든 쪽에 projection 뒤 함께 반영하고, selection 복원은 마지막으로 focus를 받은 쪽의 입력 칸에만 넘김. 표·그림이 든 머리말 문단과 글상자·메모 안 글은 계속 읽기 전용
- 같은 문단 여러 run 범위 치환이 문서 순서로 사이에 있는 각주 본문·표 셀 `hp:t`를 함께 지우던 잠재 결함을 같은 문단 글자만 고치도록 수정하고, 머리말 문단 안 여러 run 범위를 문단 범위로 오인해 거부하던 판정을 바로잡음
- 복구 기록 형식을 version 3으로 올림(표 앞·뒤 합성 anchor). version 1·2 기록도 읽어 replay하되 그 기록에 표 앞·뒤 anchor가 있으면 격리하고, version 2까지만 아는 앱은 version 3 기록을 손대지 않음. replay 검사가 글자 command의 대상 anchor 형식·범위와 실행 취소 전용 option을 확인
- 편집 golden에 표 앞·뒤 caret(`table-caret.json`)·각주/머리말 글자(`sublist.json`) family를 더하고(기존 4개 family 기록 불변), 편집 범위 합성 fixture(`createEditScopeHwpx`)로 표 앞 글자·각주 본문·머리말 입력→실행 취소·다시 실행→Save As→재열기 E2E를 verify:matrix에 추가. `corpus:editing-coverage`에 표 앞·뒤 caret 지표를 더해 외부 28종 text 편집 89.8%→96.0%, 문단 모양 90.2%→95.0%
- 쪽마다 되풀이되는 머리말·꼬리말 칸 끝에서 방향 키·Shift+방향 키가 다음 쪽의 같은 칸으로 넘어가 caret이 같은 글자 처음으로 튀던 결함을 수정(이동 후보에서 되풀이된 anchor를 지금 쪽 것 하나로 줄이고 칸 밖으로는 멈춤). verify:matrix에 표 뒤 caret·미주 본문·꼬리말 입력→Save As→재열기(꼬리말은 두 쪽 모두)와 머리말·꼬리말 방향 키 검사를 더하고, 심볼릭 링크 권한이 없는 Windows에서 복구 기록 링크 격리 test가 junction으로 같은 성질을 확인하게 함. 문서에 96.0%는 글자 run 편집 coverage이며 외부 머리말·꼬리말·각주·미주 표본이 각 2 run뿐임을 밝힘

### Sprint 0 재현성과 P0 방어

- ZIP entry 압축 해제를 선언 크기 기준으로 스트리밍 중 차단하고, 크기와 무관하게 모든 HWPX 디코딩을 decoder worker로 옮겨 요청(첫 section·background 전체)마다 heap 한도·wall-clock timeout·구조화된 오류 code 적용
- Node.js 22·npm 10 개발 계약과 Windows install/test/probe/build CI 추가
- Linux `dir` 패키지 target과 xvfb 패키지 앱 matrix·HWP·PDF E2E, unpacked 앱 artifact를 올리는 Linux CI 추가
- 단일 완료율을 폐기하고 capability별 외부 승인까지 추적하는 장기 로드맵 추가
- HWPX read-only와 editing 경로의 entry·경로·암호화·압축 해제 제한 통합
- Electron renderer sandbox와 명시적 context isolation 활성화
- 새 창과 navigation의 외부 protocol을 HTTPS로 제한하고 정책 단위 테스트 추가
- 미사용 `electron-updater` 제거와 ZIP/XML production dependency 안전 버전 갱신
- production dependency audit 0 vulnerabilities 검증
- main·core·renderer 독립 TypeScript typecheck와 Windows CI 관문 추가
- CFB FileHeader·nullable window·PDF dialog·editable union·InputEvent 타입 오류 정리
- XML depth·node·text·DOCTYPE 사전 검사와 실제 깊이 폭탄 HWPX 회귀 fixture
- 이미지 개수·byte·decoded dimension·pixel budget과 dimension 폭탄 HWPX 회귀 fixture
- `BinData` resource를 순차적으로 읽어 일시적인 병렬 메모리 할당 제거
- production 진입점 기준 [legacy inventory](docs/legacy_inventory.md) 작성
- 손실성 초기 parser·normalization·renderer-engine·Zustand store와 구형 shared 타입 제거
- 미사용 `zustand`·`katex`·`@types/katex`·`react-icons` dependency 제거
- Windows x64 production `dir` package 명령과 OS별 V3 acceptance bundle 생성 지원
- OS별 글꼴 대체 체인(Windows 맑은 고딕 우선, 바탕은 한국어 보조 글꼴 설치 시)과 한/영 family alias, 미설치 시 CSS generic fallback, 글꼴 목록 실패 시 Windows는 맑은 고딕만 반환(자동 테스트 기준, Windows 실기 검증 대기)
- EOL Electron 28.3.3을 Electron 44.4.5(Chromium 152·Node 24)로 올리고 drag-and-drop `File.path` 제거를 `webUtils.getPathForFile`로, 대화상자 Downloads 기본 폴더 변경을 마지막 폴더 기억으로 대응
- Electron 44 요구사항에 맞춰 macOS 패키지 `minimumSystemVersion`을 13.0으로 지정
- OS 파일 열기 경로를 포커스된 창(없으면 최근 창·새 창)으로 전달하고 대화상자를 요청한 창에 연결, `document:import`·`editing:start`는 main이 건넨 경로와 끌어 놓은 일반 문서 파일만 창별 허용목록(실제 경로 비교)으로 받으며 미사용 `dialog:openImage` 제거
- 편집 엔진(package·source tree·history·projection 디코딩·Save As 검증)을 창별 worker thread로 옮겨 heap 한도(1.5 GiB)와 요청별 timeout(시작 120초·command·실행 취소 60초·저장 180초)을 걸고, timeout·crash·OOM은 worker를 종료해 `EDITING_ENGINE_TIMEOUT`·`EDITING_ENGINE_CRASHED`·`EDITING_RESOURCE_EXHAUSTED`로 session을 끝내며 남은 저장 임시 파일 정리
- 편집 엔진이 timeout·crash·메모리 초과로 중단되면 renderer가 세션 종료 안내와 함께 편집 모드를 닫고 마지막 문서 화면을 유지한 보기 모드로 돌아가며, 뒤이어 실패한 대기 요청의 만료 안내로 덮어쓰지 않음
- 편집 worker 격리 비용 benchmark 추가: large-progressive keystroke 하나 commit의 main thread 점유 p50 771ms→93ms, 왕복 지연 p50 771ms→660ms
- 편집 worker가 command·실행 취소·다시 실행 뒤 바뀐 section(header.xml이 바뀌면 바뀐 목록·빈 문단 style을 쓰는 section과 style map)만 다시 해석해 전체 문서 대신 projection patch를 보내고 renderer가 바뀐 section만 바꿔 적용(entry 목록·그림·쪽 크기 변경은 전체 문서, 기준 불일치는 refresh로 복구, 공개 corpus 38종 4,049단계 전체 decode 동치 검사)
- 편집 화면이 바뀐 section만 다시 그리고 측정·조판하며 capability·문단 구조·자리 표시 집계를 section별로 cache하고 그림 data URL을 resource마다 한 번만 만들어, large-progressive 한 글자 입력이 DOM에 반영되기까지 p50 989ms→31ms
- 편집 worker benchmark에 전체 projection 재현·결과 크기·실행 취소 측정을 더하고(keystroke 왕복 p50 679ms→7.3ms, 결과 12.8 MB→75 KB) 패키지 앱 한 글자 입력 지연 측정 `benchmark:edit-latency` 추가
- 편집 session마다 `<userData>/recovery/<sessionId>/journal.hfj` 복구 기록(길이·CRC-32 한 줄 record, 원본 크기·수정 시각·SHA-256 header, history가 replay하는 forward transaction과 실행 취소·다시 실행·저장 지점)을 main이 dirty일 때만 0.5초 간격 fdatasync로 쓰고, worker가 같은 commit 경로로 replay해 revision·저장 지점까지 되살리며 끊긴 꼬리는 버리고 손상·한도 초과·replay 실패 기록은 격리
- 앱 시작·같은 원본 열기·편집 엔진 중단 직후 남은 복구 기록을 창 대화상자([복구]·[버리기]·[나중에], 마지막 변경 시각·편집 수)로 묻고, 원본 크기·수정 시각·SHA-256이 같을 때만 원본을 열어 편집 모드·dirty로 되살리며(바뀌었거나 없으면 복구 거절), 패키지 앱 SIGKILL 강제 종료→재실행 복구→Save As·재열기 E2E(`HAN_FLOW_VERIFY_CRASH_RECOVERY`)를 baseline matrix에 추가
- [저장하지 않음]으로 닫거나 앱을 끝낼 때 복구 기록 삭제를 기다린 뒤 창을 닫아 버린 편집을 다시 묻지 않고, 편집 준비·복구 중 닫힌 창의 worker를 끝내며, 복구 기록 한도 초과·쓰기 실패를 상태 막대에 계속 알리고, replay는 편집이 만드는 forward command와 단순 문단·표 조각만 적용하며, 같은 기록을 두 창이 복구하지 않게 하고, 게시 뒤 저장 timeout은 저장 파일이 있다고 안내하며, projection patch 불일치는 refresh로 다시 맞추고, 원문 개체 census에 글자 겹치기(`unknown`) 추가하고, 패키지 앱 matrix에 [저장하지 않음] 종료 뒤 남은 복구 기록 0개 확인 추가
- 모든 IPC handler를 보낸 쪽 검사(`ipc_guard.ts`: senderFrame 존재·창의 최상위 main frame·renderer 원본 URL인 패키지 `index.html` 또는 개발 dev server origin)를 거치는 등록기로만 달고 통과하지 못한 요청은 거부(handle은 `IPC_UNTRUSTED_SENDER`, on은 무시, channel·이유마다 경고 한 번)하며, `pdf:ready`를 요청별 listener 대신 UUID 대기열로 바꾸고, `webSecurity`·`webviewTag` 등 창 보안 설정 명시·`will-attach-webview` 차단·웹 권한 요청 거절, 쓰지 않던 `askOpenMode` preload API와 context isolation 없는 전역 노출 제거
- 표 구조 command(행·열 추가·삭제, 셀 병합·분할)가 표 원문 두 벌 대신 원문 길이·SHA-256과 변경 조각(`patch-table-fragment`)만 담아 약 200 KiB 표 가운데 행 추가의 history 항목 847 KB→11 KB, 복구 기록 record 459 KB→6 KB로 줄이고(행 추가·실행 취소 반복이 64 MiB 한도에 닿는 편집 수 146→약 1.1만), 복구 기록 형식을 version 2로 올리되 version 1 기록도 읽어 replay하며, replay 검사는 변경 조각 command 모양을 확인하고 현재 표에 적용한 결과에 같은 표 규칙을 적용

### Sprint 4 호환성 corpus

- 한/글 저장본 공개 테스트 HWPX 26종(hwpxlib·python-hwpx, Apache-2.0)을 sha256·출처와 함께 external corpus로 반입, 전부 열림
- 실제 한/글 HWPX용 `source: file` manifest(sha256·출처·라이선스·`personalData: false`)·catalog `external` provenance·`corpus:intake` helper와 확보 계획 추가
- 편집 가능 비율 측정 `corpus:editing-coverage`(run·문단·표 셀·표 구조별 capability와 patch dry-run, 거부 사유 histogram)와 기준선 추가: 외부 26종 text 편집 79.5%·글자 가중 89.3%(빈 `<hp:t/>`·표 셀 text 해제 후 89.8%·92.8%)
- HWPX decoder가 그리지 못해 조용히 버리던 수식·차트·OLE·글상자·도형·양식 컨트롤·동영상·각주/미주·메모·덧말을 선언 크기의 읽기 전용 자리 표시(`object-placeholder`, 구역 끝 각주·미주 목록)로 남기고 수식 script·글상자 글(외부 fixture 53자)·각주/미주 본문·메모 내용을 되살림, 구역별 종류별 진단과 corpus `placeholders` 기대값 추가(편집 coverage 수치 불변)
- 자리 표시를 화면·표 셀·PDF에서 같은 테두리 상자와 한국어 이름표로 그리고, 문서 안내 배너·상태 막대 개수 표시와 PDF 내보내기 전 [그래도 내보내기]/[취소] 확인(E2E 경로 제외)을 추가, 패키지 앱 검증에 `placeholderCounts`와 개체 소실 회귀 검사·수식/글상자 matrix 항목 추가
- 문단 여백 단위(HwpUnitChar `hp:case` ×1, `hp:default`·직접 ×2)를 읽기·쓰기 공통 판정 모듈로 옮겨 node별 조상 경로로 정하고, 여러 `hp:switch`·모르는 namespace case·중첩 구조에서 읽기 값과 저장 값이 어긋나던 문제와 목록 heading switch 뒤 여백을 0으로 읽던 문제 수정(편집은 모든 representation을 함께 갱신)
- 문단 구조 편집 판정을 편집 코어와 capability가 함께 쓰는 규칙으로 모아 수식·글상자 등 개체가 든 문단에서 Enter·경계 병합·여러 문단 범위를 `PARAGRAPH_HAS_OBJECT` 이유와 함께 막고(글자 입력은 유지) UI가 열고 코어가 거부하던 외부 33·합성 3문단 불일치를 0으로, `corpus:editing-coverage`에 문단 구조 지표 추가
- `verify:pdf` 결과에 페이지별 공백 외 전체 글자·제외한 사설 영역 글자·ASCII 숫자 수(화면/PDF)를 항상 남기고 숫자나 `requiredPdfText`가 PDF에서 빠지면 실패, HWPX 화면은 rhwp 검증 한컴 PUA 표(MIT)로 U+F03DA 같은 기호를 표준 글자로 표시(원문·편집·저장은 원래 글자 유지)
- 패키지 앱 검증이 HWPX 원문 개체를 종류별(수식·차트·OLE·글상자·도형·양식·동영상·각주·미주·메모·필드·덧말)로 세어 화면 자리 표시가 적은 종류가 있거나 원문을 읽지 못하면 실패, hwpxlib OLE·양식 단추 표본을 반입해 개체 matrix가 수식·글상자·각주/미주·메모·양식·OLE를 모두 덮음
- 쪽 본문보다 높은 개체 자리 표시를 비율대로 줄여 "(축소)"로 표시하고 되살린 글상자 글은 CSS zoom으로 한 쪽에 맞추며, 구역 끝 각주·미주 목록을 각주 문단마다 block으로 나눠 쪽 사이에서 나뉘게 함(쪽보다 큰 수식·글상자·셀 안 글상자·각주 40개 합성 fixture의 화면 overflow와 PDF 글자 손실 해소, verify:matrix 추가), PDF·matrix 검증 스크립트가 자식 출력 UTF-8을 chunk 경계에서 깨뜨리던 문제 수정
- 리본 select 화살표를 오른쪽 padding 안에 그리고 표 테두리 두께 select를 넓혀 "0.12mm" 끝이 가려지지 않게 하고, 툴바 넘침 검사에 select(가장 긴 option)·글자 input(값·placeholder)의 canvas 글자 폭 비교를 추가, 메모 줄 안 표시의 쌍점을 CSS ::after 대신 글자로 그려 화면·PDF 글자 수 불일치 해소
- README·architecture의 자리 표시 설명을 알려진 제한과 맞춤(선언 크기 참고·쪽보다 크면 축소, 원본 위치·회전·쪽 배치와 수식 조판·차트 그리기 미재현, 각주·미주는 구역 끝 목록)

### Sprint 5 Windows 배포 후보

- 결정적 `icon:ico` 생성기와 비서명 x64 NSIS 설치본 target(한국어·설치 경로 선택·파일 연결), Windows CI의 패키지 앱 matrix·HWP·PDF E2E와 설치본·unpacked artifact 업로드 추가
- PDF 저장 대화상자 기본 이름을 `문서.pdf` 대신 열린 문서 이름(Windows 금지 문자 정리)으로, PDF 제목을 `Han-Flow` 대신 문서 이름으로 바꾸고 창 제목을 `<파일 이름> - Han-Flow`로 표시(Windows 경로 구분자에서 툴바가 전체 경로를 보이던 문제 포함)
- 모든 편집 control이 `홈` 탭 하나에 있던 리본을 `파일`·`편집`·`서식`·`표`·`보기` 탭으로 나누고 확대/축소·열기·PDF를 리본으로 옮김(편집 중 기본 `서식`, 표 안 caret은 탭 전환 없이 `표` 탭 표시, WAI-ARIA tabs 키보드 이동)
- HWPX XML 본문의 숫자처럼 보이는 글자(`1.`·`2017.`·`007`)를 숫자로 바꿔 목차 번호·날짜의 점을 잃던 문제 수정, 화면·PDF 글자 수 비교를 code point 단위로 하고 PDF로 추출되지 않는 사설 영역 글자를 제외, 표지·목차 보고서 합성 fixture와 matrix PDF 검증 추가
- 내어쓰기(음수 `hc:intent`) 문단의 첫 줄을 CSS `text-indent`로 왼쪽 여백 밖까지 당겨 PDF에서 문단 앞부분이 용지 밖으로 잘리던 문제를 첫 줄은 왼쪽 여백·둘째 줄부터 들임으로 고치고, HwpUnitChar `hp:case` 밖(한/글 2018 저장본의 직접 `hh:margin`·`hp:default`) 문단 여백·간격이 HWPUNIT 2배로 저장된 것을 반영(읽기 절반·쓰기 2배), 내어쓰기 합성 fixture·matrix PDF 비교·용지 밖 글자 E2E 검사 추가
- 보도자료 머리 표처럼 좁은 가운데 정렬 셀의 내어쓰기가 셀 안쪽 폭보다 커서 `배포`가 왼쪽 날짜 셀 끝과 겹치던 문제를 셀 안쪽 폭 안으로 내어쓰기를 줄여 수정, 합성 fixture에 머리 표와 표 셀 밖 글자 E2E 검사 추가
- 기본 편집 E2E가 글자 칸 없는 빈 문단(합성 anchor `#hp:p:N:empty`)을 첫 surface로 고르면 첫 입력 뒤 새 `#hp:t:M` anchor로 바뀌는 것을 따라가지 못해 `projection` 대기 시간 초과로 실패하던 probe를 caret을 가진 새 anchor를 따라가도록 수정(앱 동작은 정상), 구역 첫 문단이 빈 문단인 합성 fixture로 matrix 편집·저장 검증 추가
- 아주 긴 파일 이름에서 상단 막대 파일 이름이 오른쪽 `편집 시작` 버튼을 밀어 버튼 글자가 세로로 줄바꿈되던 문제를 파일 이름 한 줄 말줄임(전체 이름 tooltip)·동작 버튼 고정 폭·툴바/리본 버튼 `nowrap`으로 수정하고, 툴바 control 넘침·파일 이름 말줄임 E2E 검사와 배율 1·1.25·1.5 긴 한글 파일 이름 matrix 검증 추가
- 인증서 없이도 준비된 Windows 서명 배포 경로: 비서명 설정을 이어받아 `forceCodeSigning`·SHA-256·RFC 3161 timestamp·별도 출력(`release/windows-release`)을 덧씌운 `package:win:release`(PFX `WIN_CSC_LINK` 또는 Azure Trusted Signing, 서명 재료가 없으면 빌드 전 실패), Authenticode 서명·timestamp·버전 리소스·appId·NSIS 설치 방식·`.hwp`/`.hwpx` 연결·SHA-256을 보고하는 `release:audit:win`(Windows는 PowerShell, 그 밖은 osslsigncode, 서명자 이름·secret 값 미출력)과 parser probe test, secret이 없으면 첫 단계에서 실패하고 test 뒤 서명 설치본·strict 감사·`SHA256SUMS.txt`·artifact를 만드는 `release-windows.yml`(수동·`v*` tag) 추가. 비서명 `windows-ci.yml`은 그대로

### V3 HWPX 편집 기반

- 한/글 내보내기가 기본값으로 쓰는 취소선 shape="3D"를 취소선으로 그리던 문제 수정(실제 선 종류 13종만 취소선으로 인정)
- 과거 editor store·normalized model·serializer와 저장 IPC 감사
- KS X 6101·HWPX package, IME event, transaction과 안전 저장 1차 출처 조사
- source package·editable model·viewer projection 분리 전략
- loss report, 한국어 IME matrix와 단계별 round-trip 품질 관문
- 모든 HWPX entry의 bytes·compression·CRC를 보존하는 `HwpxSourcePackage`
- path traversal·duplicate·encrypted entry·압축 해제 크기 제한
- unknown XML·binary 공개 fixture와 entry SHA-256 identity round-trip
- 저장소 밖 실사용 HWPX의 privacy-safe identity 검증
- 잘못된 mimetype과 package 손실을 만들던 과거 serializer·저장 IPC 제거
- source span 기반 단일 `hp:t` text patch와 inverse command
- XML entity·공백·빈 node·Unicode boundary 검증
- preserved/modified entry와 Preview 상태를 구분하는 `LossReport`
- 임시 파일 flush·재개봉·viewer 검증 후 새 목적지에만 commit하는 Save As 코어
- 저장소 밖 실사용 HWPX 한 text patch·Save As와 원본 hash 불변 검증
- 여러 text command의 원자적 transaction과 역순 inverse
- transaction 결과의 기존 `ViewerDocument` projection 재생성
- snapshot 없는 100 entries·8 MiB bounded undo/redo history
- input type·selection·anchor·시간·composition 기반 typing grouping
- logical savepoint·dirty, undo branch와 redo 폐기
- 저장소 밖 실사용 HWPX transaction·undo·redo·Save As 검증
- source anchor 기반 `ApplyCharacterStyleCommand`와 `ApplyParagraphStyleCommand`
- 원본 style clone, 동일 definition 재사용과 결정적 style ID allocation
- `charProperties`·`paraProperties` item count와 section reference 원자적 변경
- 굵게와 문단 정렬 4종의 제한된 toolbar, `⌘B`와 selection 동기화
- style definition·reference를 함께 복원하는 undo/redo와 실사용 HWPX Save As 재열기 검증
- 단일 `hp:t` 부분 선택을 좌·선택·우 run으로 분할하는 글자 style command
- XML entity 의미와 선택 방향을 보존하는 새 source anchor 이동
- 분할 fragment와 추가 style definition을 byte 단위로 복원하는 undo/redo
- 저장소 밖 HWPX의 부분 선택·저장·재열기 E2E 관문
- 일반 표 body cell의 단일 문단·단일 run 텍스트 입력 surface
- 반복 머리글·병합·rowSpan·continuation cell의 중복 source anchor 편집 차단
- 공개 baseline 표 셀 undo/redo·Save As·재열기 검증
- 공개 HWPX matrix baseline에 표 셀 편집 release gate 추가
- 부분 style로 여러 run이 된 최상위 문단의 run별 입력 surface와 좌우 경계 이동
- style projection 뒤 stale DOM selection offset 방어와 run 수 변경 시 안전한 surface 재생성
- `ApplyCharacterStyleCommand`의 5–72pt 글자 크기와 `#RRGGBB` 글자색
- 글자 크기 증감·색상 선택 toolbar와 활성 source style 동기화
- Windows·Linux Ctrl 단축키(Ctrl+Y 포함)·tooltip 표기와 contentEditable 네이티브 undo/redo의 앱 history 우회(자동 테스트 기준, Windows 실기 검증 대기)
- 부분 글자 style·문단 정렬을 함께 적용한 package Save As·재개봉 통합 검증
- V3 자동 코드 관문 완료와 macOS 실제 두벌식·Windows 한/글 외부 승인 matrix 분리
- Save As를 같은 폴더 임시 파일로 쓰고, 새 파일은 hard link(목적지가 생기면 OS가 EEXIST로 거부)로, 교체를 확인한 기존 파일은 `rename`으로 원자적 게시하며 hard link 미지원 파일 시스템(exFAT·FAT32·일부 SMB)에서만 확인 후 `rename`으로 대체하고 열린 원본은 항상 거부(자동 테스트 기준, Windows 실기 검증 대기)
- 저장·PDF 파일 권한을 0o600 대신 umask를 적용한 기본값으로 게시하고, PDF 내보내기도 편집 중인 원본·심볼릭 링크 목적지를 PDF 전용 안내와 함께 거부
- 개발 빌드의 Windows·Linux에서 메뉴 없이 F12·Ctrl+Shift+I로 DevTools 열기
- 한/글이 빈 입력 칸으로 저장하는 자기 닫힘 `<hp:t/>`를 빈 text anchor로 인정해 입력 시 `<hp:t>…</hp:t>`로 펼치고 undo는 원래 tag bytes로 복원, viewer decoder와 편집 tokenizer의 `hp:t` ordinal·text를 공개 corpus 전체에서 교차 검증
- 표 셀 text 편집을 구조 편집 조건에서 분리해 병합·머리글·여러 run 셀도 문단 하나 안에서 입력·삭제·치환 허용(행·열·병합·분할·셀 style·문단 나눔은 기존대로 일반 body 셀만, 쪽을 넘어 나뉜 셀 조각은 계속 읽기 전용)
- 편집 코어 tree 전환 1단계: 원문 범위를 보존하는 source tree와 serializer로 text 입력·삭제·치환을 옮기고(출력 bytes는 전환 전과 동일, 공개 corpus identity·differential 관문), package별 tree cache로 대형 section 입력 비용을 keystroke당 약 4.1ms에서 1.2ms로 단축
- 텍스트 편집이 `hp:t`에서 바뀐 범위의 text node만 다시 써 inline `hp:tab`의 폭·채움 attribute, 비표준 entity 표기, 원문 CR/LF를 보존하고(빈 편집은 byte 단위로 동일), undo는 지운 범위의 원문 표기까지 복원
- 편집 코어 tree 전환 2단계: 글자·문단·셀 모양 command를 section·header.xml source tree 연산으로 옮기고(공개 corpus 4,782 command differential에서 출력 bytes·inverse·오류가 전환 전과 동일, 다른 attribute 값 안의 이름·줄바꿈 값·분할 조각 entity 표기를 잘못 다루던 잠재 버그 수정), package 전체 tree cache로 대형 문서의 굵게 toggle 비용을 약 6.3ms에서 1.5ms로 단축
- 편집 코어 tree 전환 3단계: 문단 분할(Enter)·경계 병합(Backspace·Delete)·여러 문단 범위 치환을 source tree로 옮겨 경계 `hp:t`의 inline `hp:tab` 폭·채움 attribute와 entity 표기를 보존하고(기본 표기 문단은 전환 전과 bytes·inverse·오류 동일, `hp:linesegarray`는 새로 만든 문단에서만 제거), 대형 section의 Enter+Backspace 비용을 약 18.9ms에서 5.4ms로 단축
- 편집 코어 tree 전환 4단계: 표 행·열 추가/삭제와 1×2 셀 병합·분할을 source tree로 옮기고(공개 corpus 401 command differential에서 오류·표 fragment·selection·bytes·inverse가 전환 전과 동일, CDATA·다른 attribute 값 안의 이름·문자 참조 주소를 잘못 읽고 둘째 문단에 줄 배치 정보가 있는 병합 셀 분할에서 잘못된 XML을 쓰던 잠재 버그 수정), 큰 표의 행 추가+실행 취소 비용을 약 6.0ms에서 4.0ms로 단축
- 편집 코어 tree 전환 정리: legacy 문자열 구현 4개와 정규식 attribute·`replaceRange`·`scanXmlElements`·CDATA `as-tag` scanner 경로를 제거하고, legacy differential을 공개 corpus 1,842 case의 SHA-256 golden 회귀와 exact undo·redo 검사로 대체해 `npm test` 시간을 약 168s에서 45s로 단축
- HWPX entry CRC-32를 byte 단위 JS 구현에서 Node 내장 `zlib.crc32`로 교체(없으면 JS 구현으로 대체, 모든 공개 fixture entry와 무작위 buffer에서 값 동일)해 대형 section 입력 비용을 keystroke당 약 1.1ms에서 0.3ms로, Enter+Backspace를 약 3.9ms에서 2.2ms로 단축
- 최상위 표의 셀(병합·머리글 셀 포함) 직속 문단에 글자 모양(굵게·기울임·밑줄·취소선·크기·색·글꼴, 부분 선택 run 분할 포함)과 문단 모양(정렬·줄 간격·앞뒤 간격·첫 줄 들여쓰기)을 허용하고 ribbon·단축키를 같은 capability로 열기(셀 안 표와 머리말·글상자는 계속 거부, 외부 26종 글자 모양 46.9% → 78.2%·문단 모양 49.4% → 79.1%)
- `hp:t`가 없는 빈 문단·빈 셀(`<hp:run/>`, 구역 정의만 든 첫 문단, run 없는 `<hp:p/>`)에 `#hp:p:N:empty` 합성 caret anchor를 두고 첫 입력 때 한/글 저장 방식대로 `hp:t`(필요하면 문단 style 글자 모양의 run)를 만들며 undo는 원래 bytes 복원, selection은 새 `hp:t` anchor로 이동(외부 26종 빈 문단 44/46·표 셀 49/66 → 66/66·문단 모양 79.1% → 90.2%)

### V2 HWP fixed-page

- HWP 페이지별 세로·가로 용지 크기를 보존하는 PDF 출력
- HWP PDF 페이지 크기·텍스트 보존·가로 페이지 PNG 자동 검증
- 기존 HWPX 화면/PDF 페이지별 글자 수 회귀 관문 유지
- HWP/HWPX cold peak working set과 V1 대비 package 증가량 측정
- 중복 rhwp WASM 제거와 MIT license resource 포함
- rhwp 파싱·페이지 처리를 전용 Web Worker로 분리
- 새 문서 열기 취소, Worker 강제 종료형 timeout과 crash 오류 격리
- Worker 격리 후 HWP cold/warm 20회 첫 화면 p95 614/237ms 검증
- Worker 격리 후 HWP cold 5회 aggregate working set peak p95 647.6MiB 기록
- ADR-0001에서 rhwp production visual engine과 kordoc development oracle 역할 확정
- HWP parser MIT 원문과 third-party notice를 production package에 포함
- package license·notice 원문 일치를 release gate에서 자동 검증
- 개인정보 없는 2쪽 HWP fixture와 결정적 SHA-256 manifest
- kordoc 구조 oracle·rhwp SVG·패키지 앱·PDF를 잇는 `verify:hwp-matrix`
- PDF 출력 전 모든 fixed-page SVG decode를 기다려 마지막 페이지 누락 race 수정
- 저장소 밖 실사용 HWP의 화면·PDF 텍스트 보존 재검증
- HWP CFB·FileHeader signature·5.x version main-process preflight
- 암호·배포용·DRM·비지원 version·손상 HWP 구조화 오류 코드와 사용자 안내
- 공개 HWP 변형 5종의 production 오류 E2E와 임시 저장소 정리 재시도
- 포트폴리오에 재사용할 수 있는 날짜별 검증 이력 문서
- HWP/HWPX를 하나의 `DocumentImporter`와 `document:import` IPC 계약으로 통합
- preload·React loader의 공통 성공·오류·background 완료 경계
- 항상 실패하던 과거 HWP CFB stream prototype 제거

## 1.0.0-rc.1 - 2026-07-23

Han-Flow의 첫 v1 Release Candidate다. macOS에서 HWPX를 빠르게 열어 읽고 같은 페이지 구조로
PDF를 내보내는 로컬 실사용 범위를 완성했다.

### 주요 기능

- ordered OWPML decode와 결정적 read-only 문서 모델
- 문단·글자 스타일, 표·병합 셀, 테두리·배경, 이미지 resource
- 머리말·꼬리말, 구역별 쪽 번호와 번호 재시작
- 실제 DOM 높이를 사용하는 2-pass pagination
- 표 셀 문단 continuation과 반복 header
- worker 기반 점진 decode와 50페이지 초과 page virtualization
- Finder 더블클릭, single-instance, drag-and-drop
- dark mode chrome, 트랙패드 pinch zoom, PDF 내보내기
- production 앱·PDF·공개 fixture 자동 검증
- background decode와 DOM measurement 완료를 기다리는 안정된 E2E 상태 수집

### 검증 기준

- 저장소 밖 실사용 HWPX: 페이지·이미지 보존과 overflow 0
- 실사용 HWPX PDF: 화면과 페이지별 글자 수 일치
- 공개 호환성 matrix: 기본, continuation, 이미지·rowSpan, 대형 progressive, 손상 package
- 대형 synthetic: 9,767페이지 중 DOM 12개 mount, overflow 0

### 알려진 제한

- 원문 글꼴이 없으면 대체 글꼴 metric으로 줄바꿈과 페이지별 분배가 달라질 수 있다.
- 한 문단 내부의 줄 단위 페이지 분할은 하지 않는다.
- 복잡한 `rowSpan`, 복수 overflow 셀과 단일 초대형 문단은 안전한 행 단위 fallback을 사용한다.
- `.hwp` 5.0 바이너리 직접 파싱과 편집은 v1 범위가 아니다.
- 현재 패키지는 서명·공증되지 않은 로컬 beta다.
