import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const appPath = resolve(process.argv[2] ?? 'release/mac-arm64/Han-Flow.app')
const resources = resolve(appPath, 'Contents/Resources/licenses')
const notices = [
  {
    name: 'Han-Flow-Apache-2.0',
    source: resolve('LICENSE'),
    packaged: resolve(resources, 'Han-Flow-Apache-2.0.txt')
  },
  {
    name: 'rhwp-MIT',
    source: resolve('node_modules/@rhwp/core/LICENSE'),
    packaged: resolve(resources, 'rhwp-MIT.txt')
  },
  {
    name: 'third-party-notices',
    source: resolve('THIRD_PARTY_NOTICES.md'),
    packaged: resolve(resources, 'THIRD_PARTY_NOTICES.md')
  }
]

const verified = []
for (const notice of notices) {
  const [source, packaged] = await Promise.all([
    readFile(notice.source),
    readFile(notice.packaged)
  ])
  if (!source.equals(packaged)) {
    throw new Error(`${notice.name} 고지가 source와 production package에서 일치하지 않습니다.`)
  }
  verified.push({ name: notice.name, bytes: packaged.length })
}

console.log('HAN_FLOW_PACKAGE_NOTICES', JSON.stringify({
  passed: true,
  notices: verified
}))
