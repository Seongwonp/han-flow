// Windows 실행 파일(NSIS 설치본·앱 exe)의 PE 구조, Authenticode 인증서 표, 버전 리소스를 읽고
// osslsigncode·PowerShell 서명 검사 출력을 해석한다. 모두 순수 함수라 probe test가 직접 검사한다.
// 서명자 이름 같은 값은 돌려주되, 출력 여부는 호출하는 쪽이 정한다(감사 script는 출력하지 않는다).

const MACHINE_NAMES = { 0x014c: 'x86', 0x8664: 'x64', 0xaa64: 'arm64' }
const SECURITY_DIRECTORY_INDEX = 4
const WIN_CERT_TYPE_PKCS_SIGNED_DATA = 0x0002
const FIXED_FILE_INFO_SIGNATURE = 0xfeef04bd

function readAscii(buffer, start, length) {
  return buffer.toString('latin1', start, start + length).replace(/\0+$/, '')
}

/**
 * PE header와 section, 보안(인증서) data directory를 읽는다. PE가 아니면 { isPE: false }.
 * 인증서 표의 VirtualAddress는 RVA가 아니라 파일 offset이다.
 */
export function parsePeHeaders(buffer) {
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) return { isPE: false, reason: 'MZ header 없음' }
  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset + 24 > buffer.length || buffer.readUInt32LE(peOffset) !== 0x00004550) {
    return { isPE: false, reason: 'PE signature 없음' }
  }
  const machine = buffer.readUInt16LE(peOffset + 4)
  const sectionCount = buffer.readUInt16LE(peOffset + 6)
  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20)
  const optionalHeader = peOffset + 24
  const magic = buffer.readUInt16LE(optionalHeader)
  const isPe32Plus = magic === 0x20b
  if (magic !== 0x10b && !isPe32Plus) return { isPE: false, reason: `알 수 없는 optional header magic 0x${magic.toString(16)}` }
  const rvaCountOffset = optionalHeader + (isPe32Plus ? 108 : 92)
  const directoryCount = buffer.readUInt32LE(rvaCountOffset)
  const directories = rvaCountOffset + 4
  let certificateTable = { offset: 0, size: 0 }
  if (directoryCount > SECURITY_DIRECTORY_INDEX) {
    const entry = directories + SECURITY_DIRECTORY_INDEX * 8
    certificateTable = { offset: buffer.readUInt32LE(entry), size: buffer.readUInt32LE(entry + 4) }
  }
  const sections = []
  const sectionTable = optionalHeader + optionalHeaderSize
  for (let index = 0; index < sectionCount; index += 1) {
    const at = sectionTable + index * 40
    if (at + 40 > buffer.length) break
    sections.push({
      name: readAscii(buffer, at, 8),
      virtualSize: buffer.readUInt32LE(at + 8),
      virtualAddress: buffer.readUInt32LE(at + 12),
      rawSize: buffer.readUInt32LE(at + 16),
      rawOffset: buffer.readUInt32LE(at + 20)
    })
  }
  return {
    isPE: true,
    machine: MACHINE_NAMES[machine] ?? `0x${machine.toString(16)}`,
    format: isPe32Plus ? 'PE32+' : 'PE32',
    sections,
    certificateTable
  }
}

/** 인증서 표가 파일 안에 있고 PKCS#7 SignedData 항목으로 시작하는지 본다(서명 유효성은 판정하지 않음). */
export function embeddedSignature(buffer, headers = parsePeHeaders(buffer)) {
  if (!headers.isPE) return { present: false, reason: headers.reason }
  const { offset, size } = headers.certificateTable
  if (offset === 0 || size === 0) return { present: false, reason: '인증서 표 없음' }
  if (offset + 8 > buffer.length || offset + size > buffer.length) {
    return { present: false, reason: '인증서 표가 파일 밖을 가리킴' }
  }
  const length = buffer.readUInt32LE(offset)
  const certificateType = buffer.readUInt16LE(offset + 6)
  const pkcs7 = certificateType === WIN_CERT_TYPE_PKCS_SIGNED_DATA && length >= 8 && length <= size
  return {
    present: pkcs7,
    size,
    certificateType,
    reason: pkcs7 ? null : `PKCS#7 SignedData가 아닌 인증서 항목(type ${certificateType})`
  }
}

function utf16Key(buffer, start, end) {
  let cursor = start
  while (cursor + 1 < end && buffer.readUInt16LE(cursor) !== 0) cursor += 2
  return { text: buffer.toString('utf16le', start, cursor), next: cursor + 2 }
}

function alignFrom(base, offset) {
  return base + Math.ceil((offset - base) / 4) * 4
}

function parseVersionBlock(buffer, offset, base, limit) {
  const length = buffer.readUInt16LE(offset)
  const valueLength = buffer.readUInt16LE(offset + 2)
  const type = buffer.readUInt16LE(offset + 4)
  const end = Math.min(offset + length, limit)
  if (length < 6 || end <= offset + 6) return null
  const key = utf16Key(buffer, offset + 6, end)
  const valueOffset = alignFrom(base, key.next)
  // 문자열 값의 길이는 WCHAR 단위다. 일부 도구는 byte로 적으므로 null 문자나 block 끝에서 멈춘다.
  const valueBytes = type === 1 ? valueLength * 2 : valueLength
  const valueEnd = Math.min(valueOffset + valueBytes, end)
  const value = type === 1
    ? utf16Key(buffer, valueOffset, valueEnd).text
    : buffer.subarray(valueOffset, valueEnd)
  const children = []
  let child = alignFrom(base, valueOffset + valueBytes)
  while (child + 6 <= end) {
    const block = parseVersionBlock(buffer, child, base, end)
    if (!block) break
    children.push(block)
    child = alignFrom(base, child + block.length)
  }
  return { key: key.text, type, length, value, children }
}

function fixedVersion(ms, ls) {
  return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`
}

/**
 * VS_VERSIONINFO 리소스를 찾아 고정 file/product version과 StringFileInfo 문자열을 돌려준다.
 * `.rsrc` section이 있으면 그 안에서만 찾는다(NSIS 설치본의 압축 payload 안 exe를 잘못 읽지 않도록).
 */
export function parseVersionInfo(buffer, headers = parsePeHeaders(buffer)) {
  const resource = headers.isPE ? headers.sections.find((section) => section.name === '.rsrc') : null
  const start = resource ? resource.rawOffset : 0
  const end = resource ? Math.min(resource.rawOffset + resource.rawSize, buffer.length) : buffer.length
  const marker = Buffer.from('VS_VERSION_INFO\0', 'utf16le')
  const keyAt = buffer.subarray(start, end).indexOf(marker)
  if (keyAt < 0) return null
  const base = start + keyAt - 6
  if (base < start) return null
  const root = parseVersionBlock(buffer, base, base, end)
  if (!root) return null
  let fileVersion = null
  let productVersion = null
  if (Buffer.isBuffer(root.value) && root.value.length >= 52 && root.value.readUInt32LE(0) === FIXED_FILE_INFO_SIGNATURE) {
    fileVersion = fixedVersion(root.value.readUInt32LE(8), root.value.readUInt32LE(12))
    productVersion = fixedVersion(root.value.readUInt32LE(16), root.value.readUInt32LE(20))
  }
  const strings = {}
  for (const table of root.children.filter((child) => child.key === 'StringFileInfo').flatMap((child) => child.children)) {
    for (const entry of table.children) {
      if (typeof entry.value === 'string' && !(entry.key in strings)) strings[entry.key] = entry.value
    }
  }
  return { fixedFileVersion: fileVersion, fixedProductVersion: productVersion, strings }
}

/** X.500 subject 문자열(`/C=KR/CN=...` 또는 `CN=..., O=...`)에서 CN만 뽑는다. */
export function commonNameOf(subject) {
  if (typeof subject !== 'string') return null
  // PowerShell은 쉼표가 든 값을 큰따옴표로 감싸고(`CN="A, Inc."`), OpenSSL 형식은 `\,`로 escape한다.
  const match = subject.match(/(?:^|[/,]\s*)CN=("(?:[^"\\]|\\.)*"|(?:\\.|[^/,])+)/)
  if (!match) return null
  const value = match[1].startsWith('"') ? match[1].slice(1, -1) : match[1]
  return value.replace(/\\(.)/g, '$1').trim()
}

/**
 * `osslsigncode verify -in <file>` 출력(stdout+stderr)을 해석한다.
 * status: unsigned(서명 없음) | valid | invalid(서명은 있으나 검증 실패) | unknown
 */
export function parseOsslsigncodeVerify(output, exitCode = null) {
  const text = String(output ?? '')
  if (/No signature found/i.test(text)) {
    return { tool: 'osslsigncode', status: 'unsigned', signerPresent: false, timestamped: false, signerCommonName: null }
  }
  const signerSection = text.split(/Signer's certificate:/i)[1] ?? ''
  const signerCommonName = commonNameOf(signerSection.match(/Subject:\s*(.+)/)?.[1]?.trim())
  // 2.x는 timestamp가 있으면 `Timestamp time:`과 `Timestamp Server Signature verification:`을, 없으면
  // `Timestamp is not available`을 쓴다. 1.x는 `The signature is timestamped:`를 쓴다.
  const timestamped = /^\s*Timestamp time:/m.test(text) || /The signature is timestamped:/i.test(text) ||
    /^Timestamp Server Signature verification:\s*ok/im.test(text)
  const digestMismatch = /MISMATCH/i.test(text)
  // `Timestamp Server Signature verification:` 줄과 섞이지 않게 줄 처음의 서명 검증 결과만 본다.
  const verificationFailed = /^Signature verification:\s*failed/im.test(text) || /^\s*Failed\s*$/m.test(text)
  const verificationOk = /^Signature verification:\s*ok/im.test(text) || /^\s*Succeeded\s*$/m.test(text)
  let status = 'unknown'
  if (digestMismatch || verificationFailed) status = 'invalid'
  else if (verificationOk && exitCode !== null && exitCode !== 0) status = 'invalid'
  else if (verificationOk) status = 'valid'
  return {
    tool: 'osslsigncode',
    status,
    signerPresent: signerCommonName !== null || /Signer #\d/i.test(text),
    timestamped,
    signerCommonName
  }
}

export const POWERSHELL_SIGNATURE_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$s = Get-AuthenticodeSignature -LiteralPath $env:HAN_FLOW_AUDIT_FILE',
  '[pscustomobject]@{',
  '  Status = $s.Status.ToString()',
  '  SignatureType = "$($s.SignatureType)"',
  '  SignerSubject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null }',
  '  HasTimestamp = $null -ne $s.TimeStamperCertificate',
  '} | ConvertTo-Json -Compress'
].join('\n')

/** POWERSHELL_SIGNATURE_SCRIPT의 JSON 출력을 해석한다. */
export function parsePowerShellSignature(output) {
  let data
  try {
    data = JSON.parse(String(output ?? '').trim())
  } catch {
    return { tool: 'powershell', status: 'unknown', signerPresent: false, timestamped: false, signerCommonName: null }
  }
  const rawStatus = String(data.Status ?? '')
  const status = rawStatus === 'Valid' ? 'valid' : rawStatus === 'NotSigned' ? 'unsigned' : rawStatus ? 'invalid' : 'unknown'
  const signerCommonName = commonNameOf(data.SignerSubject ?? null)
  return {
    tool: 'powershell',
    status,
    rawStatus,
    signerPresent: Boolean(data.SignerSubject),
    timestamped: data.HasTimestamp === true,
    signerCommonName
  }
}
