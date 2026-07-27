const DEFAULT_MAX_GROUP = 3
const MERGE_PENALTY = 8
const MAX_EDIT_MATRIX_CELLS = 12_000_000

export function normalizeProbeText(value) {
  return typeof value === 'string' ? value.normalize('NFC').replace(/\s/gu, '') : ''
}

function characterLength(value) {
  return Array.from(value).length
}

function sumLengths(pages, start, count) {
  let total = 0
  for (let index = start; index < start + count; index += 1) total += characterLength(pages[index])
  return total
}

function pageRange(start, count) {
  return {
    startPage: start + 1,
    endPage: start + count
  }
}

export function editStatistics(referenceText, candidateText) {
  const reference = Array.from(referenceText)
  const candidate = Array.from(candidateText)
  const rows = reference.length + 1
  const columns = candidate.length + 1
  const matrixCells = rows * columns
  let commonPrefix = 0
  while (
    commonPrefix < reference.length &&
    commonPrefix < candidate.length &&
    reference[commonPrefix] === candidate[commonPrefix]
  ) {
    commonPrefix += 1
  }
  let commonSuffix = 0
  while (
    commonSuffix < reference.length - commonPrefix &&
    commonSuffix < candidate.length - commonPrefix &&
    reference[reference.length - 1 - commonSuffix] === candidate[candidate.length - 1 - commonSuffix]
  ) {
    commonSuffix += 1
  }

  if (matrixCells > MAX_EDIT_MATRIX_CELLS) {
    return {
      distance: null,
      insertions: null,
      deletions: null,
      substitutions: null,
      similarity: null,
      commonPrefix,
      commonSuffix,
      exact: referenceText === candidateText,
      matrixLimited: true
    }
  }

  const previous = new Uint32Array(columns)
  const current = new Uint32Array(columns)
  const directions = new Uint8Array(matrixCells)
  for (let column = 1; column < columns; column += 1) {
    previous[column] = column
    directions[column] = 2
  }

  for (let row = 1; row < rows; row += 1) {
    current[0] = row
    directions[row * columns] = 1
    for (let column = 1; column < columns; column += 1) {
      const diagonal = previous[column - 1] + (reference[row - 1] === candidate[column - 1] ? 0 : 1)
      const deletion = previous[column] + 1
      const insertion = current[column - 1] + 1
      let value = diagonal
      let direction = 0
      if (deletion < value) {
        value = deletion
        direction = 1
      }
      if (insertion < value) {
        value = insertion
        direction = 2
      }
      current[column] = value
      directions[row * columns + column] = direction
    }
    previous.set(current)
  }

  let row = reference.length
  let column = candidate.length
  let insertions = 0
  let deletions = 0
  let substitutions = 0
  while (row > 0 || column > 0) {
    const direction = directions[row * columns + column]
    if (row > 0 && column > 0 && direction === 0) {
      if (reference[row - 1] !== candidate[column - 1]) substitutions += 1
      row -= 1
      column -= 1
    } else if (row > 0 && (column === 0 || direction === 1)) {
      deletions += 1
      row -= 1
    } else {
      insertions += 1
      column -= 1
    }
  }

  const distance = insertions + deletions + substitutions
  const denominator = Math.max(reference.length, candidate.length, 1)
  return {
    distance,
    insertions,
    deletions,
    substitutions,
    similarity: 1 - distance / denominator,
    commonPrefix,
    commonSuffix,
    exact: distance === 0,
    matrixLimited: false
  }
}

export function characterBagStatistics(referenceText, candidateText) {
  const referenceCounts = new Map()
  const candidateCounts = new Map()
  for (const character of referenceText) {
    referenceCounts.set(character, (referenceCounts.get(character) ?? 0) + 1)
  }
  for (const character of candidateText) {
    candidateCounts.set(character, (candidateCounts.get(character) ?? 0) + 1)
  }

  const characters = new Set([...referenceCounts.keys(), ...candidateCounts.keys()])
  let common = 0
  let missing = 0
  let extra = 0
  const missingCategories = { hangul: 0, latin: 0, number: 0, punctuation: 0, symbol: 0, other: 0 }
  const extraCategories = { hangul: 0, latin: 0, number: 0, punctuation: 0, symbol: 0, other: 0 }
  const category = (character) => {
    if (/\p{Script=Hangul}/u.test(character)) return 'hangul'
    if (/\p{Script=Latin}/u.test(character)) return 'latin'
    if (/\p{Number}/u.test(character)) return 'number'
    if (/\p{Punctuation}/u.test(character)) return 'punctuation'
    if (/\p{Symbol}/u.test(character)) return 'symbol'
    return 'other'
  }
  for (const character of characters) {
    const referenceCount = referenceCounts.get(character) ?? 0
    const candidateCount = candidateCounts.get(character) ?? 0
    common += Math.min(referenceCount, candidateCount)
    const missingCount = Math.max(0, referenceCount - candidateCount)
    const extraCount = Math.max(0, candidateCount - referenceCount)
    missing += missingCount
    extra += extraCount
    missingCategories[category(character)] += missingCount
    extraCategories[category(character)] += extraCount
  }
  return {
    common,
    missing,
    extra,
    similarity: common / Math.max(common + missing, common + extra, 1),
    missingCategories,
    extraCategories
  }
}

function segmentation(referencePages, candidatePages, maxGroup) {
  const rows = referencePages.length + 1
  const columns = candidatePages.length + 1
  const states = Array.from({ length: rows }, () => Array(columns))
  states[0][0] = { cost: 0, previous: null }

  for (let referenceIndex = 0; referenceIndex < referencePages.length; referenceIndex += 1) {
    for (let candidateIndex = 0; candidateIndex < candidatePages.length; candidateIndex += 1) {
      const state = states[referenceIndex][candidateIndex]
      if (!state) continue
      for (
        let referenceCount = 1;
        referenceCount <= maxGroup && referenceIndex + referenceCount <= referencePages.length;
        referenceCount += 1
      ) {
        for (
          let candidateCount = 1;
          candidateCount <= maxGroup && candidateIndex + candidateCount <= candidatePages.length;
          candidateCount += 1
        ) {
          const referenceCharacters = sumLengths(referencePages, referenceIndex, referenceCount)
          const candidateCharacters = sumLengths(candidatePages, candidateIndex, candidateCount)
          const cost = state.cost +
            Math.abs(referenceCharacters - candidateCharacters) +
            (referenceCount + candidateCount - 2) * MERGE_PENALTY
          const nextReference = referenceIndex + referenceCount
          const nextCandidate = candidateIndex + candidateCount
          const known = states[nextReference][nextCandidate]
          if (!known || cost < known.cost) {
            states[nextReference][nextCandidate] = {
              cost,
              previous: { referenceIndex, candidateIndex, referenceCount, candidateCount }
            }
          }
        }
      }
    }
  }

  const groups = []
  let referenceIndex = referencePages.length
  let candidateIndex = candidatePages.length
  while (referenceIndex > 0 || candidateIndex > 0) {
    const state = states[referenceIndex][candidateIndex]
    if (!state?.previous) throw new Error('페이지 정렬 경로를 만들 수 없습니다.')
    groups.push(state.previous)
    referenceIndex = state.previous.referenceIndex
    candidateIndex = state.previous.candidateIndex
  }
  return groups.reverse()
}

export function alignTextPages(referenceInput, candidateInput, options = {}) {
  const maxGroup = options.maxGroup ?? DEFAULT_MAX_GROUP
  const referencePages = referenceInput.map(normalizeProbeText)
  const candidatePages = candidateInput.map(normalizeProbeText)
  if (!referencePages.length || !candidatePages.length) {
    throw new Error('페이지 정렬에는 양쪽 입력이 모두 필요합니다.')
  }

  const groups = segmentation(referencePages, candidatePages, maxGroup).map((group) => {
    const referenceText = referencePages
      .slice(group.referenceIndex, group.referenceIndex + group.referenceCount)
      .join('')
    const candidateText = candidatePages
      .slice(group.candidateIndex, group.candidateIndex + group.candidateCount)
      .join('')
    return {
      reference: pageRange(group.referenceIndex, group.referenceCount),
      candidate: pageRange(group.candidateIndex, group.candidateCount),
      referenceCharacters: characterLength(referenceText),
      candidateCharacters: characterLength(candidateText),
      characterDelta: characterLength(candidateText) - characterLength(referenceText),
      characterBag: characterBagStatistics(referenceText, candidateText),
      edit: editStatistics(referenceText, candidateText)
    }
  })

  const referenceCharacters = referencePages.reduce((sum, page) => sum + characterLength(page), 0)
  const candidateCharacters = candidatePages.reduce((sum, page) => sum + characterLength(page), 0)
  const characterBag = characterBagStatistics(referencePages.join(''), candidatePages.join(''))
  const comparableGroups = groups.filter((group) => group.edit.distance !== null)
  const editDistance = comparableGroups.reduce((sum, group) => sum + group.edit.distance, 0)
  const similarityDenominator = comparableGroups.reduce(
    (sum, group) => sum + Math.max(group.referenceCharacters, group.candidateCharacters),
    0
  )

  return {
    referencePageCount: referencePages.length,
    candidatePageCount: candidatePages.length,
    referenceCharacters,
    candidateCharacters,
    characterDelta: candidateCharacters - referenceCharacters,
    characterBag,
    editDistance: comparableGroups.length === groups.length ? editDistance : null,
    similarity: comparableGroups.length === groups.length
      ? 1 - editDistance / Math.max(similarityDenominator, 1)
      : null,
    groups
  }
}
