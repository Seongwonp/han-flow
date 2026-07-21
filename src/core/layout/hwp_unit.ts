import { HwpUnit } from '../document/viewer_document'

export const HWPUNIT_PER_INCH = 7200
export const MM_PER_INCH = 25.4
export const CSS_PX_PER_INCH = 96

export function hwpUnitToMm(value: HwpUnit): number {
  return (value * MM_PER_INCH) / HWPUNIT_PER_INCH
}

export function hwpUnitToInches(value: HwpUnit): number {
  return value / HWPUNIT_PER_INCH
}

export function hwpUnitToCssPx(value: HwpUnit): number {
  return (value * CSS_PX_PER_INCH) / HWPUNIT_PER_INCH
}

export function cssPxToHwpUnit(value: number): HwpUnit {
  return (value * HWPUNIT_PER_INCH) / CSS_PX_PER_INCH
}
