export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      isolatedModules: true,
      tsconfig: {
        module: 'ESNext',
        target: 'ES2022',
        moduleResolution: 'NodeNext',
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        strict: false
      }
    }]
  },
  testEnvironment: 'node',
  // Better ES module support
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$))'
  ],
  globals: {
    'ts-jest': {
      useESM: true,
      isolatedModules: true
    }
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    'tests/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**'
  ],
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts'
  ],
  moduleFileExtensions: ['ts', 'js', 'json', 'mjs'],
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  moduleDirectories: ['node_modules', '<rootDir>'],
  setupFilesAfterEnv: [],
  testTimeout: 60000,
  maxWorkers: 1,
  detectOpenHandles: true,
  forceExit: true,
  verbose: true
};