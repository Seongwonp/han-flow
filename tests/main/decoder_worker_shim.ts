import { writeFileSync } from 'fs'
import { join, resolve } from 'path'

const decoderWorkerSource = resolve(__dirname, '../../src/main/decoder_worker.ts')

/**
 * Jest에서 실제 `src/main/decoder_worker.ts`를 worker thread로 실행하기 위한 CommonJS shim을 만든다.
 * worker에는 ts-jest transform이 없으므로 TypeScript의 transpileModule로 `.ts` require를 처리한다.
 */
export function writeDecoderWorkerShim(directory: string): string {
  const path = join(directory, 'decoder-worker-shim.js')
  writeFileSync(path, `const { readFileSync } = require('fs')
const ts = require(${JSON.stringify(require.resolve('typescript'))})
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
  module._compile(output, filename)
}
require(${JSON.stringify(decoderWorkerSource)})
`)
  return path
}
