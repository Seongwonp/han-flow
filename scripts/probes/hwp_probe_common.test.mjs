import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as CFB from 'cfb'
import { summarizeBlocks } from './kordoc_probe.mjs'
import { HwpProbeError, inspectHwpContainer } from './hwp_probe_common.mjs'

test('semantic block 요약은 표 cell의 중첩 block을 중복 집계하지 않는다', () => {
  const result = summarizeBlocks([
    { type: 'paragraph', text: '본문 한 줄', style: { bold: true }, spans: [{ text: '본문' }] },
    {
      type: 'table',
      table: {
        cells: [[
          { text: '평탄화', colSpan: 1, rowSpan: 1, blocks: [{ type: 'paragraph', text: '셀 문단' }] },
          { text: '두 번째 셀', colSpan: 1, rowSpan: 1 }
        ]]
      }
    },
    { type: 'image' }
  ])

  assert.deepEqual(result, {
    blocks: 4,
    paragraphs: 2,
    headings: 0,
    lists: 0,
    tables: 1,
    cells: 2,
    imageBlocks: 1,
    styledBlocks: 1,
    spans: 1,
    textCharacters: 11
  })
})

test('HWP FileHeader의 version과 보안 flag만 진단한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'han-flow-hwp-probe-test-'))
  try {
    const container = CFB.utils.cfb_new()
    const header = Buffer.alloc(256)
    header.write('HWP Document File', 0, 'ascii')
    header.set([1, 0, 1, 5], 32)
    header.writeUInt32LE((1 << 0) | (1 << 2) | (1 << 3), 36)
    CFB.utils.cfb_add(container, 'FileHeader', header)
    CFB.utils.cfb_add(container, 'BodyText/Section0', Buffer.from('fixture body'))
    const path = join(directory, 'fixture.hwp')
    await writeFile(path, CFB.write(container, { type: 'buffer' }))

    const result = await inspectHwpContainer(path)
    assert.equal(result.container.version, '5.1.0.1')
    assert.deepEqual(result.container.flags, {
      compressed: true,
      encrypted: false,
      distribution: true,
      containsScripts: true,
      drm: false
    })
    assert.equal(result.input.format, 'hwp5')
    assert.equal('fileName' in result.input, false)
    assert.equal(JSON.stringify(result).includes('fixture body'), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('CFB가 아닌 입력은 본문 없이 분류된 오류를 반환한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'han-flow-hwp-probe-test-'))
  try {
    const path = join(directory, 'invalid.hwp')
    await writeFile(path, 'private body')
    await assert.rejects(
      inspectHwpContainer(path),
      (error) => error instanceof HwpProbeError && error.code === 'NOT_CFB' && !error.message.includes('private body')
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
