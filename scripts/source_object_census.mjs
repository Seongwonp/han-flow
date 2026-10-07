// HWPX section XML 원문에서 화면에 그대로 그리지 못하는 개체를 종류별로 센다(verify_app의 개체 소실 검사).
// viewer decoder(src/core/parser/viewer_decoder.ts)를 쓰지 않고 원문만 따로 읽어, decoder나 renderer가 개체를 조용히
// 버리면 화면 자리 표시 수가 이 값보다 적어져 드러나게 한다. 종류 규칙은 decoder 자리 표시와 같다.
// - 수식 equation, 차트 chart(같은 hp:switch의 OLE 대체 그림은 세지 않음), OLE ole, 동영상 video
// - 도형: 다른 도형·묶음 안에 들지 않은 도형 하나마다, 글(hp:drawText)이 있으면 text-box, 없으면 shape(글맵시도 shape)
// - 양식 컨트롤 form-control, 각주 footnote, 미주 endnote, 덧말 ruby
// - 본문 밖 글(hp:subList)이 있는 필드: 메모(type="MEMO") memo, 그 밖 field
// - hp:switch는 차트가 없으면 decoder처럼 hp:default(없으면 첫 hp:case) 하나만 본다.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const SOURCE_OBJECT_KINDS = [
  'equation', 'chart', 'ole', 'text-box', 'shape', 'form-control', 'video', 'footnote', 'endnote', 'memo', 'field', 'ruby'
]
const SHAPES = new Set(['hp:rect', 'hp:ellipse', 'hp:arc', 'hp:polygon', 'hp:curve', 'hp:line', 'hp:connectLine', 'hp:container', 'hp:textart'])
const FORMS = new Set(['hp:btn', 'hp:radioBtn', 'hp:checkBtn', 'hp:comboBox', 'hp:edit', 'hp:listBox', 'hp:scrollBar'])
const SIMPLE = { 'hp:equation': 'equation', 'hp:chart': 'chart', 'hp:ole': 'ole', 'hp:video': 'video', 'hp:footNote': 'footnote', 'hp:endNote': 'endnote', 'hp:dutmal': 'ruby' }

const nameOf = (entry) => Object.keys(entry).find((key) => key !== ':@')
const childrenOf = (entry) => {
  const name = nameOf(entry)
  return name && Array.isArray(entry[name]) ? entry[name] : []
}
const attributesOf = (entry) => entry[':@'] ?? {}
const hasDescendant = (entry, predicate) => childrenOf(entry).some((item) => predicate(nameOf(item)) || hasDescendant(item, predicate))

function emptyCounts() {
  return Object.fromEntries(SOURCE_OBJECT_KINDS.map((kind) => [kind, 0]))
}

/** 이미 parse한 ordered XML(fast-xml-parser preserveOrder) 목록에서 종류별 개체 수를 더한다. */
function countEntries(entries, counts) {
  for (const entry of entries) {
    const name = nameOf(entry)
    if (!name || name === '#text') continue
    if (name === 'hp:switch') {
      const branches = childrenOf(entry).filter((item) => ['hp:case', 'hp:default'].includes(nameOf(item)))
      if (branches.some((branch) => hasDescendant(branch, (child) => child === 'hp:chart'))) {
        counts.chart += 1
        continue
      }
      const branch = branches.find((item) => nameOf(item) === 'hp:default') ?? branches[0]
      if (branch) countEntries(childrenOf(branch), counts)
      continue
    }
    if (SHAPES.has(name)) {
      counts[name !== 'hp:textart' && hasDescendant(entry, (child) => child === 'hp:drawText') ? 'text-box' : 'shape'] += 1
      // 도형 글 안의 개체(글상자 안 수식 등)는 따로 센다. 묶음 안 도형은 묶음 하나로 센다.
      countEntries(childrenOf(entry).filter((item) => !SHAPES.has(nameOf(item))), counts)
      continue
    }
    if (FORMS.has(name)) counts['form-control'] += 1
    else if (SIMPLE[name]) counts[SIMPLE[name]] += 1
    else if (name === 'hp:fieldBegin' && childrenOf(entry).some((item) => nameOf(item) === 'hp:subList')) {
      counts[attributesOf(entry).type === 'MEMO' ? 'memo' : 'field'] += 1
    }
    countEntries(childrenOf(entry), counts)
  }
  return counts
}

/** section XML 문자열 목록의 종류별 개수(0인 종류 포함). XML을 읽지 못하면 예외를 던진다. */
export function sourceObjectCensus(sectionXmls) {
  const { XMLParser } = require('fast-xml-parser')
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, attributeNamePrefix: '', parseTagValue: false, parseAttributeValue: false })
  const counts = emptyCounts()
  for (const xml of sectionXmls) countEntries(parser.parse(xml), counts)
  return counts
}

/** HWPX 파일의 section XML 개체 census. 파일·ZIP·XML을 읽지 못하면 예외를 던진다(조용히 건너뛰지 않는다). */
export function hwpxSourceObjectCensus(path) {
  const AdmZip = require('adm-zip')
  const entries = new AdmZip(path).getEntries().filter((entry) => /^Contents\/section\d+\.xml$/u.test(entry.entryName))
  if (!entries.length) throw new Error('section XML이 없습니다.')
  return sourceObjectCensus(entries.map((entry) => entry.getData().toString('utf8')))
}

/** 원본 종류별 개수보다 화면 자리 표시가 적은 종류. `[{ kind, source, screen }]` */
export function placeholderShortfalls(source, screen = {}) {
  return SOURCE_OBJECT_KINDS.flatMap((kind) => {
    const expected = source[kind] ?? 0
    const actual = screen[kind] ?? 0
    return actual < expected ? [{ kind, source: expected, screen: actual }] : []
  })
}
