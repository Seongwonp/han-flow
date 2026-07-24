import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeDocument } from './hwpx_reference_probe.mjs'

test('HWPX reference 요약은 본문과 머리말·꼬리말을 분리한다', () => {
  const paragraph = (content) => ({ content, marker: '1.' })
  const document = {
    resources: { image1: {}, image2: {} },
    sections: [{
      blocks: [paragraph([
        { type: 'text', text: '본문' },
        {
          type: 'table',
          rows: [{ cells: [{ paragraphs: [paragraph([{ type: 'text', text: '셀' }])] }] }]
        },
        { type: 'image' }
      ])],
      headers: [{ paragraphs: [paragraph([{ type: 'text', text: '머리말' }])] }],
      footers: [{ paragraphs: [paragraph([{ type: 'image' }])] }]
    }]
  }

  assert.deepEqual(summarizeDocument(document), {
    sectionCount: 1,
    resources: 2,
    total: { paragraphs: 4, tables: 1, cells: 1, images: 2, textCharacters: 14 },
    sections: [{
      body: { paragraphs: 2, tables: 1, cells: 1, images: 1, textCharacters: 7 },
      headers: { paragraphs: 1, tables: 0, cells: 0, images: 0, textCharacters: 5 },
      footers: { paragraphs: 1, tables: 0, cells: 0, images: 1, textCharacters: 2 }
    }]
  })
})
