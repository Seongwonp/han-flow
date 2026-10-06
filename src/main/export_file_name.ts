import * as nodePath from 'path'

/** 창 제목·PDF 제목에 쓰는 앱 이름. */
export const APP_TITLE = 'Han-Flow'

/** 문서를 알 수 없을 때 PDF 저장 대화상자에 넣는 기본 이름. */
export const FALLBACK_PDF_FILE_NAME = '문서.pdf'

type PathApi = Pick<typeof nodePath, 'basename' | 'dirname' | 'extname' | 'join'>

// Windows 파일 이름에 쓸 수 없는 문자와 제어 문자.
// eslint-disable-next-line no-control-regex
const ILLEGAL_FILE_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]/gu
// Windows 예약 장치 이름. 확장자가 붙어도 장치로 해석된다.
const RESERVED_WINDOWS_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu

/**
 * 파일 이름 stem을 Windows·macOS·Linux 어디서나 쓸 수 있는 이름으로 바꾼다.
 * 금지 문자는 `_`로 바꾸고, Windows가 지우는 끝의 점·공백은 미리 떼어낸다. 남는 것이 없으면 `undefined`.
 */
export function sanitizeFileStem(stem: string): string | undefined {
  const replaced = stem.replace(ILLEGAL_FILE_NAME_CHARACTERS, '_').trim().replace(/[. ]+$/u, '')
  if (!replaced || /^_+$/u.test(replaced)) return undefined
  return RESERVED_WINDOWS_NAMES.test(replaced) ? `${replaced}_` : replaced
}

/** 문서 경로의 확장자 없는 이름. 경로가 없으면 `undefined`. */
export function documentStem(sourcePath: string | undefined, pathApi: PathApi = nodePath): string | undefined {
  if (!sourcePath) return undefined
  const name = pathApi.basename(sourcePath)
  const extension = pathApi.extname(name)
  const stem = extension ? name.slice(0, -extension.length) : name
  return stem || undefined
}

/** 열린 문서 이름으로 만든 PDF 파일 이름. 문서를 모르거나 쓸 수 있는 글자가 없으면 `문서.pdf`. */
export function pdfFileName(sourcePath: string | undefined, pathApi: PathApi = nodePath): string {
  const stem = documentStem(sourcePath, pathApi)
  const safeStem = stem ? sanitizeFileStem(stem) : undefined
  return safeStem ? `${safeStem}.pdf` : FALLBACK_PDF_FILE_NAME
}

/**
 * PDF 저장 대화상자의 기본 경로. 마지막으로 쓴 대화상자 폴더가 있으면 그 폴더,
 * 없으면 원본 문서 폴더에 `<문서 이름>.pdf`를 둔다. 둘 다 없으면 이름만 돌려준다.
 */
export function suggestedPdfExportPath(
  sourcePath: string | undefined,
  lastDialogDirectory: string | undefined,
  pathApi: PathApi = nodePath
): string {
  const fileName = pdfFileName(sourcePath, pathApi)
  const directory = lastDialogDirectory ?? (sourcePath ? pathApi.dirname(sourcePath) : undefined)
  return directory ? pathApi.join(directory, fileName) : fileName
}

/** 창 제목. 문서가 열려 있으면 `<파일 이름> - Han-Flow`, 아니면 `Han-Flow`. */
export function windowTitle(sourcePath: string | undefined, pathApi: PathApi = nodePath): string {
  const name = sourcePath ? pathApi.basename(sourcePath) : ''
  return name ? `${name} - ${APP_TITLE}` : APP_TITLE
}
