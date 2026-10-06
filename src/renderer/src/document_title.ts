/** 창·PDF 제목에 쓰는 앱 이름. main의 `APP_TITLE`과 같다. */
export const APP_TITLE = 'Han-Flow'

/** 경로의 파일 이름. Windows(`\`)와 POSIX(`/`) 구분자를 모두 받는다. */
export function documentFileName(filePath: string): string {
  return filePath.split(/[\\/]/u).pop() || filePath
}

/** PDF 메타데이터 제목: 확장자를 뺀 문서 이름. */
export function documentTitle(filePath: string): string {
  const name = documentFileName(filePath)
  const stem = name.replace(/\.[^.]*$/u, '')
  return stem || name
}
