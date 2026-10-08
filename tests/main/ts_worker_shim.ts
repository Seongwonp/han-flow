import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import * as ts from 'typescript'

const sourceRoot = resolve(__dirname, '../../src')
const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true
}

let transpiled: Record<string, string> | undefined

function collect(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) collect(path, files)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(path)
  }
  return files
}

/** worker가 require할 수 있는 `src/core`·`src/main` TypeScript를 한 번만 변환해 둔다(worker마다 typescript를 띄우지 않게). */
function transpiledSources(): Record<string, string> {
  if (transpiled) return transpiled
  transpiled = {}
  for (const file of [...collect(join(sourceRoot, 'core')), ...collect(join(sourceRoot, 'main'))]) {
    transpiled[file] = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions
    }).outputText
  }
  return transpiled
}

/**
 * Jest에서 `src/main`의 실제 worker entry(TypeScript)를 worker thread로 실행하는 CommonJS shim을 만든다.
 * worker에는 ts-jest transform이 없으므로 미리 변환한 출력으로 `.ts` require를 처리한다.
 * `preamble`은 entry를 불러오기 전에 실행할 테스트 전용 코드다(예: 특정 command를 멈추게 하는 monkeypatch).
 * preamble 안에서는 `requireSource('core/editing/history')`로 같은 module instance를 얻는다.
 */
export function writeTsWorkerShim(
  directory: string,
  entry: string,
  options: { name?: string; preamble?: string } = {}
): string {
  const cachePath = join(directory, 'ts-worker-transpiled.json')
  writeFileSync(cachePath, JSON.stringify(transpiledSources()))
  const path = join(directory, `${options.name ?? 'ts-worker-shim'}.js`)
  writeFileSync(path, `const { readFileSync } = require('fs')
const { join } = require('path')
const transpiled = JSON.parse(readFileSync(${JSON.stringify(cachePath)}, 'utf8'))
let ts
require.extensions['.ts'] = (module, filename) => {
  let output = transpiled[filename]
  if (output === undefined) {
    ts ??= require(${JSON.stringify(require.resolve('typescript'))})
    output = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText
  }
  module._compile(output, filename)
}
const requireSource = (path) => require(join(${JSON.stringify(sourceRoot)}, path + '.ts'))
${options.preamble ?? ''}
require(${JSON.stringify(resolve(sourceRoot, entry))})
`)
  return path
}

/** 실제 `src/main/editing_worker.ts`를 실행하는 shim. */
export function writeEditingWorkerShim(directory: string, options: { name?: string; preamble?: string } = {}): string {
  return writeTsWorkerShim(directory, 'main/editing_worker.ts', {
    name: options.name ?? 'editing-worker-shim',
    preamble: options.preamble
  })
}
