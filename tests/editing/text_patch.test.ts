import { createHash } from 'crypto'
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import {
  applyReplaceTextCommand,
  escapeXmlText,
  HwpxEditConflictError,
  listHwpxTextAnchors,
  listHwpxTextOrdinals,
  ReplaceTextCommand
} from '../../src/core/editing/text_patch'
import { saveHwpxAs, writeFileAtomically } from '../../src/core/editing/save_as'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createRoundTripHwpx, roundTripSentinels } from '../fixtures/public/create_synthetic_hwpx'

// save_as가 호출 시점에 읽는 실제 module 객체. namespace import는 spyOn으로 바꿀 수 없다.
const fsPromises: typeof import('fs/promises') = jest.requireActual('fs/promises')

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

  test('자기 닫힘 <hp:t/>에 입력하면 열린 tag로 펼치고 inverse는 원래 bytes로 되돌린다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const sectionPath = 'Contents/section0.xml'
    const selfClosing = '<hp:t xml:space="preserve" />'
    const original = source.readEntry(sectionPath).toString('utf8').replace(
      '<hp:t></hp:t>',
      selfClosing
    )
    expect(original).toContain(selfClosing)
    const guarded = source.withEntry(sectionPath, Buffer.from(original))
    const anchors = listHwpxTextAnchors(guarded, sectionPath)
    const empty = anchors.find((anchor) => anchor.text === '')!
    expect(empty).toBeDefined()
    expect(listHwpxTextOrdinals(guarded, sectionPath)).toContain(empty.ordinal)

    const inserted = applyReplaceTextCommand(guarded, {
      type: 'replace-text',
      revision: guarded.revision,
      sectionPath,
      textNodeId: empty.textNodeId,
      from: 0,
      to: 0,
      insert: '빈 칸 & 입력'
    })
    const insertedXml = inserted.package.readEntry(sectionPath).toString('utf8')
    expect(insertedXml).toContain('<hp:t xml:space="preserve">빈 칸 &amp; 입력</hp:t>')
    expect(insertedXml).not.toContain(selfClosing)
    expect(inserted.anchor).toMatchObject({ textNodeId: empty.textNodeId, text: '빈 칸 & 입력' })
    expect(inserted.inverse).toMatchObject({ from: 0, to: 8, insert: '', restoreSelfClosingTag: selfClosing })
    expect(listHwpxTextAnchors(inserted.package, sectionPath).map((anchor) => anchor.textNodeId))
      .toEqual(anchors.map((anchor) => anchor.textNodeId))

    // 이어서 입력한 뒤 전체 inverse를 거꾸로 적용하면 원래 자기 닫힘 tag bytes가 돌아온다.
    const appended = applyReplaceTextCommand(inserted.package, {
      type: 'replace-text',
      revision: inserted.package.revision,
      sectionPath,
      textNodeId: empty.textNodeId,
      from: 8,
      to: 8,
      insert: '끝'
    })
    expect(appended.inverse.restoreSelfClosingTag).toBeUndefined()
    const undoAppend = applyReplaceTextCommand(appended.package, appended.inverse)
    const undoInsert = applyReplaceTextCommand(undoAppend.package, {
      ...inserted.inverse,
      revision: undoAppend.package.revision
    })
    expect(undoInsert.package.readEntry(sectionPath)).toEqual(Buffer.from(original))
    // 되돌린 뒤 다시 실행(원래 command)도 같은 결과를 만든다.
    expect(undoInsert.inverse.restoreSelfClosingTag).toBeUndefined()
    const redo = applyReplaceTextCommand(undoInsert.package, {
      ...undoInsert.inverse,
      revision: undoInsert.package.revision
    })
    expect(redo.package.readEntry(sectionPath).toString('utf8')).toBe(insertedXml)

    // 빈 결과를 만드는 편집은 자기 닫힘 tag를 그대로 둔다.
    const noop = applyReplaceTextCommand(guarded, {
      type: 'replace-text',
      revision: guarded.revision,
      sectionPath,
      textNodeId: empty.textNodeId,
      from: 0,
      to: 0,
      insert: ''
    })
    expect(noop.package.readEntry(sectionPath)).toEqual(Buffer.from(original))
  })

  test('자기 닫힘 복원 tag가 현재 hp:t attribute와 다르면 충돌로 거부한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const sectionPath = 'Contents/section0.xml'
    const guarded = source.withEntry(
      sectionPath,
      Buffer.from(source.readEntry(sectionPath).toString('utf8').replace('<hp:t></hp:t>', '<hp:t/>'))
    )
    const empty = listHwpxTextAnchors(guarded, sectionPath).find((anchor) => anchor.text === '')!
    const inserted = applyReplaceTextCommand(guarded, {
      type: 'replace-text',
      revision: guarded.revision,
      sectionPath,
      textNodeId: empty.textNodeId,
      from: 0,
      to: 0,
      insert: 'A'
    })
    expect(() => applyReplaceTextCommand(inserted.package, {
      ...inserted.inverse,
      restoreSelfClosingTag: '<hp:t id="other"/>'
    })).toThrow(HwpxEditConflictError)
    expect(() => applyReplaceTextCommand(inserted.package, {
      ...inserted.inverse,
      restoreSelfClosingTag: '<hp:run/>'
    })).toThrow(HwpxEditConflictError)
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

    // fixture의 `<hp:t></hp:t>`와 끝에 붙인 자기 닫힘 `<hp:t/>` 둘 다 빈 anchor다.
    expect(anchors.filter((anchor) => anchor.text === '')).toHaveLength(2)
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
      '첫 줄<hp:lineBreak/>새 줄<hp:lineBreak/>둘째 줄<hp:tab/>탭'
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
    const temporaryNames = () => readdirSync(directory).filter((name) => name.includes('.han-flow-'))

    await expect(
      saveHwpxAs(edited, failedDestination, {
        verify: () => {
          throw new Error('의도한 검증 실패')
        }
      })
    ).rejects.toThrow('의도한 검증 실패')
    expect(existsSync(failedDestination)).toBe(false)
    expect(temporaryNames()).toEqual([])

    const existingDestination = join(directory, 'existing.hwpx')
    writeFileSync(existingDestination, '기존 파일')
    const verify = jest.fn()
    await expect(saveHwpxAs(edited, existingDestination, { verify })).rejects.toMatchObject({
      name: 'HwpxSaveAsError',
      code: 'HWPX_SAVE_DESTINATION_EXISTS'
    })
    // 기존 파일 충돌은 임시 파일을 쓰거나 검증하기 전에 거부한다.
    expect(verify).not.toHaveBeenCalled()
    expect(temporaryNames()).toEqual([])
    expect(readFileSync(existingDestination, 'utf8')).toBe('기존 파일')

    await expect(saveHwpxAs(edited, fixture)).rejects.toThrow('원본 파일 덮어쓰기')
    await expect(saveHwpxAs(edited, join(directory, 'wrong.txt'))).rejects.toMatchObject({
      code: 'HWPX_SAVE_INVALID_DESTINATION',
      message: expect.stringContaining('.hwpx')
    })
  })

  test('overwrite 플래그가 있어도 원본과 보호 경로는 덮어쓰지 않는다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const originalHash = hash(readFileSync(fixture))
    const edited = applyReplaceTextCommand(source, replaceWholeText(source, '공개 헤더', '원본 보호')).package
    const verify = jest.fn()

    await expect(saveHwpxAs(edited, fixture, { overwrite: true, verify })).rejects.toMatchObject({
      code: 'HWPX_SAVE_PROTECTED_DESTINATION',
      message: expect.stringContaining('원본 파일 덮어쓰기')
    })
    // 같은 파일을 가리키는 다른 경로 표기도 원본으로 취급한다.
    await expect(
      saveHwpxAs(edited, join(directory, '.', 'nested', '..', basename(fixture)), { overwrite: true })
    ).rejects.toMatchObject({ code: 'HWPX_SAVE_PROTECTED_DESTINATION' })
    // 원본과 같은 inode를 가리키는 hard link도 교체하지 않는다.
    const sourceAlias = join(directory, 'source-alias.hwpx')
    linkSync(fixture, sourceAlias)
    await expect(saveHwpxAs(edited, sourceAlias, { overwrite: true })).rejects.toMatchObject({
      code: 'HWPX_SAVE_PROTECTED_DESTINATION'
    })
    rmSync(sourceAlias)

    const otherOpenDocument = join(directory, 'other-open.hwpx')
    writeFileSync(otherOpenDocument, '다른 session 원본')
    await expect(
      saveHwpxAs(edited, otherOpenDocument, { overwrite: true, protectedPaths: [otherOpenDocument] })
    ).rejects.toMatchObject({ code: 'HWPX_SAVE_PROTECTED_DESTINATION' })

    expect(verify).not.toHaveBeenCalled()
    expect(hash(readFileSync(fixture))).toBe(originalHash)
    expect(readFileSync(otherOpenDocument, 'utf8')).toBe('다른 session 원본')
    expect(readdirSync(directory).filter((name) => name.includes('.han-flow-'))).toEqual([])
  })

  test('overwrite 플래그가 있으면 기존 파일을 검증된 package로 원자적으로 교체한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const command = replaceWholeText(source, '공개 헤더', '교체 저장')
    const edited = applyReplaceTextCommand(source, command).package
    const destination = join(directory, 'replace-me.hwpx')
    writeFileSync(destination, '교체될 기존 파일')

    const result = await saveHwpxAs(edited, destination, {
      overwrite: true,
      verify: (savedPackage) => {
        // 검증 중에는 기존 파일이 그대로 남아 있어야 한다.
        expect(readFileSync(destination, 'utf8')).toBe('교체될 기존 파일')
        const anchor = listHwpxTextAnchors(savedPackage, command.sectionPath).find(
          (candidate) => candidate.textNodeId === command.textNodeId
        )
        expect(anchor?.text).toBe('교체 저장')
      }
    })

    expect(result).toMatchObject({ destinationPath: destination, replacedExisting: true })
    const saved = await HwpxSourcePackage.open(destination)
    expect(hash(saved.toBuffer())).toBe(hash(edited.toBuffer()))
    expect(
      listHwpxTextAnchors(saved, command.sectionPath).find(
        (candidate) => candidate.textNodeId === command.textNodeId
      )?.text
    ).toBe('교체 저장')
    expect(readdirSync(directory).filter((name) => name.includes('.han-flow-'))).toEqual([])
  })

  test('overwrite 없이 확인 뒤 게시 직전에 생긴 목적지는 교체하지 않는다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const edited = applyReplaceTextCommand(source, replaceWholeText(source, '공개 헤더', '경쟁 저장')).package
    const destination = join(directory, 'race-created.hwpx')

    await expect(
      saveHwpxAs(edited, destination, {
        onBeforePublish: () => writeFileSync(destination, '다른 프로그램이 만든 파일')
      })
    ).rejects.toMatchObject({ name: 'HwpxSaveAsError', code: 'HWPX_SAVE_DESTINATION_EXISTS' })
    expect(readFileSync(destination, 'utf8')).toBe('다른 프로그램이 만든 파일')
    expect(readdirSync(directory).filter((name) => name.includes('.han-flow-'))).toEqual([])
  })

  test('hard link를 지원하지 않는 파일 시스템에서는 확인 후 rename으로 저장한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const edited = applyReplaceTextCommand(source, replaceWholeText(source, '공개 헤더', 'link 미지원')).package
    const destination = join(directory, 'no-hard-link.hwpx')
    const unsupported = Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    const linkSpy = jest.spyOn(fsPromises, 'link').mockRejectedValue(unsupported)
    try {
      await expect(saveHwpxAs(edited, destination)).resolves.toMatchObject({ replacedExisting: false })
      expect(linkSpy).toHaveBeenCalledTimes(1)

      // 대체 경로도 rename 직전에 다시 확인해 그 사이 생긴 파일을 거부한다.
      const raced = join(directory, 'no-hard-link-raced.hwpx')
      await expect(
        saveHwpxAs(edited, raced, { onBeforePublish: () => writeFileSync(raced, '먼저 생긴 파일') })
      ).rejects.toMatchObject({ code: 'HWPX_SAVE_DESTINATION_EXISTS' })
      expect(readFileSync(raced, 'utf8')).toBe('먼저 생긴 파일')
    } finally {
      linkSpy.mockRestore()
    }
    const saved = await HwpxSourcePackage.open(destination)
    expect(hash(saved.toBuffer())).toBe(hash(edited.toBuffer()))
    expect(readdirSync(directory).filter((name) => name.includes('.han-flow-'))).toEqual([])
  })

  ;(process.platform === 'win32' ? test.skip : test)('저장 파일 권한은 0o600이 아니라 umask를 적용한 기본값이다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const edited = applyReplaceTextCommand(source, replaceWholeText(source, '공개 헤더', '권한')).package
    const destination = join(directory, 'mode.hwpx')
    await saveHwpxAs(edited, destination)
    expect(statSync(destination).mode & 0o777).toBe(0o666 & ~process.umask())

    const pdf = join(directory, 'mode.pdf')
    await writeFileAtomically(pdf, Buffer.from('%PDF-1.4'))
    expect(statSync(pdf).mode & 0o777).toBe(0o666 & ~process.umask())
  })

  test('writeFileAtomically는 보호 경로와 symlink 목적지를 overwrite여도 거부한다', async () => {
    const protectedPath = join(directory, 'open-source.hwpx')
    writeFileSync(protectedPath, '열린 원본')
    await expect(
      writeFileAtomically(protectedPath, Buffer.from('%PDF'), { overwrite: true, protectedPaths: [protectedPath] })
    ).rejects.toMatchObject({ code: 'HWPX_SAVE_PROTECTED_DESTINATION' })
    expect(readFileSync(protectedPath, 'utf8')).toBe('열린 원본')

    if (process.platform !== 'win32') {
      const linkPath = join(directory, 'link-to-source.pdf')
      symlinkSync(protectedPath, linkPath)
      await expect(
        writeFileAtomically(linkPath, Buffer.from('%PDF'), { overwrite: true })
      ).rejects.toMatchObject({ code: 'HWPX_SAVE_INVALID_DESTINATION' })
      expect(readFileSync(protectedPath, 'utf8')).toBe('열린 원본')
      rmSync(linkPath)
    }
    rmSync(protectedPath)
  })

  test('overwrite 교체 중 검증이 실패하면 기존 파일을 보존하고 임시 파일을 지운다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const edited = applyReplaceTextCommand(source, replaceWholeText(source, '공개 헤더', '교체 실패')).package
    const destination = join(directory, 'keep-on-failure.hwpx')
    writeFileSync(destination, '보존될 기존 파일')

    await expect(
      saveHwpxAs(edited, destination, {
        overwrite: true,
        verify: () => {
          throw new Error('교체 전 검증 실패')
        }
      })
    ).rejects.toThrow('교체 전 검증 실패')
    expect(readFileSync(destination, 'utf8')).toBe('보존될 기존 파일')
    expect(readdirSync(directory).filter((name) => name.includes('.han-flow-'))).toEqual([])
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
