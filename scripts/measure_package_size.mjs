import { lstat, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const baselineApp = resolve(process.argv[2] ?? '')
const currentApp = resolve(process.argv[3] ?? 'release/mac-arm64/Han-Flow.app')
const baselineLabel = process.env.HAN_FLOW_PACKAGE_BASELINE_LABEL ?? basename(baselineApp)

if (!baselineApp.endsWith('.app')) {
  console.error('사용법: npm run measure:package -- <baseline.app> [current.app]')
  process.exit(1)
}

async function logicalBytes(path) {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink()) return 0
  if (metadata.isFile()) return metadata.size
  if (!metadata.isDirectory()) return 0
  const entries = await readdir(path)
  const sizes = await Promise.all(entries.map((entry) => logicalBytes(join(path, entry))))
  return sizes.reduce((sum, size) => sum + size, 0)
}

async function packageStats(appPath) {
  const asarPath = join(appPath, 'Contents/Resources/app.asar')
  return {
    appLogicalBytes: await logicalBytes(appPath),
    asarBytes: (await stat(asarPath)).size,
    asarPath
  }
}

function delta(current, baseline) {
  return {
    bytes: current - baseline,
    mebibytes: Number(((current - baseline) / 1024 / 1024).toFixed(2)),
    percent: Number((((current - baseline) / baseline) * 100).toFixed(2))
  }
}

function optionalAsarFileSize(asarPath, path) {
  try {
    return asar.statFile(asarPath, path).size
  } catch {
    return 0
  }
}

const baseline = await packageStats(baselineApp)
const current = await packageStats(currentApp)
const bundledWasmPath = asar.listPackage(current.asarPath)
  .find((path) => /^\/out\/renderer\/assets\/rhwp_bg-[^/]+\.wasm$/u.test(path))
  ?.slice(1)
const bundledWasm = bundledWasmPath ? optionalAsarFileSize(current.asarPath, bundledWasmPath) : 0
const dependencyWasm = optionalAsarFileSize(current.asarPath, 'node_modules/@rhwp/core/rhwp_bg.wasm')
const result = {
  baseline: {
    label: baselineLabel,
    appLogicalBytes: baseline.appLogicalBytes,
    asarBytes: baseline.asarBytes
  },
  current: {
    label: basename(currentApp),
    appLogicalBytes: current.appLogicalBytes,
    asarBytes: current.asarBytes
  },
  delta: {
    app: delta(current.appLogicalBytes, baseline.appLogicalBytes),
    asar: delta(current.asarBytes, baseline.asarBytes)
  },
  rhwpWasm: {
    bundledBytes: bundledWasm,
    dependencyBytes: dependencyWasm,
    duplicated: bundledWasm > 0 && bundledWasm === dependencyWasm
  }
}
console.log('HAN_FLOW_PACKAGE_SIZE', JSON.stringify(result))
