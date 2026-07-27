import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as CFB from 'cfb'

const root = resolve(import.meta.dirname, '..')
const fixture = resolve(root, 'tests/fixtures/public/synthetic-layout.hwp')
const manifestPath = `${fixture}.json`
const electron = resolve(root, 'node_modules/.bin/electron')
const activeChildren = new Set()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    for (const child of activeChildren) child.kill('SIGTERM')
    process.exitCode = 130
  })
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function payloadFrom(stdout, prefix) {
  const line = stdout.split('\n').findLast((value) => value.startsWith(prefix))
  if (!line) throw new Error(`${prefix.trim()} 결과가 없습니다.`)
  return JSON.parse(line.slice(prefix.length))
}

function run(command, arguments_, { env, prefix, timeoutMs = 90_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      env: { ...process.env, ...env, ELECTRON_ENABLE_LOGGING: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    activeChildren.add(child)
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      activeChildren.delete(child)
      if (error) reject(error)
      else {
        try {
          resolvePromise(prefix ? payloadFrom(stdout, prefix) : stdout)
        } catch (parseError) {
          reject(parseError)
        }
      }
    }
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error(`검증 시간이 초과되었습니다: ${command} ${arguments_.join(' ')}`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('error', finish)
    child.once('exit', (code) => {
      if (code === 0) finish()
      else finish(new Error(
        `검증 명령이 종료 코드 ${code}로 실패했습니다: ${stderr.trim() || stdout.trim()}`
      ))
    })
  })
}

function check(condition, message, failures) {
  if (!condition) failures.push(message)
}

async function createHeaderVariant(bytes, output, mutate) {
  const container = CFB.read(bytes, { type: 'buffer' })
  const fileHeader = CFB.find(container, 'FileHeader')
  if (!fileHeader?.content || fileHeader.content.length < 40) {
    throw new Error('공개 HWP fixture의 FileHeader를 찾을 수 없습니다.')
  }
  mutate(fileHeader.content)
  await writeFile(output, CFB.write(container, { type: 'buffer' }))
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'han-flow-hwp-matrix-'))
try {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const fixedBytes = await readFile(fixture)
  const generatedFixture = join(temporaryDirectory, 'synthetic-layout.hwp')
  const unsupportedFixtures = [
    {
      name: 'encrypted',
      code: 'HWP_ENCRYPTED',
      path: join(temporaryDirectory, 'encrypted.hwp'),
      mutate: (header) => header.writeUInt32LE(header.readUInt32LE(36) | (1 << 1), 36)
    },
    {
      name: 'distribution',
      code: 'HWP_DISTRIBUTION',
      path: join(temporaryDirectory, 'distribution.hwp'),
      mutate: (header) => header.writeUInt32LE(header.readUInt32LE(36) | (1 << 2), 36)
    },
    {
      name: 'drm',
      code: 'HWP_DRM',
      path: join(temporaryDirectory, 'drm.hwp'),
      mutate: (header) => header.writeUInt32LE(header.readUInt32LE(36) | (1 << 4), 36)
    },
    {
      name: 'unsupported-version',
      code: 'HWP_UNSUPPORTED_VERSION',
      path: join(temporaryDirectory, 'unsupported-version.hwp'),
      mutate: (header) => header.set([0, 0, 0, 4], 32)
    }
  ]

  await run(electron, [
    resolve(root, 'scripts/fixtures/generate_public_hwp_main.cjs'),
    generatedFixture
  ], { prefix: 'HAN_FLOW_PUBLIC_HWP_GENERATED ' })
  for (const fixtureCase of unsupportedFixtures) {
    await createHeaderVariant(fixedBytes, fixtureCase.path, fixtureCase.mutate)
  }
  const corruptedFixture = {
    name: 'corrupted',
    code: 'HWP_CORRUPTED',
    path: join(temporaryDirectory, 'corrupted.hwp')
  }
  await writeFile(corruptedFixture.path, fixedBytes.subarray(0, 32))
  unsupportedFixtures.push(corruptedFixture)

  const [generatedBytes, bakeoff, app, pdf] = await Promise.all([
    readFile(generatedFixture),
    run(process.execPath, [
      resolve(root, 'scripts/probes/compare_hwp_probes.mjs'),
      fixture
    ], { prefix: 'HAN_FLOW_HWP_BAKEOFF ' }),
    run(process.execPath, [
      resolve(root, 'scripts/verify_app.mjs'),
      fixture
    ], {
      env: { HAN_FLOW_VERIFY_SEARCH_QUERY: 'HANFLOW-PUBLIC-HEADER' },
      prefix: 'HAN_FLOW_APP_VERIFY '
    }),
    run(process.execPath, [
      resolve(root, 'scripts/verify_pdf.mjs'),
      fixture
    ], { prefix: 'HAN_FLOW_PDF_VERIFY ', timeoutMs: 120_000 })
  ])
  const unsupportedResults = []
  for (const fixtureCase of unsupportedFixtures) {
    unsupportedResults.push(await run(process.execPath, [
      resolve(root, 'scripts/verify_app.mjs'),
      fixtureCase.path,
      '--expect-error'
    ], {
      env: { HAN_FLOW_VERIFY_ERROR_CODE: fixtureCase.code },
      prefix: 'HAN_FLOW_APP_VERIFY '
    }))
  }

  const expected = manifest.expected
  const observations = bakeoff.observations
  const failures = []
  check(sha256(fixedBytes) === manifest.sha256, '고정 fixture SHA-256 불일치', failures)
  check(fixedBytes.length === manifest.sizeBytes, '고정 fixture 크기 불일치', failures)
  check(sha256(generatedBytes) === manifest.sha256, '생성 결과가 고정 fixture와 다름', failures)
  check(bakeoff.completed === true, '두 HWP probe 중 하나가 실패함', failures)
  check(
    bakeoff.results.every((result) => result.container?.version === manifest.hwpVersion),
    'HWP FileHeader version 불일치',
    failures
  )
  check(
    bakeoff.results.every((result) =>
      Object.values(result.container?.flags ?? {}).every((enabled) => enabled === false)
    ),
    '공개 fixture에 예상하지 않은 FileHeader flag가 설정됨',
    failures
  )
  check(observations.kordocAdapterSections === expected.sections, 'section 수 불일치', failures)
  check(observations.kordocAdapterTables === expected.tables, '표 수 불일치', failures)
  check(observations.kordocAdapterCells === expected.cells, '표 셀 수 불일치', failures)
  check(observations.kordocAdapterImages === expected.images, '이미지 수 불일치', failures)
  check(observations.kordocAdapterResources === expected.resources, '이미지 resource 수 불일치', failures)
  check(observations.rhwpPageCount === expected.pages, 'rhwp 페이지 수 불일치', failures)
  check(observations.rhwpImageElements === expected.images, 'SVG 이미지 수 불일치', failures)
  check(
    bakeoff.results.find((result) => result.engine === 'rhwp')?.result?.unsafeElements === 0,
    '렌더 SVG에 허용하지 않은 요소가 있음',
    failures
  )
  check(app.passed === true, '패키지 앱 smoke 검증 실패', failures)
  check(app.totalPages === expected.pages, '패키지 앱 페이지 수 불일치', failures)
  check(app.search?.pages === expected.headerSearchPages, '머리말 검색 페이지 수 불일치', failures)
  check(
    app.search?.occurrences === expected.headerSearchOccurrences,
    '반복 머리말 검색 횟수 불일치',
    failures
  )
  check(pdf.passed === true, 'PDF 내보내기 검증 실패', failures)
  check(pdf.pdfPages === expected.pages, 'PDF 페이지 수 불일치', failures)
  check(
    pdf.textPreservation >= expected.minimumPdfTextPreservation,
    'PDF 텍스트 보존율 미달',
    failures
  )
  unsupportedResults.forEach((result, index) => {
    const fixtureCase = unsupportedFixtures[index]
    check(
      result.passed === true && result.errorCode === fixtureCase.code,
      `${fixtureCase.name} 오류 UX 검증 실패`,
      failures
    )
  })

  const result = {
    fixture: manifest.fixture,
    passed: failures.length === 0,
    deterministic: sha256(generatedBytes) === manifest.sha256,
    hwpVersion: manifest.hwpVersion,
    pages: observations.rhwpPageCount,
    tables: observations.kordocAdapterTables,
    cells: observations.kordocAdapterCells,
    images: observations.kordocAdapterImages,
    repeatedHeaderOccurrences: app.search?.occurrences ?? 0,
    pdfPages: pdf.pdfPages,
    pdfTextPreservation: pdf.textPreservation,
    unsupportedCases: unsupportedResults.map((result) => result.errorCode),
    failures
  }
  console.log('HAN_FLOW_HWP_MATRIX', JSON.stringify(result))
  if (failures.length) process.exitCode = 1
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
