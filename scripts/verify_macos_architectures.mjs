import { readdirSync, statSync } from 'node:fs'
import { relative, resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const defaults = {
  arm64: 'release/mac-arm64/Han-Flow.app',
  x64: 'release/mac/Han-Flow.app',
  universal: 'release/mac-universal/Han-Flow.app'
}
const requiredArchitectures = {
  arm64: ['arm64'],
  x64: ['x86_64'],
  universal: ['arm64', 'x86_64']
}

function files(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files(path, output)
    else if (entry.isFile()) output.push(path)
  }
  return output
}

function architectures(path) {
  const result = spawnSync('lipo', ['-archs', path], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim().split(/\s+/).filter(Boolean).sort() : []
}

function bytes(directory) {
  return files(directory).reduce((sum, path) => sum + statSync(path).size, 0)
}

const requested = process.argv.slice(2)
const targets = requested.length > 0
  ? requested.map((argument) => {
      const separator = argument.indexOf('=')
      if (separator < 1) throw new Error(`대상 형식은 <arm64|x64|universal>=<app path>입니다: ${argument}`)
      return [argument.slice(0, separator), resolve(argument.slice(separator + 1))]
    })
  : Object.entries(defaults).map(([label, path]) => [label, resolve(path)])

const reports = targets.map(([label, appPath]) => {
  const required = requiredArchitectures[label]
  if (!required) throw new Error(`지원하지 않는 architecture label입니다: ${label}`)
  const machO = files(appPath)
    .map((path) => ({ path: relative(appPath, path), architectures: architectures(path) }))
    .filter((entry) => entry.architectures.length > 0)
  const missingRequired = machO.filter((entry) =>
    required.some((architecture) => !entry.architectures.includes(architecture)))
  const architectureSets = Object.entries(machO.reduce((counts, entry) => {
    const key = entry.architectures.join('+')
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})).sort(([left], [right]) => left.localeCompare(right))
  return {
    label,
    appPath,
    sizeBytes: bytes(appPath),
    machOFiles: machO.length,
    architectureSets: Object.fromEntries(architectureSets),
    passed: machO.length > 0 && missingRequired.length === 0,
    missingRequired
  }
})

const passed = reports.every((report) => report.passed)
console.log('HAN_FLOW_MACOS_ARCHITECTURE_VERIFY', JSON.stringify({ passed, reports }, null, 2))
if (!passed) process.exit(1)
