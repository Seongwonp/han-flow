module.exports = {
  preset: 'ts-jest',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }]
  },
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/out/']
}
