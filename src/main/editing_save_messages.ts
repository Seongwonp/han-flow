import { HwpxSaveAsError } from '../core/editing/save_as'

export const PROTECTED_DESTINATION_MESSAGE =
  '열려 있는 원본 문서는 덮어쓸 수 없습니다. 다른 이름이나 다른 폴더를 선택해 주세요.'

export const INVALID_DESTINATION_MESSAGE =
  '저장 위치가 올바르지 않습니다. 폴더나 바로가기(심볼릭 링크)가 아닌 .hwpx 파일 이름을 지정해 주세요.'

/** PDF 내보내기(writeFileAtomically) 실패를 PDF 맥락의 한국어 안내로 바꾼다. */
export function pdfExportFailureMessage(reason: unknown): string {
  if (reason instanceof HwpxSaveAsError) {
    switch (reason.code) {
      case 'HWPX_SAVE_PROTECTED_DESTINATION':
        return '편집 중인 원본 문서 위치에는 PDF를 저장할 수 없습니다. 다른 .pdf 파일 이름을 지정해 주세요.'
      case 'HWPX_SAVE_INVALID_DESTINATION':
        return 'PDF 저장 위치가 올바르지 않습니다. 폴더나 바로가기(심볼릭 링크)가 아닌 .pdf 파일 이름을 지정해 주세요.'
      case 'HWPX_SAVE_DESTINATION_EXISTS':
        return '같은 이름의 파일이 이미 있어 PDF를 저장하지 않았습니다. 다른 이름을 지정해 주세요.'
      case 'HWPX_SAVE_FILESYSTEM':
        switch (reason.systemCode) {
          case 'EACCES':
          case 'EPERM':
          case 'EROFS':
          case 'EBUSY':
            return 'PDF 저장 위치에 쓸 권한이 없거나 기존 PDF가 다른 프로그램에서 열려 있습니다. 파일을 닫거나 다른 위치를 선택해 주세요.'
          case 'ENOSPC':
          case 'EDQUOT':
            return '저장 위치의 공간이 부족해 PDF를 저장하지 못했습니다.'
          default:
            return 'PDF 파일을 쓰지 못했습니다. 저장 위치와 파일 상태를 확인해 주세요.'
        }
    }
  }
  return reason instanceof Error ? reason.message : String(reason)
}

export function saveAsFailureMessage(reason: unknown): string {
  if (reason instanceof HwpxSaveAsError) {
    switch (reason.code) {
      case 'HWPX_SAVE_PROTECTED_DESTINATION':
        return PROTECTED_DESTINATION_MESSAGE
      case 'HWPX_SAVE_DESTINATION_EXISTS':
        return '같은 이름의 파일이 이미 있어 저장하지 않았습니다. 교체를 확인했거나 다른 이름을 선택해 주세요.'
      case 'HWPX_SAVE_INVALID_DESTINATION':
        return INVALID_DESTINATION_MESSAGE
      case 'HWPX_SAVE_FILESYSTEM':
        switch (reason.systemCode) {
          case 'EACCES':
          case 'EPERM':
          case 'EROFS':
            return '저장 위치에 쓸 권한이 없거나 기존 파일이 다른 프로그램에서 열려 있습니다. 다른 위치를 선택하거나 파일을 닫고 다시 시도해 주세요.'
          case 'EBUSY':
            return '기존 파일이 다른 프로그램에서 사용 중이라 교체하지 못했습니다. 파일을 닫고 다시 시도해 주세요.'
          case 'EXDEV':
            return '저장 위치의 파일 시스템에서 원자적 교체를 지원하지 않아 저장하지 못했습니다. 다른 위치를 선택해 주세요.'
          case 'ENOSPC':
          case 'EDQUOT':
            return '저장 위치의 공간이 부족해 저장하지 못했습니다.'
          default:
            return '저장 위치에 파일을 쓰지 못했습니다. 목적지와 파일 상태를 확인해 주세요.'
        }
    }
  }
  return '변경본을 검증해 저장하지 못했습니다. 목적지와 파일 상태를 확인해 주세요.'
}
