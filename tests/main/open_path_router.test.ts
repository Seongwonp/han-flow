import { OpenPathRouter } from '../../src/main/open_path_router'

const request = (filePath: string, receivedAt = 1) => ({ filePath, receivedAt })

function readyRouter(...windowIds: number[]): OpenPathRouter {
  const router = new OpenPathRouter()
  router.setAppReady()
  for (const windowId of windowIds) {
    router.addWindow(windowId)
    router.markReady(windowId)
  }
  return router
}

describe('열기 경로 전달 창 선택', () => {
  test('app 준비 전 경로는 보류했다가 첫 창의 초기 문서로 넘긴다', () => {
    const router = new OpenPathRouter()
    expect(router.route(request('/a.hwp'), null)).toEqual({ action: 'wait' })
    expect(router.route(request('/b.hwpx', 2), null)).toEqual({ action: 'wait' })
    router.setAppReady()
    expect(router.takePending()).toEqual(request('/b.hwpx', 2))
    expect(router.takePending()).toBeNull()
  })

  test('포커스된 창이 받는다', () => {
    const router = readyRouter(1, 2, 3)
    expect(router.route(request('/a.hwp'), 2)).toEqual({ action: 'deliver', windowId: 2, request: request('/a.hwp') })
  })

  test('포커스된 창이 없으면 가장 최근에 만든 창이 받는다', () => {
    const router = readyRouter(1, 2, 3)
    expect(router.route(request('/a.hwp'), null)).toMatchObject({ action: 'deliver', windowId: 3 })
    // 목록에 없는 창 id는 포커스로 인정하지 않는다.
    expect(router.route(request('/a.hwp'), 99)).toMatchObject({ action: 'deliver', windowId: 3 })
  })

  test('두 창 중 하나를 닫아도 남은 창이 경로를 받는다', () => {
    const router = readyRouter(1, 2)
    router.removeWindow(2)
    expect(router.route(request('/a.hwp'), null)).toMatchObject({ action: 'deliver', windowId: 1 })
    router.removeWindow(1)
    router.addWindow(3)
    router.markReady(3)
    router.removeWindow(3)
    expect(router.windowCount).toBe(0)
  })

  test('창이 하나도 없으면 새 창을 만든다', () => {
    const router = readyRouter()
    expect(router.route(request('/a.hwp'), null)).toEqual({ action: 'create', request: request('/a.hwp') })
    expect(router.pendingRequest).toBeNull()
  })

  test('받을 창이 load 중이면 보류했다가 준비되면 전달한다', () => {
    const router = readyRouter()
    router.addWindow(1)
    expect(router.route(request('/a.hwp'), null)).toEqual({ action: 'wait' })
    expect(router.flush(null)).toEqual({ action: 'wait' })
    expect(router.pendingRequest).toEqual(request('/a.hwp'))
    router.markReady(1)
    expect(router.flush(null)).toEqual({ action: 'deliver', windowId: 1, request: request('/a.hwp') })
    expect(router.pendingRequest).toBeNull()
    expect(router.flush(null)).toEqual({ action: 'wait' })
  })

  test('보류 중 받을 창이 닫히면 남은 창이나 새 창으로 넘긴다', () => {
    const router = readyRouter(1)
    router.addWindow(2)
    router.route(request('/a.hwp'), 2)
    router.removeWindow(2)
    expect(router.flush(1)).toMatchObject({ action: 'deliver', windowId: 1 })

    const empty = readyRouter()
    empty.addWindow(5)
    empty.route(request('/b.hwp'), null)
    empty.removeWindow(5)
    expect(empty.flush(null)).toEqual({ action: 'create', request: request('/b.hwp') })
  })

  test('preferredWindowId는 포커스된 창, 없으면 최근 창, 창이 없으면 undefined다', () => {
    const router = readyRouter(4, 7)
    expect(router.preferredWindowId(4)).toBe(4)
    expect(router.preferredWindowId(null)).toBe(7)
    expect(readyRouter().preferredWindowId(undefined)).toBeUndefined()
  })
})
