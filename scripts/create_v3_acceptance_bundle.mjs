import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const generatorPath = resolve('tests/fixtures/public/create_synthetic_hwpx.ts')
const outputDirectory = resolve(process.argv[2] ?? 'artifacts/v3-acceptance')
const appBinary = resolve('release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow')

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

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

async function createEditedFixture(originalPath, editedPath) {
  let standardOutput = ''
  let standardError = ''
  await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [resolve('scripts/verify_app.mjs'), originalPath, appBinary],
      {
        env: {
          ...process.env,
          HAN_FLOW_VERIFY_DELAY_MS: '500',
          HAN_FLOW_VERIFY_EDIT_TEXT: '공개편집검증',
          HAN_FLOW_VERIFY_EDIT_MODE: 'range',
          HAN_FLOW_VERIFY_STYLE: '1',
          HAN_FLOW_VERIFY_EDIT_SAVE: '1',
          HAN_FLOW_VERIFY_SAVE_DESTINATION: editedPath
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    child.stdout.on('data', (chunk) => { standardOutput += chunk.toString() })
    child.stderr.on('data', (chunk) => { standardError += chunk.toString() })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`V3 승인 fixture 생성 실패(${code}): ${standardError.trim() || standardOutput.trim()}`))
    })
  })
  const resultLine = standardOutput.split('\n').find((line) => line.startsWith('HAN_FLOW_APP_VERIFY '))
  if (!resultLine) throw new Error(`V3 승인 fixture 검증 결과를 찾지 못했습니다. ${standardError.trim()}`)
  return JSON.parse(resultLine.slice('HAN_FLOW_APP_VERIFY '.length))
}

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })
const originalPath = loadGenerator().createSyntheticHwpx(outputDirectory, {
  fileName: 'han-flow-v3-original.hwpx',
  firstSectionExtraParagraphs: 1,
  firstSectionPageHeight: 14000
})
const a4EditingPath = loadGenerator().createSyntheticHwpx(outputDirectory, {
  fileName: 'han-flow-v3-a4-editing.hwpx',
  firstSectionExtraParagraphs: 8,
  firstSectionPageWidth: 59528,
  firstSectionPageHeight: 84189,
  firstSectionMargin: 5669,
  firstSectionTableWidth: 48190
})
const editedPath = join(outputDirectory, 'han-flow-v3-edited.hwpx')
const verification = await createEditedFixture(originalPath, editedPath)
const manifest = {
  generatedAt: new Date().toISOString(),
  source: 'tests/fixtures/public/create_synthetic_hwpx.ts',
  files: {
    original: {
      name: 'han-flow-v3-original.hwpx',
      sha256: await sha256(originalPath)
    },
    edited: {
      name: 'han-flow-v3-edited.hwpx',
      sha256: await sha256(editedPath)
    },
    a4Editing: {
      name: 'han-flow-v3-a4-editing.hwpx',
      sha256: await sha256(a4EditingPath),
      pageSize: 'A4 portrait',
      dimensionsHwpUnit: { width: 59528, height: 84189 },
      marginHwpUnit: 5669
    }
  },
  verification: {
    passed: verification.passed,
    originalUnchanged: verification.saveAs?.sourceUnchanged,
    savedFileExists: verification.saveAs?.savedFileExists,
    reopenedPages: verification.saveAs?.reopenedPages,
    reopenedImages: verification.saveAs?.reopenedImages,
    reopenedOverflowPages: verification.saveAs?.reopenedOverflowPages,
    styleProbe: verification.editingProbe?.styleProbe
  }
}
await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(
  join(outputDirectory, 'WINDOWS_CHECKLIST.txt'),
  [
    'Han-Flow V3 Windows 한/글 재열기',
    '',
    '1. han-flow-v3-original.hwpx를 열어 복구 경고 없이 본문·표·이미지가 보이는지 확인합니다.',
    '2. han-flow-v3-edited.hwpx를 열어 공개편집검증 문자열과 부분 굵게·크기·색상·가운데 정렬을 확인합니다.',
    '3. han-flow-v3-a4-editing.hwpx를 열어 A4 세로 용지와 20mm 여백, 본문 폭을 확인합니다.',
    '4. 표 구조, 이미지와 나머지 본문이 유지되는지 확인합니다.',
    '5. 결과를 docs/v3_windows_round_trip_matrix.md의 WIN-01~WIN-06에 기록합니다.',
    ''
  ].join('\n')
)
console.log('HAN_FLOW_V3_ACCEPTANCE_BUNDLE', JSON.stringify({ outputDirectory, ...manifest }))
