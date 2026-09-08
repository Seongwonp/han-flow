const PIPELINE_FORMATS = new Map([
  ['hwpx-core', 'hwpx'],
  ['hwpx-production', 'hwpx'],
  ['hwp-production', 'hwp']
])

export function validateFixtureCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') throw new Error('fixture catalog는 object여야 합니다.')
  if (catalog.schemaVersion !== 1) throw new Error('지원하지 않는 fixture catalog schemaVersion입니다.')
  if (typeof catalog.suite !== 'string' || !catalog.suite.trim()) throw new Error('fixture catalog suite가 비어 있습니다.')
  if (!Array.isArray(catalog.fixtures) || !catalog.fixtures.length) throw new Error('fixture catalog 항목이 없습니다.')
  const ids = new Set()
  for (const fixture of catalog.fixtures) {
    if (!fixture || typeof fixture !== 'object') throw new Error('fixture catalog 항목이 올바르지 않습니다.')
    if (typeof fixture.id !== 'string' || !/^[a-z0-9-]+$/.test(fixture.id)) {
      throw new Error('fixture catalog id는 소문자·숫자·하이픈만 사용할 수 있습니다.')
    }
    if (ids.has(fixture.id)) throw new Error(`중복 fixture catalog id입니다: ${fixture.id}`)
    ids.add(fixture.id)
    if (!['hwp', 'hwpx'].includes(fixture.format)) throw new Error(`${fixture.id}: format이 올바르지 않습니다.`)
    if (typeof fixture.category !== 'string' || !fixture.category.trim()) {
      throw new Error(`${fixture.id}: category가 비어 있습니다.`)
    }
    if (!Array.isArray(fixture.pipelines) || !fixture.pipelines.length) {
      throw new Error(`${fixture.id}: pipeline이 없습니다.`)
    }
    const pipelines = new Set()
    for (const pipeline of fixture.pipelines) {
      if (!PIPELINE_FORMATS.has(pipeline)) throw new Error(`${fixture.id}: 지원하지 않는 pipeline입니다: ${pipeline}`)
      if (pipelines.has(pipeline)) throw new Error(`${fixture.id}: 중복 pipeline입니다: ${pipeline}`)
      pipelines.add(pipeline)
      if (PIPELINE_FORMATS.get(pipeline) !== fixture.format) {
        throw new Error(`${fixture.id}: ${pipeline}은 ${fixture.format} 형식과 호환되지 않습니다.`)
      }
    }
  }
  return catalog
}

export function linkHwpxManifest(catalog, manifest) {
  validateFixtureCatalog(catalog)
  const catalogById = new Map(catalog.fixtures.map((fixture) => [fixture.id, fixture]))
  const manifestById = new Map(manifest.fixtures.map((fixture) => [fixture.id, fixture]))
  for (const fixture of manifest.fixtures) {
    const catalogFixture = catalogById.get(fixture.id)
    if (!catalogFixture) throw new Error(`${fixture.id}: fixture catalog에 HWPX 항목이 없습니다.`)
    if (catalogFixture.format !== 'hwpx') throw new Error(`${fixture.id}: fixture catalog 형식이 HWPX가 아닙니다.`)
    if (catalogFixture.category !== fixture.category) throw new Error(`${fixture.id}: fixture category가 catalog와 다릅니다.`)
    if (!catalogFixture.pipelines.includes('hwpx-core')) throw new Error(`${fixture.id}: hwpx-core pipeline이 없습니다.`)
  }
  for (const fixture of catalog.fixtures.filter(({ pipelines }) => pipelines.includes('hwpx-core'))) {
    if (!manifestById.has(fixture.id)) throw new Error(`${fixture.id}: HWPX manifest 항목이 없습니다.`)
  }
  return catalog.fixtures
    .filter(({ pipelines }) => pipelines.includes('hwpx-production'))
    .map((fixture) => {
      const manifestFixture = manifestById.get(fixture.id)
      if (!manifestFixture) throw new Error(`${fixture.id}: production HWPX manifest 항목이 없습니다.`)
      return { ...fixture, manifest: manifestFixture }
    })
}

export function linkHwpManifest(catalog, manifest) {
  validateFixtureCatalog(catalog)
  if (typeof manifest.catalogId !== 'string') throw new Error('HWP manifest의 catalogId가 없습니다.')
  const fixture = catalog.fixtures.find(({ id }) => id === manifest.catalogId)
  if (!fixture) throw new Error(`${manifest.catalogId}: fixture catalog에 HWP 항목이 없습니다.`)
  if (fixture.format !== 'hwp' || !fixture.pipelines.includes('hwp-production')) {
    throw new Error(`${fixture.id}: HWP production pipeline 항목이 아닙니다.`)
  }
  if (manifest.fixture !== `${fixture.id}.hwp`) throw new Error(`${fixture.id}: HWP fixture 파일명이 catalog ID와 다릅니다.`)
  return fixture
}
