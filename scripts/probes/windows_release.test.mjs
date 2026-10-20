import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import releaseConfig from '../build/windows_release_config.cjs'
import {
  commonNameOf,
  embeddedSignature,
  parseOsslsigncodeVerify,
  parsePeHeaders,
  parsePowerShellSignature,
  parseVersionInfo
} from '../windows_authenticode.mjs'

const root = resolve(import.meta.dirname, '../..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

// ---- 합성 PE: VS_VERSIONINFO 리소스와 선택적 인증서 표 ----

function align4(buffer) {
  const padding = (4 - (buffer.length % 4)) % 4
  return padding === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(padding)])
}

function versionBlock(key, value, type, children = []) {
  const keyBytes = Buffer.from(`${key}\0`, 'utf16le')
  const valueBytes = value === null ? Buffer.alloc(0) : type === 1 ? Buffer.from(`${value}\0`, 'utf16le') : value
  const valueLength = value === null ? 0 : type === 1 ? valueBytes.length / 2 : valueBytes.length
  const header = Buffer.alloc(6)
  let body = align4(Buffer.concat([header, keyBytes]))
  body = align4(Buffer.concat([body, valueBytes]))
  for (const child of children) body = align4(Buffer.concat([body, child]))
  header.writeUInt16LE(body.length, 0)
  header.writeUInt16LE(valueLength, 2)
  header.writeUInt16LE(type, 4)
  header.copy(body, 0)
  return body
}

function versionResource({ fileVersion = [1, 0, 0, 1], productVersion = [1, 0, 0, 0], strings }) {
  const fixed = Buffer.alloc(52)
  fixed.writeUInt32LE(0xfeef04bd, 0)
  fixed.writeUInt32LE(0x00010000, 4)
  fixed.writeUInt32LE((fileVersion[0] << 16) | fileVersion[1], 8)
  fixed.writeUInt32LE((fileVersion[2] << 16) | fileVersion[3], 12)
  fixed.writeUInt32LE((productVersion[0] << 16) | productVersion[1], 16)
  fixed.writeUInt32LE((productVersion[2] << 16) | productVersion[3], 20)
  const entries = Object.entries(strings).map(([key, value]) => versionBlock(key, value, 1))
  const table = versionBlock('041204b0', null, 1, entries)
  const stringFileInfo = versionBlock('StringFileInfo', null, 1, [table])
  const translation = Buffer.from([0x12, 0x04, 0xb0, 0x04])
  const varFileInfo = versionBlock('VarFileInfo', null, 1, [versionBlock('Translation', translation, 0)])
  return versionBlock('VS_VERSION_INFO', fixed, 0, [stringFileInfo, varFileInfo])
}

function syntheticPe({ pe32Plus = false, machine = 0x014c, resource, certificate = null }) {
  const peOffset = 0x80
  const optionalHeaderSize = pe32Plus ? 240 : 224
  const sectionTable = peOffset + 24 + optionalHeaderSize
  const resourceOffset = 0x400
  // .rsrc 앞에 리소스 directory가 있는 것처럼 빈 공간을 두어 VS_VERSIONINFO가 section 처음이 아니게 한다.
  const resourceData = Buffer.concat([Buffer.alloc(0x40), resource])
  const resourceSize = Math.ceil(resourceData.length / 0x200) * 0x200
  const certificateOffset = resourceOffset + resourceSize
  const total = certificateOffset + (certificate?.length ?? 0)
  const buffer = Buffer.alloc(total)
  buffer.writeUInt16LE(0x5a4d, 0)
  buffer.writeUInt32LE(peOffset, 0x3c)
  buffer.writeUInt32LE(0x00004550, peOffset)
  buffer.writeUInt16LE(machine, peOffset + 4)
  buffer.writeUInt16LE(1, peOffset + 6)
  buffer.writeUInt16LE(optionalHeaderSize, peOffset + 20)
  const optional = peOffset + 24
  buffer.writeUInt16LE(pe32Plus ? 0x20b : 0x10b, optional)
  const rvaCount = optional + (pe32Plus ? 108 : 92)
  buffer.writeUInt32LE(16, rvaCount)
  if (certificate) {
    buffer.writeUInt32LE(certificateOffset, rvaCount + 4 + 4 * 8)
    buffer.writeUInt32LE(certificate.length, rvaCount + 4 + 4 * 8 + 4)
    certificate.copy(buffer, certificateOffset)
  }
  Buffer.from('.rsrc\0\0\0', 'latin1').copy(buffer, sectionTable)
  buffer.writeUInt32LE(resourceData.length, sectionTable + 8)
  buffer.writeUInt32LE(0x1000, sectionTable + 12)
  buffer.writeUInt32LE(resourceSize, sectionTable + 16)
  buffer.writeUInt32LE(resourceOffset, sectionTable + 20)
  resourceData.copy(buffer, resourceOffset)
  return buffer
}

function winCertificate(type = 0x0002, payloadLength = 24) {
  const entry = Buffer.alloc(8 + payloadLength)
  entry.writeUInt32LE(entry.length, 0)
  entry.writeUInt16LE(0x0200, 4)
  entry.writeUInt16LE(type, 6)
  return entry
}

const nsisStrings = {
  ProductName: 'Han-Flow',
  ProductVersion: '1.0.0-rc.1',
  LegalCopyright: 'Copyright © 2026 Seongwon Park',
  FileDescription: 'Windows와 macOS용 HWP/HWPX 뷰어',
  FileVersion: '1.0.0.1',
  CompanyName: 'Seongwon Park'
}

test('NSIS 설치본(PE32 x86)의 버전 리소스와 인증서 표 유무를 읽는다', () => {
  const unsigned = syntheticPe({ resource: versionResource({ strings: nsisStrings }) })
  const headers = parsePeHeaders(unsigned)
  assert.equal(headers.isPE, true)
  assert.equal(headers.format, 'PE32')
  assert.equal(headers.machine, 'x86')
  assert.deepEqual(embeddedSignature(unsigned), { present: false, reason: '인증서 표 없음' })
  const info = parseVersionInfo(unsigned)
  assert.equal(info.fixedFileVersion, '1.0.0.1')
  assert.equal(info.fixedProductVersion, '1.0.0.0')
  assert.deepEqual(info.strings, nsisStrings)

  const signed = syntheticPe({ resource: versionResource({ strings: nsisStrings }), certificate: winCertificate() })
  assert.deepEqual(embeddedSignature(signed), { present: true, size: 32, certificateType: 2, reason: null })
})

test('앱 exe(PE32+ x64)와 홀수 길이 문자열도 4byte 정렬을 지켜 읽는다', () => {
  const strings = { ProductName: 'Han-Flow', ProductVersion: '1.0.0.0', FileVersion: '1.0.0-rc.1', CompanyName: 'A' }
  const buffer = syntheticPe({ pe32Plus: true, machine: 0x8664, resource: versionResource({ strings }) })
  assert.equal(parsePeHeaders(buffer).format, 'PE32+')
  assert.equal(parsePeHeaders(buffer).machine, 'x64')
  assert.deepEqual(parseVersionInfo(buffer).strings, strings)
})

test('PE가 아니거나 인증서 표가 잘못되면 서명 없음으로 보고하고 던지지 않는다', () => {
  assert.equal(parsePeHeaders(Buffer.from('not an exe')).isPE, false)
  assert.equal(embeddedSignature(Buffer.alloc(0x100)).present, false)
  const truncated = syntheticPe({ resource: versionResource({ strings: nsisStrings }), certificate: winCertificate() })
  const cut = truncated.subarray(0, truncated.length - 8)
  assert.equal(embeddedSignature(cut).reason, '인증서 표가 파일 밖을 가리킴')
  const x509Only = syntheticPe({ resource: versionResource({ strings: nsisStrings }), certificate: winCertificate(0x0001) })
  assert.equal(embeddedSignature(x509Only).present, false)
  assert.equal(parseVersionInfo(syntheticPe({ resource: Buffer.alloc(64) })), null)
})

test('X.500 subject에서 CN만 뽑는다', () => {
  assert.equal(commonNameOf('/C=KR/O=Example/CN=Seongwon Park'), 'Seongwon Park')
  assert.equal(commonNameOf('CN="Han-Flow, Inc.", O=Han-Flow, C=KR'), 'Han-Flow, Inc.')
  assert.equal(commonNameOf('CN=Han\\, Flow, O=X'), 'Han, Flow')
  assert.equal(commonNameOf('O=No CN'), null)
  assert.equal(commonNameOf(null), null)
})

// osslsigncode 2.8 실제 출력(경로·hash는 줄임)
const osslUnsigned = `Current PE checksum   : 00000000
Calculated PE checksum: 0EAC7D93
Warning: invalid PE checksum

No signature found

Unable to extract existing signature
Failed`

const osslSelfSigned = `Signature Index: 0  (Primary Signature)

Message digest algorithm  : SHA256
Current message digest    : 3EE4
Calculated message digest : 3EE4

Signer's certificate:
\t------------------
\tSigner #0:
\t\tSubject: /C=KR/O=Han-Flow Test/CN=Han-Flow Test Signer
\t\tIssuer : /C=KR/O=Han-Flow Test/CN=Han-Flow Test Signer

Timestamp is not available

\tError: self-signed certificate

PKCS7_verify error
Signature verification: failed

Number of verified signatures: 1`

const osslValidTimestamped = `Signature Index: 0  (Primary Signature)
Current message digest    : AA
Calculated message digest : AA

Signer's certificate:
\tSigner #0:
\t\tSubject: /C=KR/L=Seoul/CN=Seongwon Park
\t\tIssuer : /C=US/O=Example CA/CN=Example Code Signing CA

The signature is timestamped:
\tTimestamp time: Oct 20 00:42:24 2026 GMT

Timestamp Server Signature verification: ok
Signature verification: ok

Number of verified signatures: 1
Succeeded`

test('osslsigncode 출력에서 서명 없음·검증 실패·유효한 timestamp 서명을 구분한다', () => {
  assert.deepEqual(parseOsslsigncodeVerify(osslUnsigned, 1), {
    tool: 'osslsigncode', status: 'unsigned', signerPresent: false, timestamped: false, signerCommonName: null
  })
  const selfSigned = parseOsslsigncodeVerify(osslSelfSigned, 1)
  assert.equal(selfSigned.status, 'invalid')
  assert.equal(selfSigned.signerPresent, true)
  assert.equal(selfSigned.timestamped, false)
  assert.equal(selfSigned.signerCommonName, 'Han-Flow Test Signer')
  const valid = parseOsslsigncodeVerify(osslValidTimestamped, 0)
  assert.equal(valid.status, 'valid')
  assert.equal(valid.timestamped, true)
  assert.equal(valid.signerCommonName, 'Seongwon Park')
  // timestamp 검증만 ok이고 서명 검증이 실패하면 유효하지 않다.
  const timestampOnly = osslValidTimestamped.replace('Signature verification: ok\n', 'Signature verification: failed\n')
  assert.equal(parseOsslsigncodeVerify(timestampOnly, 1).status, 'invalid')
  assert.equal(parseOsslsigncodeVerify(osslValidTimestamped.replace('Calculated message digest : AA', 'Calculated message digest : BB\nMISMATCH!!!'), 1).status, 'invalid')
  assert.equal(parseOsslsigncodeVerify('', null).status, 'unknown')
})

test('PowerShell Get-AuthenticodeSignature JSON의 상태를 같은 값으로 바꾼다', () => {
  const valid = parsePowerShellSignature('{"Status":"Valid","SignatureType":"Authenticode","SignerSubject":"CN=Seongwon Park, O=Seongwon Park, C=KR","HasTimestamp":true}')
  assert.deepEqual(valid, {
    tool: 'powershell', status: 'valid', rawStatus: 'Valid', signerPresent: true, timestamped: true, signerCommonName: 'Seongwon Park'
  })
  const unsigned = parsePowerShellSignature('{"Status":"NotSigned","SignatureType":"None","SignerSubject":null,"HasTimestamp":false}\r\n')
  assert.equal(unsigned.status, 'unsigned')
  assert.equal(unsigned.signerPresent, false)
  assert.equal(parsePowerShellSignature('{"Status":"HashMismatch","SignerSubject":"CN=X","HasTimestamp":false}').status, 'invalid')
  assert.equal(parsePowerShellSignature('{"Status":"NotTrusted","SignerSubject":"CN=X","HasTimestamp":true}').status, 'invalid')
  assert.equal(parsePowerShellSignature('Get-AuthenticodeSignature: 찾을 수 없음').status, 'unknown')
})

// ---- release 설정 ----

test('release 설정은 비서명 설정을 이어받고 서명을 강제한다', () => {
  const config = releaseConfig.createWindowsReleaseConfig(packageJson.build, {})
  assert.equal(config.forceCodeSigning, true)
  assert.equal(config.appId, packageJson.build.appId)
  assert.equal(config.appId, 'com.hanflow.viewer')
  assert.equal(config.directories.output, 'release/windows-release')
  assert.deepEqual(config.win.target, [{ target: 'nsis', arch: ['x64'] }])
  assert.equal(config.win.artifactName, 'Han-Flow-${version}-win-x64.${ext}')
  assert.deepEqual(config.win.fileAssociations.map((association) => association.ext), ['hwp', 'hwpx'])
  assert.deepEqual(config.nsis, packageJson.build.nsis)
  assert.equal(config.nsis.oneClick, false)
  assert.equal(config.nsis.perMachine, false)
  assert.deepEqual(config.win.signtoolOptions, {
    signingHashAlgorithms: ['sha256'], rfc3161TimeStampServer: 'http://timestamp.digicert.com'
  })
  assert.equal(config.win.azureSignOptions, undefined)
  assert.notEqual(config.win.signExecutable, false)
  // 비서명 로컬 설정은 그대로다.
  assert.equal(packageJson.build.forceCodeSigning, undefined)
  assert.equal(packageJson.build.directories.output, 'release')
  assert.ok(packageJson.build.win.target.includes('dir'))
  assert.equal(packageJson.build.win.signtoolOptions, undefined)
})

test('인증서 경로·비밀번호는 설정에 들어가지 않고 publisher 이름만 들어간다', () => {
  const env = {
    WIN_CSC_LINK: 'c2VjcmV0LXBmeA==',
    WIN_CSC_KEY_PASSWORD: 'top-secret-password',
    HAN_FLOW_WIN_PUBLISHER_NAME: ' Seongwon Park '
  }
  const config = releaseConfig.createWindowsReleaseConfig(packageJson.build, env)
  const serialized = JSON.stringify(config)
  assert.ok(!serialized.includes(env.WIN_CSC_LINK))
  assert.ok(!serialized.includes(env.WIN_CSC_KEY_PASSWORD))
  assert.equal(config.win.signtoolOptions.publisherName, 'Seongwon Park')
  assert.deepEqual(releaseConfig.windowsSigningPreflight(env), { mode: 'pfx', ready: true, missing: [] })
})

test('Azure Trusted Signing은 endpoint가 있으면 고르고 client secret은 설정에 넣지 않는다', () => {
  const env = {
    AZURE_TENANT_ID: 'tenant',
    AZURE_CLIENT_ID: 'client',
    AZURE_CLIENT_SECRET: 'azure-client-secret',
    HAN_FLOW_AZURE_SIGNING_ENDPOINT: 'https://krc.codesigning.azure.net/',
    HAN_FLOW_AZURE_SIGNING_ACCOUNT: 'hanflow',
    HAN_FLOW_AZURE_CERTIFICATE_PROFILE: 'public',
    HAN_FLOW_WIN_PUBLISHER_NAME: 'Seongwon Park'
  }
  assert.equal(releaseConfig.resolveWindowsSigningMode(env), 'azure')
  const config = releaseConfig.createWindowsReleaseConfig(packageJson.build, env)
  assert.equal(config.win.signtoolOptions, undefined)
  assert.deepEqual(config.win.azureSignOptions, {
    publisherName: 'Seongwon Park',
    endpoint: 'https://krc.codesigning.azure.net/',
    codeSigningAccountName: 'hanflow',
    certificateProfileName: 'public',
    fileDigest: 'SHA256',
    timestampRfc3161: 'http://timestamp.acs.microsoft.com',
    timestampDigest: 'SHA256'
  })
  assert.ok(!JSON.stringify(config).includes('azure-client-secret'))
  assert.deepEqual(releaseConfig.windowsSigningPreflight(env), { mode: 'azure', ready: true, missing: [] })
})

test('사전 검사는 빠진 변수 이름만 돌려주고 값은 돌려주지 않는다', () => {
  assert.deepEqual(releaseConfig.windowsSigningPreflight({}), {
    mode: 'pfx', ready: false, missing: ['WIN_CSC_LINK|CSC_LINK', 'WIN_CSC_KEY_PASSWORD|CSC_KEY_PASSWORD']
  })
  // 빈 문자열(GitHub에 secret이 없을 때 workflow가 넘기는 값)은 없는 것으로 본다.
  const emptySecrets = { WIN_CSC_LINK: '', WIN_CSC_KEY_PASSWORD: '  ', CSC_LINK: 'only-generic-link' }
  const partial = releaseConfig.windowsSigningPreflight(emptySecrets)
  assert.deepEqual(partial.missing, ['WIN_CSC_KEY_PASSWORD|CSC_KEY_PASSWORD'])
  assert.ok(!JSON.stringify(partial).includes('only-generic-link'))
  const azure = releaseConfig.windowsSigningPreflight({ HAN_FLOW_WIN_SIGNING_MODE: 'azure', AZURE_CLIENT_SECRET: 'x' })
  assert.deepEqual(azure.missing, [
    'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'HAN_FLOW_AZURE_SIGNING_ENDPOINT', 'HAN_FLOW_AZURE_SIGNING_ACCOUNT',
    'HAN_FLOW_AZURE_CERTIFICATE_PROFILE', 'HAN_FLOW_WIN_PUBLISHER_NAME'
  ])
  const invalid = releaseConfig.windowsSigningPreflight({ HAN_FLOW_WIN_SIGNING_MODE: 'ev-token' })
  assert.equal(invalid.ready, false)
  assert.deepEqual(invalid.missing, ['HAN_FLOW_WIN_SIGNING_MODE'])
  assert.throws(() => releaseConfig.createWindowsReleaseConfig(packageJson.build, { HAN_FLOW_WIN_SIGNING_MODE: 'ev-token' }))
})

test('release 명령과 workflow는 사전 검사를 먼저 하고 비서명 CI 흐름은 그대로 둔다', () => {
  assert.match(packageJson.scripts['package:win:release'],
    /^node scripts\/build\/check_windows_signing\.mjs && npm run build && electron-builder --config scripts\/build\/electron-builder\.win-release\.cjs --win nsis --x64 --publish never$/)
  assert.equal(packageJson.scripts['package:win:installer'], 'npm run build && electron-builder --win nsis --x64 --publish never')
  const workflow = readFileSync(resolve(root, '.github/workflows/release-windows.yml'), 'utf8')
  const preflight = workflow.indexOf('node scripts/build/check_windows_signing.mjs')
  const tests = workflow.indexOf('npm test -- --runInBand')
  const build = workflow.indexOf('npm run package:win:release')
  const audit = workflow.indexOf('npm run release:audit:win -- --strict')
  const upload = workflow.indexOf('actions/upload-artifact')
  assert.ok(preflight > 0 && preflight < tests && tests < build && build < audit && audit < upload)
  assert.ok(!/package:win:installer/.test(workflow))
  // secret 값을 echo하지 않는다.
  assert.ok(!/echo[^\n]*secrets\./.test(workflow))
  const ci = readFileSync(resolve(root, '.github/workflows/windows-ci.yml'), 'utf8')
  assert.ok(ci.includes('npm run package:win:installer'))
  assert.ok(!ci.includes('package:win:release'))
})
