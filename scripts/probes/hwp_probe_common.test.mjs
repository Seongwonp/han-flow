import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as CFB from 'cfb'
import { summarizeBlocks } from './kordoc_probe.mjs'
import {
  adapterCapability,
  buildKordocViewerDocument,
  summarizeKordocViewerDocument,
  tableOriginCells
} from './kordoc_viewer_adapter.mjs'
import {
  alignTextPages,
  characterBagStatistics,
  editStatistics,
  normalizeProbeText
} from './text_alignment.mjs'
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

test('Kordoc adapter는 section tag와 병합 cell 원점만 ViewerDocument로 보존한다', () => {
  const blocks = [
    { type: 'paragraph', text: '첫 구역', pageNumber: 1, spans: [{ text: '첫 ', bold: true }, { text: '구역' }] },
    {
      type: 'table',
      pageNumber: 2,
      table: {
        rows: 2,
        cols: 2,
        hasHeader: true,
        cells: [
          [
            {
              text: '병합',
              colSpan: 2,
              rowSpan: 1,
              isHeader: true,
              blocks: [{ type: 'paragraph', text: '셀 첫 문단' }, { type: 'paragraph', text: '셀 둘째 문단' }]
            },
            { text: '병합 중복', colSpan: 1, rowSpan: 1 }
          ],
          [
            { text: '', colSpan: 1, rowSpan: 1 },
            {
              text: '그림',
              colSpan: 1,
              rowSpan: 1,
              blocks: [{
                type: 'image',
                imageData: {
                  data: new Uint8Array([1, 2, 3]),
                  mimeType: 'image/png',
                  filename: 'fixture.png'
                }
              }]
            }
          ]
        ]
      }
    },
    {
      type: 'image',
      pageNumber: 2,
      imageData: {
        data: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        filename: 'same-binary.png'
      }
    }
  ]

  const document = buildKordocViewerDocument(blocks)
  assert.deepEqual(document.sections.map((section) => section.id), ['kordoc-section-1', 'kordoc-section-2'])
  assert.equal(document.sections[1].blocks[0].content[0].rows[0].cells.length, 1)
  assert.deepEqual(
    {
      row: document.sections[1].blocks[0].content[0].rows[0].cells[0].row,
      column: document.sections[1].blocks[0].content[0].rows[0].cells[0].column,
      rowSpan: document.sections[1].blocks[0].content[0].rows[0].cells[0].rowSpan,
      columnSpan: document.sections[1].blocks[0].content[0].rows[0].cells[0].columnSpan,
      header: document.sections[1].blocks[0].content[0].rows[0].cells[0].header
    },
    {
      row: 0,
      column: 0,
      rowSpan: 1,
      columnSpan: 2,
      header: true
    }
  )
  assert.deepEqual(summarizeKordocViewerDocument(document), {
    sections: 2,
    paragraphs: 7,
    tables: 1,
    cells: 3,
    images: 2,
    resources: 1,
    textCharacters: 12,
    diagnostics: 3
  })
  const capability = adapterCapability(blocks, document)
  assert.equal(capability.status, 'semantic-only')
  assert.equal(capability.sectionTagCoverage, 1)
  assert.equal(capability.pageGeometry, false)
  assert.equal(capability.tableGeometry, false)
  assert.equal(capability.headerFooterAndPageNumber, false)
})

test('Kordoc grid의 span 범위에 들어간 중복 slot은 cell 원점에서 제외한다', () => {
  const table = {
    rows: 2,
    cols: 3,
    cells: [
      [
        { text: 'root', rowSpan: 2, colSpan: 2 },
        { text: 'covered-a', rowSpan: 1, colSpan: 1 },
        { text: 'right', rowSpan: 1, colSpan: 1 }
      ],
      [
        { text: 'covered-b', rowSpan: 1, colSpan: 1 },
        { text: 'covered-c', rowSpan: 1, colSpan: 1 },
        { text: 'bottom-right', rowSpan: 1, colSpan: 1 }
      ]
    ]
  }

  assert.deepEqual(tableOriginCells(table).map(({ row, column }) => [row, column]), [
    [0, 0],
    [0, 2],
    [1, 2]
  ])
})

test('privacy-safe 페이지 정렬은 기준 두 페이지가 후보 한 페이지로 합쳐진 구간을 찾는다', () => {
  const alignment = alignTextPages(
    ['첫 페이지', '둘째 페이지', '셋째 페이지', '넷째 페이지'],
    ['첫 페이지', '둘째 페이지셋째 페이지', '넷째 페이']
  )

  assert.deepEqual(
    alignment.groups.map((group) => ({
      reference: group.reference,
      candidate: group.candidate,
      characterDelta: group.characterDelta
    })),
    [
      {
        reference: { startPage: 1, endPage: 1 },
        candidate: { startPage: 1, endPage: 1 },
        characterDelta: 0
      },
      {
        reference: { startPage: 2, endPage: 3 },
        candidate: { startPage: 2, endPage: 2 },
        characterDelta: 0
      },
      {
        reference: { startPage: 4, endPage: 4 },
        candidate: { startPage: 3, endPage: 3 },
        characterDelta: -1
      }
    ]
  )
  assert.equal(alignment.characterDelta, -1)
  assert.equal(alignment.editDistance, 1)
  assert.equal(JSON.stringify(alignment).includes('첫 페이지'), false)
})

test('text edit 통계는 원문을 노출하지 않고 삽입·삭제·치환 수만 반환한다', () => {
  assert.equal(normalizeProbeText(' 가\n나 '), '가나')
  assert.deepEqual(editStatistics('가나다라', '가마라'), {
    distance: 2,
    insertions: 0,
    deletions: 1,
    substitutions: 1,
    similarity: 0.5,
    commonPrefix: 1,
    commonSuffix: 1,
    exact: false,
    matrixLimited: false
  })
  assert.deepEqual(characterBagStatistics('가나다라', '라마가'), {
    common: 2,
    missing: 2,
    extra: 1,
    similarity: 0.5,
    missingCategories: {
      hangul: 2,
      latin: 0,
      number: 0,
      punctuation: 0,
      symbol: 0,
      other: 0
    },
    extraCategories: {
      hangul: 1,
      latin: 0,
      number: 0,
      punctuation: 0,
      symbol: 0,
      other: 0
    }
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
