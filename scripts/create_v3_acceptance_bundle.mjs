import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const AdmZip = require('adm-zip')
const generatorPath = resolve('tests/fixtures/public/create_synthetic_hwpx.ts')
const outputDirectory = resolve(process.argv[2] ?? 'artifacts/v3-acceptance')
const appBinary = resolve('release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

function registerTypeScriptLoader() {
  require.extensions['.ts'] = (module, fileName) => {
    const source = require('node:fs').readFileSync(fileName, 'utf8')
    const javascript = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true
      },
      fileName
    }).outputText
    module._compile(javascript, fileName)
  }
}

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

async function createEditedFixture(originalPath, editedPath, options = {}) {
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
          HAN_FLOW_VERIFY_EDIT_TEXT: options.editText ?? '공개편집검증',
          HAN_FLOW_VERIFY_EDIT_MODE: options.editMode ?? 'range',
          ...(options.editCell ? { HAN_FLOW_VERIFY_EDIT_CELL: '1' } : {}),
          ...(options.styleProbe === false ? {} : { HAN_FLOW_VERIFY_STYLE: '1' }),
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

async function createIdentityFixture(originalPath, identityPath) {
  registerTypeScriptLoader()
  const { HwpxSourcePackage } = require(resolve('src/core/parser/source_package.ts'))
  const { saveHwpxAs } = require(resolve('src/core/editing/save_as.ts'))
  const sourcePackage = await HwpxSourcePackage.open(originalPath)
  const result = await saveHwpxAs(sourcePackage, identityPath)
  return {
    entryCount: result.entryCount,
    revision: result.revision,
    entryIdentityVerified: true
  }
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
const identityPath = join(outputDirectory, 'han-flow-v3-identity.hwpx')
const cellEditedPath = join(outputDirectory, 'han-flow-v3-cell-edited.hwpx')
const identity = await createIdentityFixture(originalPath, identityPath)
const verification = await createEditedFixture(originalPath, editedPath)
const cellVerification = await createEditedFixture(originalPath, cellEditedPath, {
  editText: '공개셀검증',
  editMode: 'range',
  editCell: true,
  styleProbe: false
})
const originalSha256 = await sha256(originalPath)
const identitySha256 = await sha256(identityPath)
const manifest = {
  generatedAt: new Date().toISOString(),
  commit,
  source: 'tests/fixtures/public/create_synthetic_hwpx.ts',
  files: {
    original: {
      name: 'han-flow-v3-original.hwpx',
      sha256: originalSha256
    },
    identity: {
      name: 'han-flow-v3-identity.hwpx',
      sha256: identitySha256,
      sourceSha256: originalSha256,
      containerSha256Equal: identitySha256 === originalSha256,
      ...identity
    },
    edited: {
      name: 'han-flow-v3-edited.hwpx',
      sha256: await sha256(editedPath)
    },
    cellEdited: {
      name: 'han-flow-v3-cell-edited.hwpx',
      sha256: await sha256(cellEditedPath)
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
    styleProbe: verification.editingProbe?.styleProbe,
    cellEdit: {
      passed: cellVerification.passed,
      surface: cellVerification.editingProbe?.surface,
      originalUnchanged: cellVerification.saveAs?.sourceUnchanged,
      savedFileExists: cellVerification.saveAs?.savedFileExists,
      reopenedPages: cellVerification.saveAs?.reopenedPages,
      reopenedImages: cellVerification.saveAs?.reopenedImages,
      reopenedOverflowPages: cellVerification.saveAs?.reopenedOverflowPages
    }
  }
}
await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(
  join(outputDirectory, 'WINDOWS_CHECKLIST.txt'),
  [
    'Han-Flow V3 Windows 한/글 재열기',
    '',
    '사전 기록: Windows 버전 / 한/글 제품명과 버전 / Han-Flow commit',
    '',
    '1. original과 identity를 각각 열어 복구 경고가 없고 본문·표·이미지가 같은지 확인합니다.',
    '2. edited에서 공개편집검증 문자열과 굵게·기울임·밑줄·취소선·11pt·색상을 확인합니다.',
    '3. edited에서 가운데 정렬, 줄 간격 170%, 문단 앞뒤 1pt, 첫 줄 들여쓰기 1pt를 확인합니다.',
    '4. cell-edited에서 공개셀검증 문자열과 표 구조·병합·테두리 보존을 확인합니다.',
    '5. a4-editing에서 A4 세로 용지, 사방 20mm 여백과 본문 폭을 확인합니다.',
    '6. 각 파일을 닫았다 다시 열어도 결과가 같고 복구 저장 요구가 없는지 확인합니다.',
    '7. 결과를 docs/v3_windows_round_trip_matrix.md의 WIN-01~WIN-08에 기록합니다.',
    ''
  ].join('\n')
)
await writeFile(
  join(outputDirectory, 'WINDOWS_RESULT_TEMPLATE.md'),
  [
    '# Han-Flow V3 Windows 한/글 재열기 결과',
    '',
    '- 실행 날짜:',
    `- Han-Flow commit: ${commit}`,
    '- Windows 버전:',
    '- 한/글 제품명·버전:',
    '',
    '| ID | 결과(통과/실패/해당 없음) | 비식별 메모 |',
    '| --- | --- | --- |',
    ...Array.from({ length: 8 }, (_, index) => `| WIN-${String(index + 1).padStart(2, '0')} |  |  |`),
    '',
    '실패 캡처에는 사용자 계정명·경로·개인 문서를 포함하지 않습니다.',
    ''
  ].join('\n')
)
await writeFile(
  join(outputDirectory, 'VERIFY_WINDOWS.ps1'),
  [
    '$ErrorActionPreference = "Stop"',
    '$root = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json',
    '$failed = $false',
    'foreach ($item in $manifest.files.PSObject.Properties) {',
    '  $path = Join-Path $root $item.Value.name',
    '  if (-not (Test-Path $path)) { Write-Host "[FAIL] missing $($item.Value.name)" -ForegroundColor Red; $failed = $true; continue }',
    '  $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()',
    '  if ($actual -eq $item.Value.sha256) { Write-Host "[PASS] $($item.Value.name)" -ForegroundColor Green }',
    '  else { Write-Host "[FAIL] hash $($item.Value.name)" -ForegroundColor Red; $failed = $true }',
    '}',
    'if ($failed) { exit 1 }',
    'Write-Host "Bundle integrity verified for commit $($manifest.commit)" -ForegroundColor Cyan',
    ''
  ].join('\r\n')
)
const publicFiles = await readdir(outputDirectory)
for (const fileName of publicFiles) await chmod(join(outputDirectory, fileName), 0o644)
const archivePath = join(outputDirectory, 'han-flow-v3-windows-bundle.zip')
const archive = new AdmZip()
for (const fileName of publicFiles) archive.addLocalFile(join(outputDirectory, fileName))
archive.writeZip(archivePath)
await chmod(archivePath, 0o644)
console.log('HAN_FLOW_V3_ACCEPTANCE_BUNDLE', JSON.stringify({
  outputDirectory,
  archive: { name: 'han-flow-v3-windows-bundle.zip', sha256: await sha256(archivePath) },
  ...manifest
}))
