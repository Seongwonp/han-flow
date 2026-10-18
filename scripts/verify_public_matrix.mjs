import { createRequire } from 'node:module'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { generateCorpusFixture, validateCorpusManifest } from './corpus/public_corpus.mjs'
import { linkHwpxManifest, validateFixtureCatalog } from './corpus/fixture_catalog.mjs'
import { defaultAppBinary } from './app_binary.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = resolve(import.meta.dirname, '..')
const appBinary = process.argv[2] ? resolve(process.argv[2]) : defaultAppBinary(root)
const generatorPath = resolve(root, 'tests/fixtures/public/create_synthetic_hwpx.ts')
const manifestPath = resolve(root, 'tests/fixtures/public/hwpx_corpus_manifest.json')
const catalogPath = resolve(root, 'tests/fixtures/public/fixture_catalog.json')

function loadGenerator() {
  const source = require('node:fs').readFileSync(generatorPath, 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText
  const loaded = { exports: {} }
  const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', javascript)
  execute(createRequire(generatorPath), loaded, loaded.exports, generatorPath, dirname(generatorPath))
  return loaded.exports
}

async function verify(fixture, delayMs, expectedError = false, environment = {}) {
  let standardOutput = ''
  let standardError = ''
  await new Promise((resolvePromise, reject) => {
    const arguments_ = [resolve(root, 'scripts/verify_app.mjs'), fixture, appBinary]
    if (expectedError) arguments_.push('--expect-error')
    const child = spawn(process.execPath, arguments_, {
      env: { ...process.env, HAN_FLOW_VERIFY_DELAY_MS: String(delayMs), ...environment },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    // UTF-8 글자가 chunk 경계에서 잘려 U+FFFD로 바뀌지 않도록 stream decoder로 읽는다.
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { standardOutput += chunk })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { standardError += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`fixture 검증 실패(${code}): ${standardError.trim() || standardOutput.trim()}`))
    })
  })
  const resultLine = standardOutput.split('\n').find((line) => line.startsWith('HAN_FLOW_APP_VERIFY '))
  if (!resultLine) throw new Error(`검증 결과를 찾지 못했습니다. ${standardError.trim()}`)
  return JSON.parse(resultLine.slice('HAN_FLOW_APP_VERIFY '.length))
}

async function verifyPdf(fixture) {
  let standardOutput = ''
  let standardError = ''
  const exitCode = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'scripts/verify_pdf.mjs'), fixture, appBinary], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    // UTF-8 글자가 chunk 경계에서 잘려 U+FFFD로 바뀌지 않도록 stream decoder로 읽는다.
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { standardOutput += chunk })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { standardError += chunk })
    child.once('error', reject)
    child.once('exit', resolvePromise)
  })
  const resultLine = standardOutput.split('\n').find((line) => line.startsWith('HAN_FLOW_PDF_VERIFY '))
  if (!resultLine) throw new Error(`PDF 검증 결과를 찾지 못했습니다(${exitCode}). ${standardError.trim()}`)
  return JSON.parse(resultLine.slice('HAN_FLOW_PDF_VERIFY '.length))
}

// 화면과 PDF의 페이지별 글자 수를 비교할 production fixture.
// report-toc: 목차 번호(`1.`)와 사설 영역 글머리, hanging-indent: 내어쓰기 첫 줄이 용지 밖으로 잘리던 문단.
const PDF_FIXTURE_IDS = new Set(['report-toc', 'hanging-indent'])

// 원본 개체 자리 표시 회귀 검증용 external fixture(hwpx-core 전용 공개 파일). 화면 자리 표시 종류별 개수는 corpus manifest
// 기대값과 같아야 하고, 문서 안내 배너가 보여야 하며, PDF 내보내기(E2E 경로는 확인 대화상자를 건너뛴다)가 화면과 같은 글자를 담아야 한다.
// verify_app은 원문 종류별 개체 수(source_object_census)보다 화면 자리 표시가 적으면 실패한다. 종류마다 하나 이상:
// 수식, 글상자, 각주·미주, 메모, 양식 컨트롤(명령 단추·선택 상자·라디오 단추), OLE.
const OBJECT_FIXTURE_IDS = [
  'ext-hwpxlib-equation',
  'ext-pyhwpx-text-box-fields',
  'ext-pyhwpx-foot-endnotes',
  'ext-pyhwpx-memos',
  'ext-hwpxlib-buttons',
  'ext-hwpxlib-ole'
]
// 원문 개체 종류가 matrix에 하나 이상 있어야 하는 종류.
const REQUIRED_OBJECT_KINDS = ['equation', 'text-box', 'footnote', 'endnote', 'memo', 'form-control', 'ole']

// 쪽 나눔 스트레스 합성 fixture(generator 함수로 직접 만든다). 화면 overflow·용지/셀 밖 글자 0, 원문 개체 종류별 수,
// 화면과 PDF의 페이지별 글자 수가 같아야 한다.
// - long-objects: 쪽보다 높은 수식·글상자와 표 셀 안 글상자 → 줄여 그린 자리 표시 2개 이상
// - footnote-flow: 각주 40개 → 각주마다 번호 표시가 놓인 쪽 아래에 놓이고(verify_app이 쪽 불일치를 실패로 본다) 본문이 그만큼 줄어 여러 쪽
// - footnote-long: 한 쪽보다 긴 각주 → 줄 단위로 나뉘어 다음 쪽 아래에 이어지고 overflow 없음
// - inline-objects: 글자+수식·글자+글상자 문단과 셀 안 글자+수식
const LAYOUT_STRESS_FIXTURES = [
  { id: 'long-objects', create: 'createLongObjectHwpx' },
  { id: 'footnote-flow', create: 'createFootnoteFlowHwpx' },
  { id: 'footnote-long', create: 'createLongFootnoteHwpx' },
  { id: 'inline-objects', create: 'createInlineObjectHwpx' }
]
// 긴 각주 편집 E2E: 쪽을 넘어 나뉜 첫 각주의 앞 조각(원본 문단 전체를 잘라 그린 입력 칸)에 입력하고 저장한 뒤 다시 연다.
const LONG_FOOTNOTE_EDIT_TEXT = '긴각주고침'

// 편집 범위 확장 E2E(createEditScopeHwpx, 2쪽): 표만 든 문단의 표 앞·뒤 caret, 쪽 아래 각주·구역 끝 미주 본문, 두 쪽에 같은
// 머리말·꼬리말에 입력·실행 취소·다시 실행한 뒤 Save As하고 저장본을 다시 열어 글자를 확인한다. 머리말·꼬리말은 두 쪽의 입력 칸이
// 함께 바뀌고 저장본의 두 쪽 모두에 글자가 있어야 하며, 칸 끝·처음의 방향 키가 다른 쪽의 같은 칸으로 caret을 옮기면 안 된다.
const EDIT_SCOPE_CASES = [
  { target: 'table-caret', text: '표앞글' },
  { target: 'table-caret-after', text: '표뒤글' },
  { target: 'note', text: '각주고침' },
  { target: 'endnote', text: '미주고침' },
  { target: 'header', text: '머리말고침' },
  { target: 'footer', text: '꼬리말고침' }
]
const DECORATION_TARGETS = ['header', 'footer']

// 원본 위치 개체 E2E(createFloatingObjectHwpx): 화면 개체 상자(용지 기준 CSS px)가 generator의 기대값(FLOATING_OBJECT_EXPECTED,
// HWPUNIT)과 이 오차 안에서 같아야 하고, 자리 차지·글 옆 배치 개체와 본문 글이 겹치지 않아야 한다(verify_app이 실패로 본다).
// 문단 편집·쪽 위 표 셀 편집 뒤 저장본을 다시 열어도 개체가 같은 자리에 있어야 한다.
const FLOATING_TOLERANCE_PX = 1.5
const hwpToPx = (value) => (value * 96) / 7200
const FLOATING_EDIT_CASES = [
  { id: 'paragraph', environment: { HAN_FLOW_VERIFY_EDIT_TEXT: '개체문단', HAN_FLOW_VERIFY_EDIT_SAVE: '1' } },
  { id: 'table-cell', environment: { HAN_FLOW_VERIFY_EDIT_TEXT: '쪽위표', HAN_FLOW_VERIFY_EDIT_CELL: '1', HAN_FLOW_VERIFY_EDIT_SAVE: '1' } }
]

/** 기대 상자(HWPUNIT)와 화면 개체(CSS px)의 위치·크기 차이. 기대값에 없는 축은 비교하지 않는다. */
function floatingBoxFailures(label, actual, expected) {
  if (!actual) return [`${label}: 화면에 원본 위치 개체가 없음`]
  const failures = []
  if (expected.page !== undefined && actual.page !== expected.page) failures.push(`${label}: ${actual.page}쪽(기대 ${expected.page}쪽)`)
  for (const axis of ['x', 'y', 'width', 'height']) {
    if (expected[axis] === undefined) continue
    const difference = Math.abs(actual[axis] - hwpToPx(expected[axis]))
    if (difference > FLOATING_TOLERANCE_PX) failures.push(`${label}: ${axis} ${actual[axis]}px(기대 ${hwpToPx(expected[axis]).toFixed(1)}px)`)
  }
  return failures
}

/** 원본 위치 개체 목록(쪽·배치·종류별 첫 개체). */
function floatingObject(objects, kind, placement, wrap) {
  return (objects ?? []).find((item) => item.kind === kind && item.placement === placement && (!wrap || item.wrap === wrap))
}

function floatingFailures(result, expected, label = 'floating-objects') {
  const objects = result.positionedObjects
  return [
    ...floatingBoxFailures(`${label} 글상자`, floatingObject(objects, 'text-box', 'page', 'IN_FRONT_OF_TEXT'), expected.textBox),
    ...floatingBoxFailures(`${label} 그림`, floatingObject(objects, 'image', 'page', 'TOP_AND_BOTTOM'), expected.picture),
    ...floatingBoxFailures(`${label} 표`, floatingObject(objects, 'table', 'page', 'TOP_AND_BOTTOM'), expected.table),
    floatingObject(objects, 'image', 'wrap', 'SQUARE') ? undefined : `${label}: 글 옆 배치 그림이 문단 float로 그려지지 않음`,
    floatingObject(objects, 'text-box', 'band', 'TOP_AND_BOTTOM') ? undefined : `${label}: 문단 기준 자리 차지 글상자가 흐름 안 블록으로 그려지지 않음`,
    floatingObject(objects, 'shape', 'page', 'BEHIND_TEXT') ? undefined : `${label}: 글 뒤 도형이 쪽 layer에 그려지지 않음`
  ].filter(Boolean)
}

/** 저장본을 다시 연 화면의 개체가 편집 전 화면과 같은 자리에 있는지. */
function sameFloatingObjects(before = [], after = []) {
  return before.length === after.length && before.every((item, index) =>
    item.page === after[index].page && item.placement === after[index].placement && item.kind === after[index].kind &&
    ['x', 'y', 'width'].every((axis) => Math.abs(item[axis] - after[index][axis]) <= FLOATING_TOLERANCE_PX))
}

const LONG_KOREAN_FILE_STEM = '2026년도 지식재산처 발명의 날 서포터스 발족식 개최 계획 및 홍보활동 추진 결과 보고서 최종본 수정 반영 검토 완료 배포용 사본 지역별 의견 수렴 결과 첨부 포함 최종 확정본'

const directory = await mkdtemp(join(tmpdir(), 'han-flow-public-matrix-'))
try {
  const generator = loadGenerator()
  const manifest = validateCorpusManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const catalog = validateFixtureCatalog(JSON.parse(await readFile(catalogPath, 'utf8')))
  const productionFixtures = linkHwpxManifest(catalog, manifest)
  const productionOptions = {
    baseline: {
      environment: {
        HAN_FLOW_VERIFY_EDIT_TEXT: '셀검증',
        HAN_FLOW_VERIFY_EDIT_MODE: 'range',
        HAN_FLOW_VERIFY_EDIT_CELL: '1',
        HAN_FLOW_VERIFY_EDIT_SAVE: '1'
      }
    },
    // 구역 첫 문단이 글자 칸 없는 빈 문단이라 기본 문단 편집 E2E가 #hp:p:0:empty → #hp:t:0 전환을 거친다.
    'hanging-indent': {
      environment: {
        HAN_FLOW_VERIFY_EDIT_TEXT: '시험',
        HAN_FLOW_VERIFY_EDIT_SAVE: '1'
      }
    },
    'invalid-package': {
      expectedError: true
    }
  }
  const fixtures = productionFixtures.map((fixture) => ({
    id: fixture.id,
    // production matrix는 catalog가 synthetic generator fixture만 허용한다(external은 hwpx-core 전용).
    path: generateCorpusFixture(generator, directory, fixture.manifest),
    delayMs: 500,
    ...productionOptions[fixture.id]
  }))
  const results = []
  for (const fixture of fixtures) {
    results.push({
      fixtureId: fixture.id,
      name: fixture.id,
      ...await verify(fixture.path, fixture.delayMs, fixture.expectedError, fixture.environment)
    })
  }

  // 강제 종료 복구: baseline 표 셀에 입력한 뒤 앱을 SIGKILL로 끝내고, 같은 user-data로 다시 띄워 복구 기록을 [복구]로 받아
  // 입력 글자·dirty·실행 취소 기록을 확인한 뒤 Save As하고 저장본을 다시 연다.
  const crashRecoveryResult = await verify(fixtures.find(({ id }) => id === 'baseline').path, 500, false, {
    HAN_FLOW_VERIFY_EDIT_TEXT: '복구검증',
    HAN_FLOW_VERIFY_EDIT_MODE: 'range',
    HAN_FLOW_VERIFY_EDIT_CELL: '1',
    HAN_FLOW_VERIFY_CRASH_RECOVERY: '1'
  })

  // dirty 종료: 편집을 저장하지 않은 채 앱을 끝내고 닫기 확인에서 [저장하지 않음]을 고른다. 정상 종료이므로 복구 기록이
  // 남으면 안 된다(남으면 다음 실행이 버린 편집을 복구하겠느냐고 묻는다).
  const dirtyDiscardResult = await verify(fixtures.find(({ id }) => id === 'hanging-indent').path, 500, false, {
    HAN_FLOW_VERIFY_EDIT_TEXT: '버림',
    HAN_FLOW_VERIFY_CLOSE_DIRTY_ACTION: 'discard'
  })

  // 아주 긴 한글 파일 이름: 상단 막대는 한 줄 말줄임, 버튼·리본 control은 배율 1.25·1.5에서도 줄바꿈하지 않는다.
  const longNamePath = join(directory, `${LONG_KOREAN_FILE_STEM}.hwpx`)
  await copyFile(fixtures.find(({ id }) => id === 'hanging-indent').path, longNamePath)
  const longNameResults = []
  for (const scale of ['1', '1.25', '1.5']) {
    longNameResults.push({ scale, ...await verify(longNamePath, 500, false, { HAN_FLOW_VERIFY_DEVICE_SCALE: scale }) })
  }

  const pdfResults = []
  for (const fixture of fixtures.filter(({ id }) => PDF_FIXTURE_IDS.has(id))) {
    pdfResults.push({ fixtureId: fixture.id, ...await verifyPdf(fixture.path) })
  }

  const objectResults = []
  for (const id of OBJECT_FIXTURE_IDS) {
    const entry = manifest.fixtures.find((fixture) => fixture.id === id)
    if (!entry?.expected?.placeholders) throw new Error(`${id}: manifest placeholders 기대값이 없습니다.`)
    const path = resolve(root, 'tests/fixtures/public', entry.file)
    objectResults.push({
      fixtureId: id,
      expectedPlaceholders: entry.expected.placeholders,
      ...await verify(path, 500, false, { HAN_FLOW_VERIFY_EXPECT_PLACEHOLDERS: JSON.stringify(entry.expected.placeholders) })
    })
    pdfResults.push({ fixtureId: id, ...await verifyPdf(path) })
  }

  const stressResults = []
  for (const stress of LAYOUT_STRESS_FIXTURES) {
    const path = generator[stress.create](directory, `han-flow-${stress.id}.hwpx`)
    stressResults.push({ fixtureId: stress.id, ...await verify(path, 500) })
    pdfResults.push({ fixtureId: stress.id, ...await verifyPdf(path) })
  }
  const stress = (id) => stressResults.find(({ fixtureId }) => fixtureId === id)

  const floatingPath = generator.createFloatingObjectHwpx(directory, 'han-flow-floating-objects.hwpx')
  const floatingView = await verify(floatingPath, 500)
  pdfResults.push({ fixtureId: 'floating-objects', ...await verifyPdf(floatingPath) })
  const floatingEdits = []
  for (const edit of FLOATING_EDIT_CASES) floatingEdits.push({ id: edit.id, ...await verify(floatingPath, 500, false, edit.environment) })

  const editScopePath = generator.createEditScopeHwpx(directory, 'han-flow-edit-scope.hwpx')
  const editScopeResults = []
  for (const scope of EDIT_SCOPE_CASES) {
    editScopeResults.push({
      target: scope.target,
      ...await verify(editScopePath, 500, false, {
        HAN_FLOW_VERIFY_EDIT_TEXT: scope.text,
        HAN_FLOW_VERIFY_EDIT_TARGET: scope.target,
        HAN_FLOW_VERIFY_EDIT_SAVE: '1'
      })
    })
  }
  const editScope = (target) => editScopeResults.find((result) => result.target === target)
  const longFootnoteEdit = await verify(generator.createLongFootnoteHwpx(directory, 'han-flow-footnote-long-edit.hwpx'), 500, false, {
    HAN_FLOW_VERIFY_EDIT_TEXT: LONG_FOOTNOTE_EDIT_TEXT,
    HAN_FLOW_VERIFY_EDIT_TARGET: 'note',
    HAN_FLOW_VERIFY_EDIT_SAVE: '1'
  })

  const continuation = results.find(({ fixtureId }) => fixtureId === 'cell-continuation')
  const compatibility = results.find(({ fixtureId }) => fixtureId === 'images-rowspan')
  const multiColumn = results.find(({ fixtureId }) => fixtureId === 'multi-column-layout')
  const large = results.find(({ fixtureId }) => fixtureId === 'large-progressive')
  const invalid = results.find(({ fixtureId }) => fixtureId === 'invalid-package')
  const reportToc = results.find(({ fixtureId }) => fixtureId === 'report-toc')
  const hangingIndent = results.find(({ fixtureId }) => fixtureId === 'hanging-indent')
  const failures = [
    ...results.filter(({ passed }) => !passed).map(({ fixtureId }) => `${fixtureId}: verify 실패`),
    crashRecoveryResult.passed ? undefined : `baseline 강제 종료 복구 실패(${crashRecoveryResult.failures.join(', ')})`,
    dirtyDiscardResult.passed ? undefined : `hanging-indent [저장하지 않음] 종료 실패(${dirtyDiscardResult.failures.join(', ')})`,
    ...objectResults.filter(({ passed }) => !passed).map(({ fixtureId, failures: objectFailures }) => `${fixtureId}: 자리 표시 검증 실패(${objectFailures.join(', ')})`),
    ...objectResults.filter(({ recoveredObjectCharacters }) => !(recoveredObjectCharacters > 0)).map(({ fixtureId }) => `${fixtureId}: 수식 script·글상자 글·각주·메모·단추 이름·개체 설명이 화면에 없음`),
    ...objectResults.filter(({ sourceObjectComparison }) => sourceObjectComparison !== 'compared').map(({ fixtureId, sourceObjectComparison }) => `${fixtureId}: 원문 개체 비교 안 함(${sourceObjectComparison})`),
    ...REQUIRED_OBJECT_KINDS
      .filter((kind) => !objectResults.some(({ sourceObjects }) => sourceObjects?.[kind] > 0))
      .map((kind) => `개체 matrix에 ${kind} 원문 fixture가 없음`),
    ...stressResults.filter(({ passed }) => !passed).map(({ fixtureId, failures: stressFailures }) => `${fixtureId}: 쪽 나눔 검증 실패(${stressFailures.join(', ')})`),
    stress('long-objects')?.fittedObjects?.declared >= 2 && stress('long-objects')?.fittedObjects?.body >= 1
      ? undefined
      : `long-objects: 쪽보다 큰 수식·글상자를 줄여 그리지 않음(${JSON.stringify(stress('long-objects')?.fittedObjects)})`,
    stress('footnote-flow')?.totalPages >= 2 && stress('footnote-flow')?.placeholderCounts?.footnote === 40 &&
      stress('footnote-flow')?.footnotePlacement?.anchors === 40 && stress('footnote-flow')?.footnotePlacement?.notes === 40
      ? undefined
      : `footnote-flow: 각주 40개가 번호 표시가 놓인 쪽 아래에 모두 놓이지 않음(${stress('footnote-flow')?.totalPages}쪽, ${JSON.stringify(stress('footnote-flow')?.footnotePlacement)})`,
    stress('footnote-long')?.footnotePlacement?.notes === 5 && stress('footnote-long')?.footnotePlacement?.continuations >= 1
      ? undefined
      : `footnote-long: 한 쪽보다 긴 각주가 다음 쪽으로 이어지지 않음(${JSON.stringify(stress('footnote-long')?.footnotePlacement)})`,
    floatingView.passed ? undefined : `floating-objects: ${floatingView.failures.join(', ')}`,
    ...floatingFailures(floatingView, generator.FLOATING_OBJECT_EXPECTED),
    ...floatingEdits.filter(({ passed }) => !passed).map(({ id, failures: editFailures }) => `floating-objects ${id} 편집: ${editFailures.join(', ')}`),
    ...floatingEdits.flatMap(({ id, positionedObjects }) => floatingFailures({ positionedObjects }, generator.FLOATING_OBJECT_EXPECTED, `floating-objects ${id} 편집`)),
    ...floatingEdits
      .filter(({ positionedObjects, saveAs }) => !sameFloatingObjects(positionedObjects, saveAs?.reopenedPositionedObjects))
      .map(({ id }) => `floating-objects ${id} 편집: 저장본을 다시 열었을 때 개체 자리가 다름`),
    floatingEdits.find(({ id }) => id === 'table-cell')?.editingProbe?.surface === 'table-cell'
      ? undefined
      : 'floating-objects 쪽 위 표 셀 편집 surface가 검증되지 않음',
    longFootnoteEdit.passed ? undefined : `footnote-long 편집: ${longFootnoteEdit.failures.join(', ')}`,
    longFootnoteEdit.saveAs?.reopenedTextPresent ? undefined : 'footnote-long 편집: 저장본에 입력 글자가 없음',
    longFootnoteEdit.editingProbe?.noteKind === 'footnote' ? undefined : `footnote-long 편집: 쪽 아래 각주가 아닌 칸을 고침(${longFootnoteEdit.editingProbe?.noteKind})`,
    longFootnoteEdit.saveAs?.reopenedFootnotePlacement?.notes === 5 && longFootnoteEdit.saveAs.reopenedFootnotePlacement.continuations >= 1
      ? undefined
      : `footnote-long 편집: 저장본의 각주 배치가 다름(${JSON.stringify(longFootnoteEdit.saveAs?.reopenedFootnotePlacement)})`,
    editScope('note')?.footnotePlacement?.anchors === 1 && editScope('note')?.footnotePlacement?.notes === 1
      ? undefined
      : `edit-scope note: 각주가 번호 표시가 놓인 쪽 아래에 없음(${JSON.stringify(editScope('note')?.footnotePlacement)})`,
    ...editScopeResults.filter(({ passed }) => !passed).map(({ target, failures: scopeFailures }) => `edit-scope ${target}: ${scopeFailures.join(', ')}`),
    ...editScopeResults.filter(({ saveAs }) => !saveAs?.reopenedTextPresent).map(({ target }) => `edit-scope ${target}: 저장본에 입력 글자가 없음`),
    editScope('table-caret')?.editingProbe?.anchorTransition?.from?.endsWith(':table-before')
      ? undefined
      : 'edit-scope table-caret: 표 앞 합성 caret에서 새 hp:t로 옮겨 가는 편집이 검증되지 않음',
    editScope('table-caret-after')?.editingProbe?.anchorTransition?.from?.endsWith(':table-after')
      ? undefined
      : 'edit-scope table-caret-after: 표 뒤 합성 caret에서 새 hp:t로 옮겨 가는 편집이 검증되지 않음',
    ...DECORATION_TARGETS.flatMap((target) => [
      editScope(target)?.editingProbe?.decorationInstances >= 2
        ? undefined
        : `edit-scope ${target}: 두 쪽의 입력 칸이 함께 바뀌지 않음(${editScope(target)?.editingProbe?.decorationInstances})`,
      editScope(target)?.saveAs?.reopenedTextPageCount === 2
        ? undefined
        : `edit-scope ${target}: 저장본의 두 쪽 모두에 입력 글자가 있지 않음(${editScope(target)?.saveAs?.reopenedTextPageCount}쪽)`,
      editScope(target)?.editingProbe?.navigationProbe?.passed
        ? undefined
        : `edit-scope ${target}: 칸 끝·처음의 방향 키 검증 실패`
    ]),
    ...['note', 'endnote'].map((target) =>
      editScope(target)?.saveAs?.reopenedPlaceholderCounts?.footnote === 1 && editScope(target)?.saveAs?.reopenedPlaceholderCounts?.endnote === 1
        ? undefined
        : `edit-scope ${target}: 저장본의 각주·미주 번호 표시가 1개씩이 아님`),
    ...longNameResults.filter(({ passed }) => !passed).map(({ scale, failures: longFailures }) => `긴 파일 이름 ${scale}배: ${longFailures.join(', ')}`),
    // 실제로 잘리는지는 글꼴 폭과 창 너비에 따라 다르므로, 한 줄 유지·말줄임 설정·전체 이름 tooltip만 요구한다.
    ...longNameResults
      .filter(({ toolbarLayout }) => {
        const fileName = toolbarLayout?.fileName
        return !fileName?.singleLine || !fileName?.ellipsis || fileName?.title !== `${LONG_KOREAN_FILE_STEM}.hwpx`
      })
      .map(({ scale }) => `긴 파일 이름 ${scale}배: 한 줄 말줄임·tooltip 조건 불충족`),
    ...pdfResults.filter(({ passed }) => !passed).map(({ fixtureId, failures: pdfFailures }) => `${fixtureId}: PDF 검증 실패(${pdfFailures.join(', ')})`),
    reportToc?.totalPages === 3 ? undefined : 'report-toc: 표지·목차·본문 3페이지가 아님',
    hangingIndent?.editingProbe?.anchorTransition?.to?.endsWith('#hp:t:0') ? undefined : 'hanging-indent: 빈 문단 합성 anchor 편집 전환이 검증되지 않음',
    hangingIndent?.outsidePageTextPages?.length === 0 ? undefined : `hanging-indent: 용지 밖으로 나간 글자(${hangingIndent?.outsidePageTextPages?.join(', ')})`,
    hangingIndent?.cellOverflowTexts?.length === 0 ? undefined : `hanging-indent: 표 셀 밖으로 나간 글자(${hangingIndent?.cellOverflowTexts?.join(', ')})`,
    continuation?.totalPages === 2 ? undefined : 'cell-continuation: 2페이지가 아님',
    compatibility?.imageCount === 12 ? undefined : 'images-rowspan: 이미지 12개가 decode되지 않음',
    multiColumn?.totalPages > 0 ? undefined : 'multi-column-layout: 페이지가 생성되지 않음',
    multiColumn?.columnCounts?.length === multiColumn?.totalPages && multiColumn.columnCounts.every((count) => count === 2)
      ? undefined
      : 'multi-column-layout: 각 페이지의 2단 DOM이 생성되지 않음',
    multiColumn?.columnTextCounts?.[0]?.length === 2 && multiColumn.columnTextCounts[0].every((count) => count > 0)
      ? undefined
      : 'multi-column-layout: 첫 페이지 양쪽 단의 본문이 비어 있음',
    large && large.totalPages > 50 ? undefined : 'large-progressive: 50페이지를 넘지 않음',
    large && large.mountedPages < large.totalPages ? undefined : 'large-progressive: page virtualization이 적용되지 않음',
    invalid?.expectedError && invalid.passed ? undefined : 'invalid-package: 오류 안내 검증 실패'
  ].filter(Boolean)
  const summary = {
    passed: failures.length === 0,
    fixtures: results.map(({ fixtureId, name, totalPages, mountedPages, imageCount, overflowPages, columnCounts, columnTextCounts }) => ({
      fixtureId, name, totalPages, mountedPages, imageCount, overflowPages, columnCounts, columnTextCounts
    })),
    objects: objectResults.map(({ fixtureId, passed, totalPages, sourceObjects, placeholderCounts, objectShortfalls, recoveredObjectCharacters, objectNotice }) => ({
      fixtureId, passed, totalPages, sourceObjects, placeholderCounts, objectShortfalls, recoveredObjectCharacters, objectNotice
    })),
    layoutStress: stressResults.map(({ fixtureId, passed, totalPages, overflowPages, placeholderCounts, sourceObjects, fittedObjects, pageTextCounts, footnotePlacement }) => ({
      fixtureId, passed, totalPages, overflowPages, placeholderCounts, sourceObjects, fittedObjects, pageTextCounts, footnotePlacement
    })),
    floatingObjects: {
      passed: floatingView.passed,
      totalPages: floatingView.totalPages,
      positionedObjects: floatingView.positionedObjects,
      edits: floatingEdits.map(({ id, passed, totalPages, saveAs }) => ({ id, passed, totalPages, reopenedPages: saveAs?.reopenedPages }))
    },
    longFootnoteEdit: {
      passed: longFootnoteEdit.passed,
      totalPages: longFootnoteEdit.totalPages,
      noteKind: longFootnoteEdit.editingProbe?.noteKind,
      footnotePlacement: longFootnoteEdit.footnotePlacement,
      reopenedTextPresent: longFootnoteEdit.saveAs?.reopenedTextPresent,
      reopenedFootnotePlacement: longFootnoteEdit.saveAs?.reopenedFootnotePlacement
    },
    editScope: editScopeResults.map(({ target, passed, totalPages, editingProbe, saveAs }) => ({
      target,
      passed,
      totalPages,
      anchorTransition: editingProbe?.anchorTransition,
      decorationInstances: editingProbe?.decorationInstances,
      navigation: editingProbe?.navigationProbe,
      noteKind: editingProbe?.noteKind,
      reopenedTextPresent: saveAs?.reopenedTextPresent,
      reopenedTextPageCount: saveAs?.reopenedTextPageCount,
      reopenedPlaceholderCounts: saveAs?.reopenedPlaceholderCounts
    })),
    crashRecovery: { passed: crashRecoveryResult.passed, ...crashRecoveryResult.crashRecovery },
    dirtyDiscard: { passed: dirtyDiscardResult.passed, journalsAfterQuit: dirtyDiscardResult.journalsAfterQuit, ...dirtyDiscardResult.dirtyClose },
    longFileName: longNameResults.map(({ scale, passed, toolbarLayout }) => ({ scale, passed, toolbarLayout })),
    pdf: pdfResults.map(({ fixtureId, passed, screenPageTextCounts, pageTextCounts, pdfTitle }) => ({
      fixtureId, passed, screenPageTextCounts, pdfPageTextCounts: pageTextCounts, pdfTitle
    })),
    failures
  }
  console.log('HAN_FLOW_PUBLIC_MATRIX', JSON.stringify(summary))
  if (failures.length) process.exitCode = 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
