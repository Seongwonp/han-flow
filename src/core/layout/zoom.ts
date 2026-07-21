export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2
export const ZOOM_STEP = 0.1

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function stepZoom(value: number, direction: -1 | 1): number {
  return clampZoom(Math.round((value + direction * ZOOM_STEP) * 10) / 10)
}

export function pinchZoom(value: number, deltaY: number): number {
  return clampZoom(value * Math.exp(-deltaY * 0.01))
}
