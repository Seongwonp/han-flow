module.exports = {
  preset: 'ts-jest',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }]
  },
  testEnvironment: 'node',
  // 저장·조판 검증 test는 전체 suite를 병렬로 돌리는 부하에서 기본 5초를 넘길 수 있다. timeout으로 끝난 test의 저장은 같은
  // worker process에서 계속 돌아 뒤 test 파일에 끼어들므로(core module 공유) 여유를 둔다.
  testTimeout: 30_000,
  testMatch: ['**/tests/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/out/']
}
