import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyReplaceTextCommand,
  escapeXmlText,
  HwpxEditConflictError,
  listHwpxTextAnchors,
  ReplaceTextCommand
} from '../../src/core/editing/text_patch'
import { saveHwpxAs } from '../../src/core/editing/save_as'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createRoundTripHwpx, roundTripSentinels } from '../fixtures/public/create_synthetic_hwpx'

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function replaceWholeText(sourcePackage: HwpxSourcePackage, text: string, insert: string): ReplaceTextCommand {
  const anchor = listHwpxTextAnchors(sourcePackage, 'Contents/section0.xml').find(
    (candidate) => candidate.text === text
  )
  if (!anchor) throw new Error(`테스트 text anchor를 찾을 수 없습니다: ${text}`)
  return {
    type: 'replace-text',
    revision: sourcePackage.revision,
    sectionPath: anchor.sectionPath,
    textNodeId: anchor.textNodeId,
    from: 0,
    to: anchor.text.length,
    insert
  }
}

describe('HWPX text patch와 Save As', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-editing-'))
  const fixture = createRoundTripHwpx(directory)
  const privateFixture = process.env['HAN_FLOW_PRIVATE_HWPX']

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('단일 hp:t만 XML-safe text로 바꾸고 inverse로 원문 bytes를 복원한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const originalSection = source.readEntry('Contents/section0.xml')
    const insert = '수정 & <검증> "인용"\t줄1\n줄2 😀'
    const command = replaceWholeText(source, '공개 헤더', insert)
    const result = applyReplaceTextCommand(source, command)

    expect(result.package.revision).toBe(1)
    expect(result.anchor.text).toBe(insert)
    expect(result.lossReport).toMatchObject({
      modifiedEntries: ['Contents/section0.xml'],
      regeneratedEntries: [],
      omittedEntries: [],
      previewStatus: 'stale'
    })
    expect(result.lossReport.preservedEntries).toContain('Unknown/custom.bin')
    expect(result.package.readEntry('Unknown/custom.bin')).toEqual(roundTripSentinels.binary)

    const patchedXml = result.package.readEntry('Contents/section0.xml').toString('utf8')
    expect(patchedXml).toContain('수정 &amp; &lt;검증&gt; "인용"&#9;줄1<hp:lineBreak/>줄2 😀')
    expect(listHwpxTextAnchors(result.package, command.sectionPath)).toContainEqual({ ...result.anchor })

    const restored = applyReplaceTextCommand(result.package, result.inverse)
    expect(restored.package.revision).toBe(2)
    expect(restored.package.readEntry('Contents/section0.xml')).toEqual(originalSection)
  })

  test('비어 있는 hp:t를 편집하고 stale revision·Unicode 중간 범위를 거부한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const empty = listHwpxTextAnchors(source, 'Contents/section0.xml').find((anchor) => anchor.text === '')
    expect(empty).toBeDefined()

    const inserted = applyReplaceTextCommand(source, {
      type: 'replace-text',
      revision: 0,
      sectionPath: empty!.sectionPath,
      textNodeId: empty!.textNodeId,
      from: 0,
      to: 0,
      insert: '빈 노드 입력'
    })
    expect(inserted.anchor.text).toBe('빈 노드 입력')

    expect(() =>
      applyReplaceTextCommand(inserted.package, {
        type: 'replace-text',
        revision: 0,
        sectionPath: empty!.sectionPath,
        textNodeId: empty!.textNodeId,
        from: 0,
        to: 0,
        insert: 'stale'
      })
    ).toThrow(HwpxEditConflictError)

    const emojiResult = applyReplaceTextCommand(source, replaceWholeText(source, '공개 헤더', 'A😀B'))
    expect(() =>
      applyReplaceTextCommand(emojiResult.package, {
        type: 'replace-text',
        revision: 1,
        sectionPath: empty!.sectionPath,
        textNodeId: replaceWholeText(source, '공개 헤더', '').textNodeId,
        from: 2,
        to: 2,
        insert: 'X'
      })
    ).toThrow('surrogate pair')
  })

  test('XML 1.0 금지 문자를 거부한다', () => {
    expect(() => escapeXmlText('NUL\0')).toThrow('XML 1.0')
    expect(() => escapeXmlText('\ud800')).toThrow('XML 1.0')
  })

  test('lineBreak·tab 혼합 콘텐츠를 논리 텍스트로 편집하고 알 수 없는 자식은 제외한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const sectionPath = 'Contents/section0.xml'
    const original = source.readEntry(sectionPath).toString('utf8')
    const unsupported = original.replace(
      '</hs:sec>',
      '<hp:t/><hp:t>첫 줄<hp:lineBreak/>둘째 줄<hp:tab/>탭</hp:t><hp:t><hfx:inline/></hp:t><hp:t>&custom;</hp:t></hs:sec>'
    )
    const guarded = source.withEntry(sectionPath, Buffer.from(unsupported))
    const anchors = listHwpxTextAnchors(guarded, sectionPath)

    expect(anchors.filter((anchor) => anchor.text === '')).toHaveLength(1)
    expect(anchors.some((anchor) => anchor.text === '첫 줄\n둘째 줄\t탭')).toBe(true)
    expect(anchors.some((anchor) => anchor.text.includes('custom'))).toBe(false)

    const mixed = anchors.find((anchor) => anchor.text === '첫 줄\n둘째 줄\t탭')!
    const edited = applyReplaceTextCommand(guarded, {
      type: 'replace-text',
      revision: guarded.revision,
      sectionPath,
      textNodeId: mixed.textNodeId,
      from: 3,
      to: 4,
      insert: '\n새 줄\n'
    })
    expect(edited.anchor.text).toBe('첫 줄\n새 줄\n둘째 줄\t탭')
    expect(edited.package.readEntry(sectionPath).toString('utf8')).toContain(
      '첫 줄<hp:lineBreak/>새 줄<hp:lineBreak/>둘째 줄&#9;탭'
    )
  })

  test('검증된 package만 새 목적지에 연결하고 원본과 미수정 entry를 보존한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const originalFileHash = hash(readFileSync(fixture))
    const command = replaceWholeText(source, '공개 헤더', '저장 검증 완료')
    const edited = applyReplaceTextCommand(source, command)
    const destination = join(directory, 'saved-as.hwpx')

    const saveResult = await saveHwpxAs(edited.package, destination, {
      verify: (savedPackage) => {
        const savedAnchor = listHwpxTextAnchors(savedPackage, command.sectionPath).find(
          (anchor) => anchor.textNodeId === command.textNodeId
        )
        expect(savedAnchor?.text).toBe('저장 검증 완료')
      }
    })

    expect(saveResult).toMatchObject({
      destinationPath: destination,
      revision: 1
    })
    expect(hash(readFileSync(fixture))).toBe(originalFileHash)
    const saved = await HwpxSourcePackage.open(destination)
    for (const entry of source.listEntries()) {
      if (entry.type === 'file' && entry.path !== command.sectionPath) {
        expect(hash(saved.readEntry(entry.path))).toBe(hash(source.readEntry(entry.path)))
      }
    }
    expect(saved.readEntry('Contents/header.xml').toString('utf8')).toContain(roundTripSentinels.headerNode)
    expect(saved.readEntry(command.sectionPath).toString('utf8')).toContain(roundTripSentinels.sectionNode)
  })

  test('검증 실패와 기존 목적지 충돌에서 목적지를 만들거나 덮어쓰지 않는다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const edited = applyReplaceTextCommand(source, replaceWholeText(source, '공개 헤더', '실패 주입')).package
    const failedDestination = join(directory, 'validation-failed.hwpx')

    await expect(
      saveHwpxAs(edited, failedDestination, {
        verify: () => {
          throw new Error('의도한 검증 실패')
        }
      })
    ).rejects.toThrow('의도한 검증 실패')
    expect(existsSync(failedDestination)).toBe(false)
    expect(readdirSync(directory).filter((name) => name.includes('.han-flow-'))).toEqual([])

    const existingDestination = join(directory, 'existing.hwpx')
    writeFileSync(existingDestination, '기존 파일')
    await expect(saveHwpxAs(edited, existingDestination)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(existingDestination, 'utf8')).toBe('기존 파일')
    await expect(saveHwpxAs(edited, fixture)).rejects.toThrow('원본 파일 덮어쓰기')
    await expect(saveHwpxAs(edited, join(directory, 'wrong.txt'))).rejects.toThrow('.hwpx')
  })
  ;(privateFixture ? test : test.skip)(
    '비공개 실문서를 본문 노출 없이 한 글자 patch하고 Save As로 재개봉한다',
    async () => {
      const originalHash = hash(readFileSync(privateFixture!))
      const source = await HwpxSourcePackage.open(privateFixture!)
      const sectionPath = source
        .listEntries()
        .map((entry) => entry.path)
        .find((path) => /^Contents\/section\d+\.xml$/.test(path))
      if (!sectionPath) throw new Error('실문서 section을 찾을 수 없습니다.')
      const anchor = listHwpxTextAnchors(source, sectionPath).find((candidate) => candidate.text.length > 0)
      if (!anchor) throw new Error('실문서 text anchor를 찾을 수 없습니다.')

      const edited = applyReplaceTextCommand(source, {
        type: 'replace-text',
        revision: 0,
        sectionPath,
        textNodeId: anchor.textNodeId,
        from: anchor.text.length,
        to: anchor.text.length,
        insert: ' '
      })
      const destination = join(directory, 'private-text-patch.hwpx')
      await saveHwpxAs(edited.package, destination, {
        verify: (savedPackage) => {
          const saved = listHwpxTextAnchors(savedPackage, sectionPath).find(
            (candidate) => candidate.textNodeId === anchor.textNodeId
          )
          expect(saved?.text.length).toBe(anchor.text.length + 1)
        }
      })

      expect(hash(readFileSync(privateFixture!))).toBe(originalHash)
    }
  )
})
